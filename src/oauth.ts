/**
 * OAuth 2.0 PKCE helpers for client-side cloud storage authentication.
 *
 * Flow:
 *  1. startOAuth(config) → stores verifier in sessionStorage, navigates away
 *  2. Provider redirects to oauth-callback.html which forwards code + state
 *     back to the originating page as oauth_code / oauth_state query params
 *  3. On return, handleOAuthReturn() detects those params, exchanges the code,
 *     and cleans the URL
 */

export interface OAuthConfig {
    authUrl: string;
    tokenUrl: string;
    clientId: string;
    scope: string;
    /**
     * Required by Google (and most providers) even for PKCE flows on web
     * application clients. Not truly secret for a public SPA — security comes
     * from PKCE + registered redirect URIs, not from this value being hidden.
     */
    clientSecret?: string;
    /** Defaults to OAUTH_CALLBACK_URL (the hosted relay page). */
    redirectUri?: string;
}

export interface TokenResponse {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type: string;
}

/**
 * Hosted relay page — the redirect URI registered with each OAuth provider.
 *
 * In production the built chunks sit next to oauth-callback.html in the same
 * directory, so import.meta.url correctly resolves stable/ vs latest/ at
 * runtime without any env var.
 *
 * In Vite's dev server source files are served at their source path
 * (e.g. /src/oauth.ts), so import.meta.url would wrongly resolve to
 * /src/oauth-callback.html. Instead we anchor to the origin root, where
 * Vite serves static files from the project root.
 *
 * Register these redirect URIs in the OAuth app (all in one registration):
 *   https://bottom.ch/editor/stable/oauth-callback.html
 *   https://bottom.ch/editor/latest/oauth-callback.html
 *   http://localhost:5173/oauth-callback.html
 */
export const OAUTH_CALLBACK_URL: string = import.meta.env.DEV
    ? new URL('/oauth-callback.html', location.origin).href
    : new URL('oauth-callback.html', import.meta.url).href;

const SS_PENDING_KEY = 'bottom:oauth:pending';

// ─── PKCE ────────────────────────────────────────────────────────────────────

function randomBytes(n: number): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(n));
}

function base64url(buf: ArrayBuffer | Uint8Array): string {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    return btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
    const verifier = base64url(randomBytes(32));
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return { verifier, challenge: base64url(digest) };
}

// ─── Auth URL ────────────────────────────────────────────────────────────────

export function buildAuthUrl(
    config: OAuthConfig,
    challenge: string,
    state: string,
): string {
    const p = new URLSearchParams({
        client_id:             config.clientId,
        response_type:         'code',
        redirect_uri:          config.redirectUri ?? OAUTH_CALLBACK_URL,
        scope:                 config.scope,
        state,
        code_challenge:        challenge,
        code_challenge_method: 'S256',
        access_type:           'offline',  // Google: request refresh token
        prompt:                'select_account',
    });
    return `${config.authUrl}?${p}`;
}

// ─── Token exchange ───────────────────────────────────────────────────────────

export async function exchangeCode(
    config: OAuthConfig,
    code: string,
    verifier: string,
): Promise<TokenResponse> {
    const body = new URLSearchParams({
        client_id:     config.clientId,
        grant_type:    'authorization_code',
        code,
        redirect_uri:  config.redirectUri ?? OAUTH_CALLBACK_URL,
        code_verifier: verifier,
        ...(config.clientSecret ? { client_secret: config.clientSecret } : {}),
    });
    const res = await fetch(config.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
    });
    if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
    return res.json();
}

export async function refreshAccessToken(
    config: OAuthConfig,
    refreshToken: string,
): Promise<TokenResponse> {
    const body = new URLSearchParams({
        client_id:     config.clientId,
        grant_type:    'refresh_token',
        refresh_token: refreshToken,
        ...(config.clientSecret ? { client_secret: config.clientSecret } : {}),
    });
    const res = await fetch(config.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
    });
    if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
    return res.json();
}

// ─── Main flow ───────────────────────────────────────────────────────────────

/**
 * Start the OAuth PKCE flow via a full-page redirect.
 * Stores the PKCE verifier in sessionStorage, then navigates to the provider.
 * This function never returns — the page navigates away.
 * On return (after the provider redirects back), call handleOAuthReturn().
 */
export async function startOAuth(config: OAuthConfig): Promise<never> {
    const { verifier, challenge } = await generatePKCE();
    const nonce = base64url(randomBytes(8));
    const state = JSON.stringify({ nonce, returnUrl: location.href });

    sessionStorage.setItem(SS_PENDING_KEY, JSON.stringify({
        verifier,
        tokenUrl:     config.tokenUrl,
        clientId:     config.clientId,
        clientSecret: config.clientSecret ?? '',
        redirectUri:  config.redirectUri ?? OAUTH_CALLBACK_URL,
        nonce,
    }));

    location.href = buildAuthUrl(config, challenge, btoa(state));
    return new Promise(() => {}) as Promise<never>;
}

/**
 * Call on every page load to detect and complete a pending OAuth redirect.
 * Returns the TokenResponse if this load is an OAuth return, or null otherwise.
 * Cleans up the URL (removes oauth_* params) on success.
 */
export async function handleOAuthReturn(): Promise<TokenResponse | null> {
    const params = new URLSearchParams(location.search);
    const code = params.get('oauth_code');
    const rawState = params.get('oauth_state');
    if (!code || !rawState) return null;

    const pending = sessionStorage.getItem(SS_PENDING_KEY);
    if (!pending) return null;
    sessionStorage.removeItem(SS_PENDING_KEY);

    const { verifier, tokenUrl, clientId, clientSecret, redirectUri, nonce } = JSON.parse(pending);

    // Verify nonce (best-effort)
    try {
        const state = JSON.parse(atob(rawState));
        if (state?.nonce !== nonce) throw new Error('nonce mismatch');
    } catch { /* allow */ }

    // Clean the URL
    const clean = new URL(location.href);
    clean.searchParams.delete('oauth_code');
    clean.searchParams.delete('oauth_state');
    history.replaceState({}, '', clean.toString());

    return exchangeCode({ authUrl: '', tokenUrl, clientId, clientSecret, redirectUri, scope: '' }, code, verifier);
}
