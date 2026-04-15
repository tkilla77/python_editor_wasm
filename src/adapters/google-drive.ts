/**
 * Google Drive StateAdapter — stores all exercise state in a single JSON file
 * inside the app-specific hidden folder (drive.appdata scope).
 *
 * The file is invisible in the user's Google Drive UI and is deleted when the
 * user disconnects the app.
 */

import type { ExerciseState, StateAdapter } from '../exercise-state.js';
import { refreshAccessToken, type OAuthConfig, type TokenResponse } from '../oauth.js';

const FILE_NAME = 'bottom-state.json';
const FIELDS = 'files(id,name)';

export interface GoogleTokens {
    accessToken: string;
    refreshToken?: string;
    expiresAt: number; // ms epoch
}

export class GoogleDriveAdapter implements StateAdapter {
    private _tokens: GoogleTokens;
    private _config: OAuthConfig;
    /** Cached Drive file id for bottom-state.json (null = not found yet). */
    private _fileId: string | null | undefined = undefined; // undefined = not looked up yet

    constructor(tokens: GoogleTokens, config: OAuthConfig) {
        this._tokens = tokens;
        this._config = config;
    }

    // ── Auth ─────────────────────────────────────────────────────────────────

    private async _accessToken(): Promise<string> {
        if (Date.now() < this._tokens.expiresAt - 60_000) {
            return this._tokens.accessToken;
        }
        if (!this._tokens.refreshToken) throw new Error('Google: no refresh token');
        const tr: TokenResponse = await refreshAccessToken(this._config, this._tokens.refreshToken);
        this._tokens = {
            accessToken:  tr.access_token,
            refreshToken: tr.refresh_token ?? this._tokens.refreshToken,
            expiresAt:    Date.now() + tr.expires_in * 1000,
        };
        return this._tokens.accessToken;
    }

    private async _headers(): Promise<Record<string, string>> {
        return {
            Authorization: `Bearer ${await this._accessToken()}`,
        };
    }

    // ── File helpers ──────────────────────────────────────────────────────────

    /** Find the bottom-state.json file id, or null if it doesn't exist. */
    private async _findFile(): Promise<string | null> {
        if (this._fileId !== undefined) return this._fileId;
        const params = new URLSearchParams({
            spaces: 'appDataFolder',
            q:      `name='${FILE_NAME}'`,
            fields: FIELDS,
        });
        const res = await fetch(
            `https://www.googleapis.com/drive/v3/files?${params}`,
            { headers: await this._headers() },
        );
        if (!res.ok) throw new Error(`Drive list failed: ${res.status} ${await res.text()}`);
        const data = await res.json();
        this._fileId = data.files?.[0]?.id ?? null;
        return this._fileId;
    }

    /** Read the full state map from Drive, or empty map if no file. */
    private async _readAll(): Promise<Record<string, ExerciseState>> {
        const id = await this._findFile();
        if (!id) return {};
        const res = await fetch(
            `https://www.googleapis.com/drive/v3/files/${id}?alt=media`,
            { headers: await this._headers() },
        );
        if (!res.ok) throw new Error(`Drive read failed: ${res.status} ${await res.text()}`);
        try { return await res.json(); } catch { return {}; }
    }

    /** Write the full state map back to Drive (create or update). */
    private async _writeAll(map: Record<string, ExerciseState>): Promise<void> {
        const headers = await this._headers();
        const body = JSON.stringify(map);
        const id = await this._findFile();

        if (id) {
            // PATCH existing file
            const res = await fetch(
                `https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`,
                { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body },
            );
            if (!res.ok) throw new Error(`Drive write failed: ${res.status} ${await res.text()}`);
        } else {
            // POST new file in appDataFolder
            const meta = JSON.stringify({ name: FILE_NAME, parents: ['appDataFolder'] });
            const boundary = 'bottom_boundary';
            const multipart = [
                `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}`,
                `--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}`,
                `--${boundary}--`,
            ].join('\r\n');
            const res = await fetch(
                'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
                {
                    method: 'POST',
                    headers: { ...headers, 'Content-Type': `multipart/related; boundary=${boundary}` },
                    body: multipart,
                },
            );
            if (!res.ok) throw new Error(`Drive create failed: ${res.status} ${await res.text()}`);
            const created = await res.json();
            this._fileId = created.id;
        }
    }

    // ── StateAdapter ─────────────────────────────────────────────────────────

    async load(exerciseId: string): Promise<ExerciseState | null> {
        const map = await this._readAll();
        return map[exerciseId] ?? null;
    }

    async save(exerciseId: string, state: ExerciseState): Promise<void> {
        const map = await this._readAll();
        map[exerciseId] = state;
        await this._writeAll(map);
    }

    async list(): Promise<ExerciseState[]> {
        const map = await this._readAll();
        return Object.values(map);
    }

    /** Export all stored states (for migration to another backend). */
    async exportAll(): Promise<Record<string, ExerciseState>> {
        return this._readAll();
    }

    /** Import all states from a previous backend. */
    async importAll(map: Record<string, ExerciseState>): Promise<void> {
        const existing = await this._readAll();
        await this._writeAll({ ...map, ...existing });
    }
}
