import { PyodideRuntime, type RuntimeCallbacks } from './pyodide-runtime.js';

export type MemberCallbacks = {
    onLog:    (data: string) => void;
    onError:  (data: string) => void;
    onReady:  () => void;
};

type SessionEntry = {
    runtime: PyodideRuntime;
    members: Set<MemberCallbacks>;
    ready: boolean;
};

const sessions = new Map<string, SessionEntry>();

/**
 * Thin per-editor view of the shared runtime. Wraps PyodideRuntime and
 * overrides editorId so canvas operations are routed to the right canvas.
 */
export class EditorHandle {
    readonly editorId: string;
    constructor(private readonly _runtime: PyodideRuntime, editorId?: string) {
        this.editorId = editorId ?? crypto.randomUUID();
    }

    get ready(): Promise<void> { return this._runtime['ready'] as Promise<void>; }
    start() { /* managed by session */ }

    run(code: string, onStdout: (data: string) => void) {
        return this._runtime.runAs(code, onStdout, this.editorId);
    }
    loadZip(url: string) { return this._runtime.loadZip(url); }
    setCanvas(canvas: OffscreenCanvas) { return this._runtime.setCanvasFor(canvas, this.editorId); }
    clearCanvas() { this._runtime.clearCanvasFor(this.editorId); }
    requestFit(cb: Parameters<PyodideRuntime['requestFit']>[0]) { return this._runtime.requestFitFor(cb, this.editorId); }
    samplePixel(x: number, y: number) { return this._runtime.samplePixelFor(x, y, this.editorId); }
    interrupt() { this._runtime.interrupt(); }
    terminate() { /* managed by session */ }
}

/**
 * Join (or create) a named shared session.
 * Returns a per-editor EditorHandle backed by the shared runtime.
 * If the session is already ready, member.onReady() is called asynchronously.
 */
export function joinSession(
    id: string,
    member: MemberCallbacks,
    workerFactory: () => Worker,
    indexURL?: string,
    timeoutMs?: number,
): EditorHandle {
    let entry = sessions.get(id);
    if (!entry) {
        const callbacks: RuntimeCallbacks = {
            onLog:   (data) => entry!.members.forEach(m => m.onLog(data)),
            onError: (data) => entry!.members.forEach(m => m.onError(data)),
            onReady: () => {
                entry!.ready = true;
                entry!.members.forEach(m => m.onReady());
            },
        };
        const runtime = new PyodideRuntime(callbacks, workerFactory, indexURL, timeoutMs);
        entry = { runtime, members: new Set(), ready: false };
        sessions.set(id, entry);
        entry.runtime.start();
    }
    entry.members.add(member);
    if (entry.ready) {
        queueMicrotask(() => member.onReady());
    }
    return new EditorHandle(entry.runtime);
}

/**
 * Remove a member from a session.
 * When the last member leaves, the runtime is terminated and the session is deleted.
 */
export function leaveSession(id: string, member: MemberCallbacks): void {
    const entry = sessions.get(id);
    if (!entry) return;
    entry.members.delete(member);
    if (entry.members.size === 0) {
        entry.runtime.terminate();
        sessions.delete(id);
    }
}
