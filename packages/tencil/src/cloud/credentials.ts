import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { defaultDataDir } from '../daemon/thread-store.ts';

export const DEFAULT_CLOUD_URL = 'https://cloud.tencil.dev';

/** Tencil Cloud's public CLI client (`GET /api/cli`). */
export const CliClient = z.object({
    clientId: z.string().min(1),
    deviceCodeUrl: z.string().url(),
    tokenUrl: z.string().url(),
    scope: z.string().default('cli'),
});
export type CliClient = z.infer<typeof CliClient>;

const Saved = z.object({
    version: z.literal(1),
    /** Tencil Cloud, e.g. https://cloud.tencil.dev. */
    url: z.string().url(),
    accessToken: z.string().min(1),
    refreshToken: z.string().optional(),
    /** Epoch ms. */
    expiresAt: z.number(),
});
type Saved = z.infer<typeof Saved>;

const TokenResponse = z.object({
    access_token: z.string().min(1),
    refresh_token: z.string().optional(),
    expires_in: z.number().optional(),
});
export type TokenResponse = z.infer<typeof TokenResponse>;

/** Refresh a minute early, so a token doesn't expire between the check and its use. */
const EXPIRY_SLACK_MS = 60_000;

export function cloudCredentialsPath(dataDir = defaultDataDir()): string {
    return join(dataDir, 'cloud.json');
}

export async function fetchCliClient(
    url: string,
    fetchImpl: typeof fetch = fetch,
): Promise<CliClient> {
    const response = await fetchImpl(new URL('/api/cli', url), {
        headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Tencil Cloud at ${url} answered ${response.status}`);
    const client = CliClient.parse(await response.json());
    // Codes and tokens only ever go to the Tencil Cloud this machine was pointed at,
    // whatever host it names (behind a proxy or a tunnel it may name its public one).
    const here = (endpoint: string) => {
        const { pathname, search } = new URL(endpoint);
        return new URL(`${pathname}${search}`, url).toString();
    };
    return {
        ...client,
        deviceCodeUrl: here(client.deviceCodeUrl),
        tokenUrl: here(client.tokenUrl),
    };
}

export function parseTokenResponse(body: unknown): TokenResponse {
    return TokenResponse.parse(body);
}

/**
 * The machine's Tencil Cloud sign-in (`tencil login`), kept next to
 * `settings.json` with mode 0600. Access tokens are short-lived; the refresh
 * token renews them.
 */
export class CloudCredentials {
    readonly path: string;
    readonly #fetch: typeof fetch;
    #refreshing: Promise<string> | undefined;

    constructor(options: { path?: string; fetch?: typeof fetch } = {}) {
        this.path = options.path ?? cloudCredentialsPath();
        this.#fetch = options.fetch ?? fetch;
    }

    async load(): Promise<Saved | undefined> {
        try {
            return Saved.parse(JSON.parse(await readFile(this.path, 'utf8')));
        } catch {
            return undefined;
        }
    }

    async save(url: string, tokens: TokenResponse, now = Date.now()): Promise<void> {
        const saved: Saved = {
            version: 1,
            url: url.replace(/\/+$/, ''),
            accessToken: tokens.access_token,
            ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
            expiresAt: now + (tokens.expires_in ?? 3600) * 1000,
        };
        await mkdir(dirname(this.path), { recursive: true });
        await writeFile(this.path, `${JSON.stringify(saved, null, 4)}\n`, { mode: 0o600 });
        await chmod(this.path, 0o600);
    }

    async clear(): Promise<void> {
        await rm(this.path, { force: true });
    }

    /** A live access token, refreshed when it's (nearly) expired; `force` refreshes regardless. */
    async token(options: { force?: boolean } = {}): Promise<string> {
        const saved = await this.load();
        if (!saved) throw new Error('Not signed in to Tencil Cloud. Run `npx tencil login`.');
        if (!options.force && saved.expiresAt - EXPIRY_SLACK_MS > Date.now())
            return saved.accessToken;
        // One refresh at a time: refresh tokens are single use.
        this.#refreshing ??= this.#refresh(saved).finally(() => {
            this.#refreshing = undefined;
        });
        return this.#refreshing;
    }

    async #refresh(saved: Saved): Promise<string> {
        if (!saved.refreshToken)
            throw new Error('Tencil Cloud sign-in expired. Run `npx tencil login`.');
        const client = await fetchCliClient(saved.url, this.#fetch);
        const response = await this.#fetch(client.tokenUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json',
            },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: saved.refreshToken,
                client_id: client.clientId,
                scope: client.scope,
            }),
        });
        if (!response.ok) throw new Error('Tencil Cloud sign-in expired. Run `npx tencil login`.');
        const tokens = parseTokenResponse(await response.json());
        await this.save(saved.url, {
            ...tokens,
            refresh_token: tokens.refresh_token ?? saved.refreshToken,
        });
        return tokens.access_token;
    }
}
