import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PyodideRuntime, type RuntimeCallbacks } from './pyodide-runtime.js';

// ---------------------------------------------------------------------------
// Minimal mock Worker that lets tests push messages in as if from the worker.
// ---------------------------------------------------------------------------
class MockWorker {
    onmessage: ((ev: MessageEvent) => void) | null = null;
    private listeners = new Set<(ev: MessageEvent) => void>();
    readonly sent: any[] = [];

    postMessage(data: any) {
        this.sent.push(data);
    }

    addEventListener(_type: string, listener: any) {
        this.listeners.add(listener);
    }

    removeEventListener(_type: string, listener: any) {
        this.listeners.delete(listener);
    }

    terminate() {}

    /** Simulate an incoming message from the worker. */
    receive(data: any) {
        const ev = new MessageEvent('message', { data });
        this.onmessage?.(ev);
        this.listeners.forEach(l => l(ev));
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeCallbacks(): { cb: RuntimeCallbacks; onStdout: ReturnType<typeof vi.fn>; onLog: ReturnType<typeof vi.fn>; onError: ReturnType<typeof vi.fn>; onReady: ReturnType<typeof vi.fn> } {
    const onStdout = vi.fn();
    const onLog    = vi.fn();
    const onError  = vi.fn();
    const onReady  = vi.fn();
    return { cb: { onStdout, onLog, onError, onReady }, onStdout, onLog, onError, onReady };
}

function makeRuntime(mock: MockWorker, overrides?: Partial<RuntimeCallbacks>, timeoutMs = 30_000) {
    const { cb, ...spies } = makeCallbacks();
    const callbacks = { ...cb, ...overrides };
    const rt = new PyodideRuntime(callbacks, () => mock as unknown as Worker, 'https://example.com/pyodide', timeoutMs);
    return { rt, mock, ...spies };
}

/** Start the runtime and resolve the ready handshake. */
async function startAndReady(mock: MockWorker, rt: PyodideRuntime) {
    rt.start();
    await Promise.resolve(); // let spawnWorker send init
    mock.receive({ type: 'ready' });
    await Promise.resolve(); // let the ready handler settle
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('PyodideRuntime', () => {
    let mock: MockWorker;
    beforeEach(() => { mock = new MockWorker(); });

    it('sends init message on start()', async () => {
        const { rt } = makeRuntime(mock);
        rt.start();
        await Promise.resolve();
        expect(mock.sent[0]).toMatchObject({ type: 'init', indexURL: 'https://example.com/pyodide' });
    });

    it('calls onReady when worker sends ready', async () => {
        const { rt, onReady } = makeRuntime(mock);
        await startAndReady(mock, rt);
        expect(onReady).toHaveBeenCalledOnce();
    });

    it('sends setInterruptBuffer when SharedArrayBuffer is available', async () => {
        const { rt } = makeRuntime(mock);
        await startAndReady(mock, rt);
        const bufMsg = mock.sent.find(m => m.type === 'setInterruptBuffer');
        expect(bufMsg).toBeDefined();
    });

    it('run() sends a run message and resolves on done', async () => {
        const { rt } = makeRuntime(mock);
        await startAndReady(mock, rt);

        const runPromise = rt.run('print("hi")');
        await Promise.resolve();
        const runMsg = mock.sent.find(m => m.type === 'run');
        expect(runMsg).toMatchObject({ type: 'run', code: 'print("hi")' });

        mock.receive({ type: 'done', runId: runMsg.runId });
        await expect(runPromise).resolves.toBeUndefined();
    });

    it('run() rejects when worker sends an error', async () => {
        const { rt } = makeRuntime(mock);
        await startAndReady(mock, rt);

        const runPromise = rt.run('bad code');
        await Promise.resolve();
        const runMsg = mock.sent.find(m => m.type === 'run');

        mock.receive({ type: 'error', runId: runMsg.runId, error: 'NameError: bad' });
        await expect(runPromise).rejects.toThrow('NameError: bad');
    });

    it('run() rejects with timeout and respawns worker', async () => {
        vi.useFakeTimers();
        const { rt, onLog } = makeRuntime(mock, {}, 500);
        await startAndReady(mock, rt);

        const runPromise = rt.run('while True: pass');
        await Promise.resolve();

        vi.advanceTimersByTime(500);
        // terminateAndRespawn() rejects pending runs with 'Worker terminated'
        // before the outer reject('Execution timed out') fires, so the latter is a no-op.
        await expect(runPromise).rejects.toThrow('Worker terminated');
        expect(onLog).toHaveBeenCalledWith(expect.stringContaining('timed out'));
        vi.useRealTimers();
    });

    it('onStdout callback fires for stdout messages', async () => {
        const { rt, onStdout } = makeRuntime(mock);
        await startAndReady(mock, rt);
        mock.receive({ type: 'stdout', data: 'hello\n' });
        expect(onStdout).toHaveBeenCalledWith('hello\n');
    });

    it('onError callback fires for unattributed error messages', async () => {
        const { rt, onError } = makeRuntime(mock);
        await startAndReady(mock, rt);
        mock.receive({ type: 'error', error: 'worker crashed' });
        expect(onError).toHaveBeenCalledWith('worker crashed');
    });

    it('terminate() rejects all pending runs', async () => {
        const { rt } = makeRuntime(mock);
        await startAndReady(mock, rt);

        const p = rt.run('sleep(9999)');
        await Promise.resolve();
        rt.terminate();
        await expect(p).rejects.toThrow('Worker terminated');
    });

    it('interrupt() writes SIGINT to interrupt buffer', async () => {
        const { rt } = makeRuntime(mock);
        await startAndReady(mock, rt);

        // Find the buffer that was sent to the worker
        const bufMsg = mock.sent.find(m => m.type === 'setInterruptBuffer');
        const buf = bufMsg?.interruptBuffer as Uint8Array | undefined;

        rt.run('while True: pass');
        await Promise.resolve();
        rt.interrupt();

        if (buf) {
            expect(buf[0]).toBe(2); // SIGINT
        }
    });
});
