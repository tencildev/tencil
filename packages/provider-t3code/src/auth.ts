import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const DEFAULT_T3_URL = 'http://127.0.0.1:3773';

/** Scopes Fixhere needs: read thread state and launch/steer threads. */
const SCOPES = 'orchestration:read orchestration:operate';

export interface StoredCredential {
    token: string;
    scope: string;
    expiresAt: string;
}

export interface PairingTarget {
    baseUrl: string;
    credential: string;
}

/**
 * Accepts what T3 Code hands out in Settings → Connections or `t3 pair`:
 * a pairing URL (`http://host:3773/pair#token=…`, token may also be in the
 * query string) or a bare pairing code combined with `fallbackBaseUrl`.
 */
export function parsePairingInput(input: string, fallbackBaseUrl: string): PairingTarget {
    const trimmed = input.trim();
    if (!/^https?:\/\//i.test(trimmed)) {
        if (!trimmed) throw new Error('Pairing code is empty');
        return { baseUrl: normalizeBaseUrl(fallbackBaseUrl), credential: trimmed };
    }
    const url = new URL(trimmed);
    const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
    const credential = hash.get('token')?.trim() || url.searchParams.get('token')?.trim();
    if (!credential) throw new Error('Pairing link has no token. Copy the full link from T3 Code.');
    // Hosted pairing links carry the real backend in `host`.
    const hostedBackend = url.searchParams.get('host')?.trim();
    return {
        baseUrl: normalizeBaseUrl(hostedBackend || url.origin),
        credential,
    };
}

export function normalizeBaseUrl(raw: string): string {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`);
    return url.origin;
}

export async function exchangePairingCredential(
    target: PairingTarget,
    clientLabel = 'Fixhere',
): Promise<StoredCredential> {
    const body = new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: target.credential,
        subject_token_type: 'urn:t3:params:oauth:token-type:environment-bootstrap',
        requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        scope: SCOPES,
        client_label: clientLabel,
        client_device_type: 'desktop',
    });
    const response = await fetch(`${target.baseUrl}/oauth/token`, {
        signal: AbortSignal.timeout(15_000),
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
    });
    if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
            error?: string;
            error_description?: string;
        } | null;
        const reason = body?.error_description ?? body?.error;
        throw new Error(
            `T3 Code rejected the pairing code (${response.status}${reason ? `: ${reason}` : ''}). ` +
                'Codes work once and expire after about 5 minutes; use the `Token:` value, not the link id.',
        );
    }
    const result = (await response.json()) as {
        access_token: string;
        token_type: string;
        expires_in: number;
        scope: string;
    };
    if (result.token_type !== 'Bearer') {
        throw new Error(`Unsupported token type "${result.token_type}"`);
    }
    return {
        token: result.access_token,
        scope: result.scope,
        expiresAt: new Date(Date.now() + result.expires_in * 1000).toISOString(),
    };
}

/**
 * Mint a pairing code on a local T3 Code by running the `t3` CLI that matches
 * the server's own version (mismatched CLIs may migrate the database).
 * Returns undefined when the server isn't local or the CLI fails.
 */
export async function createLocalPairingCode(
    baseUrl: string,
    baseDir = process.env.T3CODE_HOME ?? join(homedir(), '.t3'),
): Promise<string | undefined> {
    const { hostname } = new URL(baseUrl);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(hostname)) return undefined;
    const response = await fetch(new URL('/.well-known/t3/environment', baseUrl), {
        signal: AbortSignal.timeout(8_000),
    }).catch(() => null);
    if (!response?.ok) return undefined;
    const { serverVersion } = (await response.json()) as { serverVersion?: string };
    if (!serverVersion) return undefined;
    const { spawnSync } = await import('node:child_process');
    const args = ['auth', 'pairing', 'create', '--base-dir', baseDir];
    // T3 Code installs its runtime here (desktop app, SSH launch); fall back to npm.
    const installed = join(baseDir, 'runtime', 'versions', serverVersion, 't3');
    const result = existsSync(installed)
        ? spawnSync(installed, args, { encoding: 'utf8', timeout: 30_000 })
        : spawnSync(
              process.platform === 'win32' ? 'npx.cmd' : 'npx',
              ['-y', `t3@${serverVersion}`, ...args],
              // Windows needs a shell to run .cmd shims.
              { encoding: 'utf8', timeout: 120_000, shell: process.platform === 'win32' },
          );
    return `${result.stdout ?? ''}\n${result.stderr ?? ''}`.match(/^Token:\s*(\S+)/m)?.[1];
}

export async function requestWebSocketTicket(
    baseUrl: string,
    token: string,
    timeoutMs = 8_000,
): Promise<string> {
    const response = await fetch(`${baseUrl}/api/auth/websocket-ticket`, {
        signal: AbortSignal.timeout(timeoutMs),
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
    });
    if (response.status === 401 || response.status === 403) throw new UnauthorizedError();
    if (!response.ok) throw new Error(`WebSocket ticket request failed (${response.status})`);
    const { ticket } = (await response.json()) as { ticket: string };
    return ticket;
}

export class UnauthorizedError extends Error {
    constructor() {
        super('T3 Code rejected the stored token. Run `fixhere connect` to pair again.');
        this.name = 'UnauthorizedError';
    }
}

interface CredentialFile {
    /** Server most recently paired with; used when no URL is configured. */
    lastBaseUrl?: string;
    servers: Record<string, StoredCredential>;
}

/** Credentials live outside the project so they never end up in git. */
export class CredentialStore {
    constructor(
        readonly path = join(
            process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'),
            'fixhere',
            'credentials.json',
        ),
    ) {}

    async get(baseUrl: string): Promise<StoredCredential | undefined> {
        const file = await this.#read();
        const credential = file.servers[credentialKey(baseUrl)];
        if (!credential) return undefined;
        if (Date.parse(credential.expiresAt) <= Date.now()) return undefined;
        return credential;
    }

    async lastBaseUrl(): Promise<string | undefined> {
        return (await this.#read()).lastBaseUrl;
    }

    async set(baseUrl: string, credential: StoredCredential): Promise<void> {
        const file = await this.#read();
        file.servers[credentialKey(baseUrl)] = credential;
        file.lastBaseUrl = normalizeBaseUrl(baseUrl);
        await mkdir(dirname(this.path), { recursive: true });
        await writeFile(this.path, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
        await chmod(this.path, 0o600);
    }

    async #read(): Promise<CredentialFile> {
        try {
            const parsed = JSON.parse(await readFile(this.path, 'utf8')) as Partial<CredentialFile>;
            return { lastBaseUrl: parsed.lastBaseUrl, servers: parsed.servers ?? {} };
        } catch {
            return { servers: {} };
        }
    }
}

/** `localhost`, `127.0.0.1` and `[::1]` reach the same server; share one credential. */
function credentialKey(baseUrl: string): string {
    const url = new URL(normalizeBaseUrl(baseUrl));
    if (
        url.hostname === 'localhost' ||
        url.hostname === '[::1]' ||
        url.hostname.startsWith('127.')
    ) {
        url.hostname = '127.0.0.1';
    }
    return url.origin;
}

export interface T3ProjectSummary {
    id: string;
    title: string;
    workspaceRoot: string;
}

/**
 * The T3 Code projects on this machine, for the "which project is this
 * page?" picker. Uses the paired token; returns [] when not paired or offline.
 */
export async function listT3Projects(
    options: { baseUrl?: string; credentials?: CredentialStore; token?: string } = {},
): Promise<T3ProjectSummary[]> {
    const credentials = options.credentials ?? new CredentialStore();
    const baseUrl = normalizeBaseUrl(
        options.baseUrl ?? (await credentials.lastBaseUrl()) ?? DEFAULT_T3_URL,
    );
    const token = options.token ?? (await credentials.get(baseUrl))?.token;
    if (!token) return [];
    try {
        const response = await fetch(`${baseUrl}/api/orchestration/shell`, {
            signal: AbortSignal.timeout(8_000),
            headers: { authorization: `Bearer ${token}`, 'x-t3-orchestration-protocol': '2' },
        });
        if (!response.ok) return [];
        const shell = (await response.json()) as { projects: T3ProjectSummary[] };
        return shell.projects.map(({ id, title, workspaceRoot }) => ({ id, title, workspaceRoot }));
    } catch {
        return [];
    }
}
