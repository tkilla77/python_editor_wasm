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
 * Join (or create) a named shared session.
 * Returns the shared PyodideRuntime.
 * If the session is already ready, member.onReady() is called asynchronously.
 */
export function joinSession(
    id: string,
    member: MemberCallbacks,
    workerFactory: () => Worker,
    indexURL?: string,
): PyodideRuntime {
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
        const runtime = indexURL
            ? new PyodideRuntime(callbacks, workerFactory, indexURL)
            : new PyodideRuntime(callbacks, workerFactory);
        entry = { runtime, members: new Set(), ready: false };
        sessions.set(id, entry);
        entry.runtime.start();
    }
    entry.members.add(member);
    if (entry.ready) {
        // Worker already ready — notify the late joiner on the next microtask so
        // the caller's firstUpdated() has a chance to finish first.
        queueMicrotask(() => member.onReady());
    }
    return entry.runtime;
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
