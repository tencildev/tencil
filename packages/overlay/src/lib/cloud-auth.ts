import { computed, signal } from '@preact/signals';
import type { CloudSignIn, Viewer } from '@tencil/protocol';

/** Set while Tencil Cloud wants a sign-in before it serves this page. */
export const signInRequired = signal<{ signIn: CloudSignIn; reason?: string } | null>(null);
/** Who is signed in to Tencil Cloud (null for the local daemon). */
export const viewer = signal<Viewer | null>(null);
export const signingIn = signal(false);

/** Why this viewer can't pin or reply right now, if they can't. */
export const pinBlocked = computed(() => {
    if (signInRequired.value) return 'Sign in to Tencil Cloud to pin';
    if (viewer.value?.access === 'read') {
        return 'View only: you need write access to the repository to pin';
    }
    return null;
});

interface StoredToken {
    token: string;
    /** Epoch ms. */
    expiresAt: number;
}

/** Leave a minute of slack so a token doesn't expire between hello and use. */
const EXPIRY_SLACK_MS = 60_000;
const POPUP_FEATURES = 'popup,width=520,height=680';

/**
 * Tokens are kept per Tencil Cloud host in the page's localStorage, so a
 * reviewer stays signed in across reloads of a preview. They're short-lived and
 * only valid for one project; preview URLs change per deployment, and the
 * sign-in popup closes by itself while the Tencil Cloud session lasts.
 */
function storageKey(bridgeUrl: string): string {
    return `tencil-cloud-token:${new URL(bridgeUrl).host}`;
}

export function storedToken(bridgeUrl: string, now = Date.now()): string | undefined {
    try {
        const raw = localStorage.getItem(storageKey(bridgeUrl));
        if (!raw) return undefined;
        const stored = JSON.parse(raw) as StoredToken;
        if (typeof stored.token === 'string' && stored.expiresAt - EXPIRY_SLACK_MS > now) {
            return stored.token;
        }
        localStorage.removeItem(storageKey(bridgeUrl));
    } catch {
        // Storage can be off (privacy modes); signing in then lasts for this page.
    }
    return memoryToken?.bridgeUrl === bridgeUrl && memoryToken.expiresAt - EXPIRY_SLACK_MS > now
        ? memoryToken.token
        : undefined;
}

let memoryToken: (StoredToken & { bridgeUrl: string }) | undefined;

function storeToken(bridgeUrl: string, token: StoredToken): void {
    memoryToken = { ...token, bridgeUrl };
    try {
        localStorage.setItem(storageKey(bridgeUrl), JSON.stringify(token));
    } catch {
        // Kept in memory instead.
    }
}

export function forgetToken(bridgeUrl: string): void {
    memoryToken = undefined;
    try {
        localStorage.removeItem(storageKey(bridgeUrl));
    } catch {
        // Nothing stored.
    }
}

/**
 * Sign in to Tencil Cloud in a popup: authorization code with PKCE, so the
 * overlay needs no secret and an intercepted code is useless. Tencil Cloud's
 * callback page posts the code back (`tencil:oauth`); we trade it for a token.
 */
export async function signIn(bridgeUrl: string, config: CloudSignIn): Promise<void> {
    // Open before any await: browsers only allow popups straight from the click.
    const popup = window.open('about:blank', 'tencil-sign-in', POPUP_FEATURES);
    if (!popup) throw new Error('The sign-in window was blocked. Allow popups for this page.');
    const verifier = randomString(64);
    const state = randomString(32);
    const authorize = new URL(config.authorizeUrl);
    authorize.search = new URLSearchParams({
        response_type: 'code',
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        code_challenge: await challengeFor(verifier),
        code_challenge_method: 'S256',
        state,
        ...(config.scope ? { scope: config.scope } : {}),
    }).toString();
    popup.location.href = authorize.toString();

    signingIn.value = true;
    try {
        const code = await codeFrom(popup, new URL(config.redirectUri).origin, state);
        const response = await fetch(config.tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: config.clientId,
                redirect_uri: config.redirectUri,
                code_verifier: verifier,
                code,
            }),
        });
        if (!response.ok) throw new Error(`Tencil Cloud refused the sign-in (${response.status})`);
        const body = (await response.json()) as { access_token?: string; expires_in?: number };
        if (!body.access_token) throw new Error('Tencil Cloud sent no token');
        storeToken(bridgeUrl, {
            token: body.access_token,
            expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
        });
    } finally {
        signingIn.value = false;
    }
}

/** Wait for the callback page in `popup` to post the code for `state`. */
function codeFrom(popup: Window, origin: string, state: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const closed = setInterval(() => {
            if (!popup.closed) return;
            cleanup();
            reject(new Error('Sign-in was cancelled'));
        }, 500);
        const onMessage = (event: MessageEvent) => {
            if (event.origin !== origin || event.source !== popup) return;
            const data = event.data as {
                type?: string;
                code?: string;
                state?: string;
                error?: string;
            };
            if (data?.type !== 'tencil:oauth' || data.state !== state) return;
            cleanup();
            popup.close();
            if (data.code) resolve(data.code);
            else reject(new Error(data.error ?? 'Sign-in failed'));
        };
        const cleanup = () => {
            clearInterval(closed);
            window.removeEventListener('message', onMessage);
        };
        window.addEventListener('message', onMessage);
    });
}

export async function challengeFor(verifier: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return base64Url(new Uint8Array(digest));
}

function randomString(bytes: number): string {
    return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

function base64Url(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
