export type RuntimeCallbacks = {
    onStdout: (data: string) => void;
    onLog: (data: string) => void;
    /** Called for worker-level errors not tied to a specific run. */
    onError: (data: string) => void;
    onReady: () => void;
};

/**
 * Manages the Pyodide web worker lifecycle: spawning, messaging, interrupt
 * handling, and run timeouts. Has no UI dependencies and can be tested or
 * replaced independently of the Lit component.
 */
export class PyodideRuntime {
    private worker?: Worker;
    private ready?: Promise<void>;
    private runIdCounter = 1;
    private pendingRuns = new Map<number, {
        resolve: () => void;
        reject: (e: Error) => void;
        timeout: ReturnType<typeof setTimeout>;
    }>();
    private interruptBuffer?: Uint8Array;

    constructor(
        private readonly callbacks: RuntimeCallbacks,
        private readonly workerFactory: () => Worker,
        private readonly indexURL = 'https://cdn.jsdelivr.net/pyodide/v0.29.3/full',
        private readonly RUN_TIMEOUT_MS = 30000,
    ) {}

    /** Spawn the worker. Call once after construction. */
    start(): void {
        this.ready = this.spawnWorker();
    }

    /** Run Python code. Resolves on success, rejects on error or timeout. */
    async run(code: string): Promise<void> {
        await this.ready;
        const runId = this.runIdCounter++;
        return new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.callbacks.onLog('Run timed out — interrupting worker.');
                this.terminateAndRespawn();
                reject(new Error('Execution timed out'));
            }, this.RUN_TIMEOUT_MS);
            this.pendingRuns.set(runId, { resolve, reject, timeout });
            this.worker?.postMessage({ type: 'run', code, runId });
        });
    }

    /** Send a zip URL to be unpacked into the virtual filesystem. */
    async loadZip(url: string): Promise<void> {
        await this.ready;
        this.worker?.postMessage({ type: 'loadZip', url });
    }

    /** Interrupt a running execution. Falls back to worker termination. */
    interrupt(): void {
        this.callbacks.onLog('Interrupt requested.');
        if (!this.worker) {
            this.callbacks.onLog('No worker to interrupt.');
            return;
        }
        if (this.interruptBuffer) {
            try {
                this.callbacks.onLog('Sending SIGINT via interrupt buffer');
                this.interruptBuffer[0] = 2; // SIGINT
                setTimeout(() => {
                    if (this.pendingRuns.size > 0) {
                        this.callbacks.onLog('Interrupt did not stop execution — terminating worker.');
                        this.terminateAndRespawn();
                    }
                }, 1500);
                return;
            } catch (e) {
                this.callbacks.onLog('Failed to use interrupt buffer: ' + String(e));
            }
        }
        this.callbacks.onLog('Attempting fallback interrupt via worker message.');
        const workerRef = this.worker;
        const ackPromise = new Promise<void>((resolve) => {
            const onMsg = (ev: MessageEvent) => {
                const msg = ev.data as any;
                if (msg.type === 'interrupted' || msg.type === 'interrupt-unavailable' || msg.type === 'error') {
                    workerRef.removeEventListener('message', onMsg as any);
                    resolve();
                }
            };
            workerRef.addEventListener('message', onMsg as any);
            try { workerRef.postMessage({ type: 'interrupt' }); } catch { resolve(); }
            setTimeout(() => { workerRef.removeEventListener('message', onMsg as any); resolve(); }, 500);
        });
        ackPromise.then(() => {
            this.callbacks.onLog('Fallback interrupt finished — ensuring clean state by respawning worker.');
            this.terminateAndRespawn();
        });
    }

    /** Terminate the worker and reject any pending runs. */
    terminate(): void {
        if (this.worker) {
            try { this.worker.terminate(); } catch { }
            this.worker = undefined;
        }
        for (const run of this.pendingRuns.values()) {
            clearTimeout(run.timeout);
            run.reject(new Error('Worker terminated'));
        }
        this.pendingRuns.clear();
    }

    private async spawnWorker(): Promise<void> {
        if (this.worker) return;
        this.worker = this.workerFactory();
        this.worker.onmessage = (ev: MessageEvent) => this.handleMessage(ev.data);
        this.worker.postMessage({ type: 'init', baseURL: import.meta.url, indexURL: this.indexURL });
        await new Promise<void>((resolve) => {
            const onReady = (ev: MessageEvent) => {
                if (ev.data?.type === 'ready') {
                    this.worker?.removeEventListener('message', onReady as any);
                    resolve();
                }
            };
            this.worker?.addEventListener('message', onReady as any);
        });
    }

    private terminateAndRespawn(): void {
        this.terminate();
        this.ready = this.spawnWorker();
    }

    private handleMessage(msg: any): void {
        if (msg.type === 'stdout') {
            this.callbacks.onStdout(msg.data);
            return;
        }
        if (msg.type === 'log') {
            this.callbacks.onLog(msg.data);
            return;
        }
        if (msg.type === 'ready') {
            try {
                this.interruptBuffer = new Uint8Array(new SharedArrayBuffer(1));
                this.interruptBuffer[0] = 0;
                this.worker?.postMessage({ type: 'setInterruptBuffer', interruptBuffer: this.interruptBuffer });
                this.callbacks.onLog('Interrupt buffer created and sent to worker');
            } catch (e) {
                this.callbacks.onLog('Could not create SharedArrayBuffer for interrupts: ' + String(e));
            }
            this.callbacks.onReady();
            return;
        }
        if (msg.type === 'done') {
            const run = this.pendingRuns.get(msg.runId);
            if (run) {
                clearTimeout(run.timeout);
                run.resolve();
                this.pendingRuns.delete(msg.runId);
            }
            return;
        }
        if (msg.type === 'error') {
            if (msg.runId !== undefined) {
                const run = this.pendingRuns.get(msg.runId);
                if (run) {
                    clearTimeout(run.timeout);
                    run.reject(new Error(msg.error || msg.data || 'Unknown error'));
                    this.pendingRuns.delete(msg.runId);
                    return;
                }
            }
            this.callbacks.onError(String(msg.error || msg.data || 'Worker error'));
            return;
        }
    }
}
