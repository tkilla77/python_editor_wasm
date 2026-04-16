/**
 * OneDrive StateAdapter — stores all exercise state in a single JSON file
 * at the root of the app-specific special folder (approot).
 *
 * Uses the Microsoft Graph API with the Files.ReadWrite.AppFolder scope.
 * The folder is only accessible to this application.
 */

import type { ExerciseState, StateAdapter } from '../exercise-state.js';
import { refreshAccessToken, type OAuthConfig, type TokenResponse } from '../oauth.js';

const FILE_NAME = 'bottom-state.json';
const ITEM_PATH = `special/approot:/${FILE_NAME}`;

export interface MicrosoftTokens {
    accessToken: string;
    refreshToken?: string;
    expiresAt: number; // ms epoch
}

export class OneDriveAdapter implements StateAdapter {
    private _tokens: MicrosoftTokens;
    private _config: OAuthConfig;

    constructor(tokens: MicrosoftTokens, config: OAuthConfig) {
        this._tokens = tokens;
        this._config = config;
    }

    // ── Auth ─────────────────────────────────────────────────────────────────

    private async _accessToken(): Promise<string> {
        if (Date.now() < this._tokens.expiresAt - 60_000) {
            return this._tokens.accessToken;
        }
        if (!this._tokens.refreshToken) throw new Error('Microsoft: no refresh token');
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
            'Content-Type': 'application/json',
        };
    }

    // ── File helpers ──────────────────────────────────────────────────────────

    private get _fileUrl(): string {
        return `https://graph.microsoft.com/v1.0/me/drive/${ITEM_PATH}:/content`;
    }

    /** Read the full state map, or empty map if file not found. */
    private async _readAll(): Promise<Record<string, ExerciseState>> {
        const res = await fetch(this._fileUrl, { headers: await this._headers() });
        if (res.status === 404 || res.status === 400) return {}; // 400 = approot not yet initialised
        if (!res.ok) throw new Error(`OneDrive read failed: ${res.status}`);
        try { return await res.json(); } catch { return {}; }
    }

    /** Write the full state map back (PUT creates or replaces). */
    private async _writeAll(map: Record<string, ExerciseState>): Promise<void> {
        const headers = await this._headers();
        // GET special/approot provisions the app folder if it doesn't exist yet;
        // without this, the first PUT returns 400 on a fresh account.
        await fetch('https://graph.microsoft.com/v1.0/me/drive/special/approot', { headers });
        const body = JSON.stringify(map);
        // Retry up to 3× on 503 "pending provisioning" (transient on new accounts).
        for (let attempt = 0; attempt < 3; attempt++) {
            if (attempt > 0) await new Promise(r => setTimeout(r, 2000 * attempt));
            const res = await fetch(this._fileUrl, { method: 'PUT', headers, body });
            if (res.ok) return;
            const text = await res.text();
            if (res.status !== 503) throw new Error(`OneDrive write failed: ${res.status} ${text}`);
            if (attempt === 2)      throw new Error(`OneDrive write failed after retries: ${text}`);
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
