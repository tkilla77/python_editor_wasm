export type ExerciseStatus = 'pristine' | 'started' | 'attempted' | 'solved' | 'viewed-solution';

export interface ExerciseState {
    exerciseId: string;
    status: ExerciseStatus;
    code: string;
    attempts: number;
    solvedAt?: number; // ms timestamp
}

export interface StateAdapter {
    load(exerciseId: string): Promise<ExerciseState | null>;
    save(exerciseId: string, state: ExerciseState): Promise<void>;
    list(): Promise<ExerciseState[]>;
}

const LS_PREFIX = 'bottom-exercise:';

export class LocalStorageAdapter implements StateAdapter {
    async load(exerciseId: string): Promise<ExerciseState | null> {
        try {
            const raw = localStorage.getItem(LS_PREFIX + exerciseId);
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    }

    async save(exerciseId: string, state: ExerciseState): Promise<void> {
        try {
            localStorage.setItem(LS_PREFIX + exerciseId, JSON.stringify(state));
        } catch {}
    }

    async list(): Promise<ExerciseState[]> {
        const results: ExerciseState[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key?.startsWith(LS_PREFIX)) {
                try {
                    const raw = localStorage.getItem(key);
                    if (raw) results.push(JSON.parse(raw));
                } catch {}
            }
        }
        return results;
    }
}
