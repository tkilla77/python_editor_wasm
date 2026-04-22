/**
 * StorageManager — singleton that manages the active storage backend for
 * exercise state (local localStorage vs Google Drive vs OneDrive).
 *
 * Usage:
 *   const mgr = StorageManager.instance;
 *   mgr.adapter  // implements StateAdapter; swap transparent to consumers
 *
 * Backend selection is persisted in localStorage under 'bottom:storage-backend'.
 * Client IDs and the callback URL are baked in at build time via Vite env vars:
 *   VITE_GOOGLE_CLIENT_ID, VITE_MICROSOFT_CLIENT_ID, VITE_OAUTH_CALLBACK_URL
 * (see .env for production, .env.local for local dev with a separate OAuth app)
 *
 * Migration: when switching backends, all states are exported from the old
 * backend and imported into the new one (merge, not overwrite).
 *
 * Fires a 'bottom-storage-change' CustomEvent on window when the active
 * backend changes, so UI components can update.
 */

import { LocalStorageAdapter, type ExerciseState, type StateAdapter } from './exercise-state.js';
import { startOAuth, handleOAuthReturn, type OAuthConfig, type TokenResponse } from './oauth.js';
import { GoogleDriveAdapter, type GoogleTokens } from './adapters/google-drive.js';
import { OneDriveAdapter, type MicrosoftTokens } from './adapters/microsoft-graph.js';

export type BackendId = 'local' | 'google' | 'microsoft';

const LS_BACKEND_KEY      = 'bottom:storage-backend';
const LS_GOOGLE_TOKENS    = 'bottom:google-tokens';
const LS_MICROSOFT_TOKENS = 'bottom:microsoft-tokens';

// ── Build-time client IDs (set via .env / .env.local) ────────────────────────

const GOOGLE_CLIENT_ID     = import.meta.env.VITE_GOOGLE_CLIENT_ID     ?? '';
const GOOGLE_CLIENT_SECRET = import.meta.env.VITE_GOOGLE_CLIENT_SECRET ?? '';
const MICROSOFT_CLIENT_ID  = import.meta.env.VITE_MICROSOFT_CLIENT_ID  ?? '';

// ── Provider configs ──────────────────────────────────────────────────────────

const GOOGLE_CONFIG: OAuthConfig = {
    authUrl:      'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl:     'https://oauth2.googleapis.com/token',
    clientId:     GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    scope:        'https://www.googleapis.com/auth/drive.appdata',
    // 'consent' forces Google to always issue a refresh token, even on re-auth.
    prompt:       'select_account consent',
};

const MICROSOFT_CONFIG: OAuthConfig = {
    authUrl:   'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl:  'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    clientId:  MICROSOFT_CLIENT_ID,
    scope:     'offline_access Files.ReadWrite.AppFolder',
};

// ── Adapter union with exportAll / importAll ──────────────────────────────────

interface MigratingAdapter extends StateAdapter {
    exportAll(): Promise<Record<string, ExerciseState>>;
    importAll(map: Record<string, ExerciseState>): Promise<void>;
}

class MigratingLocalAdapter extends LocalStorageAdapter implements MigratingAdapter {
    async exportAll(): Promise<Record<string, ExerciseState>> {
        const all = await this.list();
        return Object.fromEntries(all.map(s => [s.exerciseId, s]));
    }
    async importAll(map: Record<string, ExerciseState>): Promise<void> {
        for (const [id, state] of Object.entries(map)) {
            // Only import keys that don't exist locally yet.
            const existing = await this.load(id);
            if (!existing) await this.save(id, state);
        }
    }
}

// ── StorageManager ────────────────────────────────────────────────────────────

export class StorageManager {
    private static _instance: StorageManager | null = null;
    static get instance(): StorageManager {
        if (!StorageManager._instance) StorageManager._instance = new StorageManager();
        return StorageManager._instance;
    }

    private _backend: BackendId = 'local';
    private _adapter: MigratingAdapter = new MigratingLocalAdapter();

    private constructor() {
        const saved = localStorage.getItem(LS_BACKEND_KEY) as BackendId | null;
        if (saved && saved !== 'local') {
            // Restore token-based adapter without triggering migration.
            this._tryRestoreAdapter(saved);
        }
    }

    get backend(): BackendId { return this._backend; }
    get adapter(): StateAdapter { return this._adapter; }

    /** True if a given backend has stored credentials. */
    isConnected(backend: BackendId): boolean {
        if (backend === 'google')    return !!localStorage.getItem(LS_GOOGLE_TOKENS);
        if (backend === 'microsoft') return !!localStorage.getItem(LS_MICROSOFT_TOKENS);
        return true; // local is always "connected"
    }

    // ── Restore from stored tokens (no migration) ─────────────────────────────

    private _tryRestoreAdapter(backend: BackendId): void {
        try {
            if (backend === 'google') {
                const raw = localStorage.getItem(LS_GOOGLE_TOKENS);
                if (!raw) return;
                const tokens: GoogleTokens = JSON.parse(raw);
                const config = this._googleConfig();
                if (!config) return;
                this._adapter = new GoogleDriveAdapter(tokens, config);
                this._backend = 'google';
            } else if (backend === 'microsoft') {
                const raw = localStorage.getItem(LS_MICROSOFT_TOKENS);
                if (!raw) return;
                const tokens: MicrosoftTokens = JSON.parse(raw);
                const config = this._microsoftConfig();
                if (!config) return;
                this._adapter = new OneDriveAdapter(tokens, config);
                this._backend = 'microsoft';
            }
        } catch {
            // Corrupted tokens — stay on local.
        }
    }

    // ── Config helpers ────────────────────────────────────────────────────────

    private _googleConfig(): OAuthConfig | null {
        if (!GOOGLE_CLIENT_ID) { console.warn('VITE_GOOGLE_CLIENT_ID not set at build time'); return null; }
        return GOOGLE_CONFIG;
    }

    private _microsoftConfig(): OAuthConfig | null {
        if (!MICROSOFT_CLIENT_ID) { console.warn('VITE_MICROSOFT_CLIENT_ID not set at build time'); return null; }
        return MICROSOFT_CONFIG;
    }

    // ── OAuth flow ────────────────────────────────────────────────────────────

    /**
     * Start the OAuth login for the given backend.
     * Triggers popup / redirect. On success, sets the adapter and migrates data.
     */
    /**
     * Start the OAuth flow for the given backend.
     * Stores the backend choice in sessionStorage, then navigates away.
     * This never resolves — the page reloads on return and handleReturn() finishes.
     */
    async connect(backend: 'google' | 'microsoft'): Promise<never> {
        const config = backend === 'google' ? this._googleConfig() : this._microsoftConfig();
        if (!config) throw new Error(`${backend} client ID not configured`);
        sessionStorage.setItem('bottom:oauth:backend', backend);
        return startOAuth(config);
    }

    /** Called on every page load to finish a redirect-based OAuth flow. */
    async handleReturn(): Promise<boolean> {
        const token = await handleOAuthReturn();
        if (!token) return false;

        // Which backend was pending? Read from sessionStorage hint set by startOAuth.
        const pendingBackend = sessionStorage.getItem('bottom:oauth:backend') as 'google' | 'microsoft' | null;
        sessionStorage.removeItem('bottom:oauth:backend');

        if (!pendingBackend) return false;
        const config = pendingBackend === 'google' ? this._googleConfig() : this._microsoftConfig();
        if (!config) return false;

        await this._applyTokens(pendingBackend, config, token, /* migrate */ true);
        return true;
    }

    private async _applyTokens(
        backend: 'google' | 'microsoft',
        config: OAuthConfig,
        tr: TokenResponse,
        migrate: boolean,
    ): Promise<void> {
        const expiresAt = Date.now() + tr.expires_in * 1000;

        let newAdapter: MigratingAdapter;
        if (backend === 'google') {
            const tokens: GoogleTokens = {
                accessToken:  tr.access_token,
                refreshToken: tr.refresh_token,
                expiresAt,
            };
            localStorage.setItem(LS_GOOGLE_TOKENS, JSON.stringify(tokens));
            newAdapter = new GoogleDriveAdapter(tokens, config);
        } else {
            const tokens: MicrosoftTokens = {
                accessToken:  tr.access_token,
                refreshToken: tr.refresh_token,
                expiresAt,
            };
            localStorage.setItem(LS_MICROSOFT_TOKENS, JSON.stringify(tokens));
            newAdapter = new OneDriveAdapter(tokens, config);
        }

        if (migrate && this._backend !== backend) {
            await this._migrate(this._adapter, newAdapter);
        }

        this._adapter = newAdapter;
        this._backend = backend;
        localStorage.setItem(LS_BACKEND_KEY, backend);
        this._dispatchChange();
    }

    // ── Disconnect ────────────────────────────────────────────────────────────

    /** Disconnect a cloud backend and revert to local storage. */
    disconnect(backend: 'google' | 'microsoft'): void {
        if (backend === 'google')    localStorage.removeItem(LS_GOOGLE_TOKENS);
        if (backend === 'microsoft') localStorage.removeItem(LS_MICROSOFT_TOKENS);

        if (this._backend === backend) {
            this._adapter = new MigratingLocalAdapter();
            this._backend = 'local';
            localStorage.setItem(LS_BACKEND_KEY, 'local');
            this._dispatchChange();
        }
    }

    // ── Migration ─────────────────────────────────────────────────────────────

    /** Copy all states from `from` into `to`, without overwriting existing keys in `to`. */
    private async _migrate(from: MigratingAdapter, to: MigratingAdapter): Promise<void> {
        try {
            const exported = await from.exportAll();
            await to.importAll(exported);
        } catch (err) {
            console.warn('Storage migration failed:', err);
        }
    }

    // ── Events ────────────────────────────────────────────────────────────────

    private _dispatchChange(): void {
        window.dispatchEvent(new CustomEvent('bottom-storage-change', {
            detail: { backend: this._backend },
        }));
    }
}

// ── handleOAuthReturn on page load ────────────────────────────────────────────

/**
 * Call once on page load (before any components are used).
 * Detects a pending OAuth redirect and completes the flow.
 */
export async function initStorageManager(): Promise<void> {
    await StorageManager.instance.handleReturn();
}
