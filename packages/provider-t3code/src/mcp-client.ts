import { createHash, randomBytes } from 'node:crypto';
import type { CredentialStore, StoredCredential } from './auth.ts';

/**
 * Minimal client for T3 Code's `/mcp` (Streamable HTTP, JSON-RPC). It's the
 * only part of T3 Code that reaches the machines it links to, so Tencil uses
 * it for threads on those; everything local stays on the WebSocket.
 *
 * Signing in needs no click: a pairing code minted by the local `t3` CLI
 * approves an MCP OAuth request, the same way T3 Code links two machines.
 */

const PROTOCOL_VERSION = '2025-06-18';
/** Never served; T3 Code answers the decision with JSON, so nothing has to listen. */
const REDIRECT_URI = 'http://127.0.0.1/tencil-callback';
/** After a failed sign-in, wait this long before running the `t3` CLI again. */
const SIGN_IN_RETRY_MS = 5 * 60_000;

export interface McpClientOptions {
    baseUrl: string;
    credentials: CredentialStore;
    /** Mints a pairing code on the local T3 Code, or undefined when it can't. */
    createPairingCode: (baseUrl: string) => Promise<string | undefined>;
    timeoutMs?: number;
    log?: (message: string) => void;
}

/** A tool answered with an error, e.g. `capability_denied` when linking is off. */
export class McpToolError extends Error {
    constructor(
        message: string,
        readonly code?: string,
    ) {
        super(message);
        this.name = 'McpToolError';
    }
}

class HttpStatusError extends Error {
    constructor(readonly status: number) {
        super(`T3 Code's MCP returned ${status}`);
    }
}

export class McpClient {
    readonly #options: McpClientOptions;
    #token: Promise<string> | undefined;
    #session: Promise<string> | undefined;
    #signInFailure: { error: Error; at: number } | undefined;
    #nextId = 1;

    constructor(options: McpClientOptions) {
        this.#options = options;
    }

    get baseUrl(): string {
        return this.#options.baseUrl;
    }

    /** Calls a tool and returns its structured result. */
    async call<T>(tool: string, args: Record<string, unknown>): Promise<T> {
        const result = await this.#withSession(session =>
            this.#rpc(session, 'tools/call', { name: tool, arguments: args }),
        );
        const { isError, structuredContent, content } = result as {
            isError?: boolean;
            structuredContent?: unknown;
            content?: Array<{ type: string; text?: string }>;
        };
        const text = content?.find(part => part.type === 'text')?.text;
        if (isError) {
            const failure = parseJson<{ code?: string; message?: string }>(text);
            throw new McpToolError(failure?.message ?? text ?? `${tool} failed`, failure?.code);
        }
        return (structuredContent ?? parseJson(text)) as T;
    }

    /** Runs `run` on a session, signing in again on 401 and reopening on 404 once each. */
    async #withSession(run: (session: string) => Promise<unknown>): Promise<unknown> {
        for (let attempt = 0; ; attempt++) {
            try {
                return await run(await this.#openSession());
            } catch (error) {
                if (!(error instanceof HttpStatusError) || attempt > 0) throw error;
                this.#session = undefined;
                if (error.status === 401) {
                    this.#token = undefined;
                    await this.#options.credentials.setMcp(this.#options.baseUrl, undefined);
                } else if (error.status !== 404) {
                    throw error;
                }
            }
        }
    }

    #openSession(): Promise<string> {
        this.#session ??= this.#initialize().catch(error => {
            this.#session = undefined;
            throw error;
        });
        return this.#session;
    }

    async #initialize(): Promise<string> {
        const response = await this.#post(undefined, {
            jsonrpc: '2.0',
            id: 0,
            method: 'initialize',
            params: {
                protocolVersion: PROTOCOL_VERSION,
                capabilities: {},
                clientInfo: { name: 'tencil', version: '1' },
            },
        });
        const session = response.headers.get('mcp-session-id');
        await response.body?.cancel();
        if (!session) throw new Error("T3 Code's MCP didn't open a session");
        await this.#post(session, { jsonrpc: '2.0', method: 'notifications/initialized' }).then(r =>
            r.body?.cancel(),
        );
        return session;
    }

    async #rpc(session: string, method: string, params: unknown): Promise<unknown> {
        const id = this.#nextId++;
        const response = await this.#post(session, { jsonrpc: '2.0', id, method, params });
        const type = response.headers.get('content-type') ?? '';
        const body = await response.text();
        const messages = type.includes('text/event-stream')
            ? body
                  .split('\n')
                  .filter(line => line.startsWith('data:'))
                  .map(line => parseJson<JsonRpcMessage>(line.slice(5).trim()))
            : [parseJson<JsonRpcMessage>(body)];
        const reply = messages.find(message => message?.id === id);
        if (!reply) throw new Error(`T3 Code's MCP sent no answer to ${method}`);
        if (reply.error) throw new McpToolError(reply.error.message, String(reply.error.code));
        return reply.result;
    }

    async #post(session: string | undefined, body: unknown): Promise<Response> {
        const token = await this.#ensureToken();
        const response = await fetch(new URL('/mcp', this.#options.baseUrl), {
            method: 'POST',
            signal: AbortSignal.timeout(this.#options.timeoutMs ?? 30_000),
            headers: {
                'content-type': 'application/json',
                accept: 'application/json, text/event-stream',
                authorization: `Bearer ${token}`,
                ...(session ? { 'mcp-session-id': session } : {}),
            },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            await response.body?.cancel();
            throw new HttpStatusError(response.status);
        }
        return response;
    }

    #ensureToken(): Promise<string> {
        this.#token ??= this.#loadOrSignIn().catch(error => {
            this.#token = undefined;
            throw error;
        });
        return this.#token;
    }

    async #loadOrSignIn(): Promise<string> {
        const { baseUrl, credentials } = this.#options;
        const stored = await credentials.getMcp(baseUrl);
        if (stored) return stored.token;
        const failure = this.#signInFailure;
        if (failure && Date.now() - failure.at < SIGN_IN_RETRY_MS) throw failure.error;
        const credential = await this.#signIn().catch((error: unknown) => {
            const reason = error instanceof Error ? error : new Error(String(error));
            this.#signInFailure = { error: reason, at: Date.now() };
            throw reason;
        });
        this.#signInFailure = undefined;
        await credentials.setMcp(baseUrl, credential);
        this.#options.log?.(`Signed in to T3 Code's MCP at ${baseUrl}`);
        return credential.token;
    }

    /** Register, approve with a fresh pairing code, then trade the code for a token. */
    async #signIn(): Promise<StoredCredential> {
        const { baseUrl } = this.#options;
        const code = await this.#options.createPairingCode(baseUrl).catch(() => undefined);
        if (!code) throw new Error("Couldn't sign in to T3 Code to reach other machines");

        const registration = await this.#json<{ client_id: string }>('/oauth/mcp/register', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ client_name: 'Tencil', redirect_uris: [REDIRECT_URI] }),
        });
        const verifier = randomBytes(48).toString('base64url');
        const challenge = createHash('sha256').update(verifier).digest('base64url');
        const state = randomBytes(16).toString('base64url');
        const decision = await this.#json<{ redirectTo: string }>('/oauth/mcp/decision', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                authorization: {
                    response_type: 'code',
                    client_id: registration.client_id,
                    redirect_uri: REDIRECT_URI,
                    code_challenge: challenge,
                    code_challenge_method: 'S256',
                    state,
                },
                decision: { _tag: 'pairing-code', access: 'full-access', code },
            }),
        });
        const authorizationCode = new URL(decision.redirectTo).searchParams.get('code');
        if (!authorizationCode) throw new Error('T3 Code approved no MCP sign-in');
        const token = await this.#json<{ access_token: string; expires_in: number; scope: string }>(
            '/oauth/mcp/token',
            {
                method: 'POST',
                headers: { 'content-type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    grant_type: 'authorization_code',
                    code: authorizationCode,
                    redirect_uri: REDIRECT_URI,
                    client_id: registration.client_id,
                    code_verifier: verifier,
                }),
            },
        );
        return {
            token: token.access_token,
            scope: token.scope,
            expiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(),
        };
    }

    async #json<T>(path: string, init: RequestInit): Promise<T> {
        const response = await fetch(new URL(path, this.#options.baseUrl), {
            ...init,
            signal: AbortSignal.timeout(this.#options.timeoutMs ?? 30_000),
        });
        const body = (await response.json().catch(() => null)) as
            | (T & { message?: string; error_description?: string })
            | null;
        if (!response.ok || !body) {
            const reason = body?.message ?? body?.error_description;
            throw new Error(
                `T3 Code refused the MCP sign-in at ${path} (${response.status}${reason ? `: ${reason}` : ''})`,
            );
        }
        return body;
    }
}

interface JsonRpcMessage {
    id?: number;
    result?: unknown;
    error?: { code: number; message: string };
}

function parseJson<T>(text: string | undefined): T | undefined {
    if (!text) return undefined;
    try {
        return JSON.parse(text) as T;
    } catch {
        return undefined;
    }
}
