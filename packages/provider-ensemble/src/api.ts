import { randomUUID } from 'node:crypto';
import type { ProviderMessage, ThreadStatus } from '@tencildev/protocol';

export const DEFAULT_ENSEMBLE_URL = 'http://127.0.0.1:7434';

/** Where Ensemble's public API listens; `TENCIL_ENSEMBLE_URL` points elsewhere. */
export function ensembleUrl(): string {
    return process.env.TENCIL_ENSEMBLE_URL ?? DEFAULT_ENSEMBLE_URL;
}

export type EnsembleStatus = Exclude<ThreadStatus, 'draft' | 'starting'>;

export interface EnsembleChat {
    id: string;
    title: string;
    status: EnsembleStatus;
}

export interface EnsembleProject {
    id: string;
    name: string;
    source: { kind: 'local'; path: string } | { kind: 'git'; url: string };
}

export interface EnsembleThread {
    id: string;
    projectId: string;
    title: string;
    branch: string;
    state: string;
    status: EnsembleStatus;
    agent: string;
    machine: { id: string; name: string };
    chats: EnsembleChat[];
}

/** Ensemble sends the whole text every time; upsert by `id`. */
export type EnsembleMessage = Omit<ProviderMessage, 'createdAt'>;

export interface EnsembleStep {
    id: string;
    label: string;
    detail?: string;
    status: 'running' | 'done' | 'failed';
}

/** An image, base64 without the `data:` prefix. */
export interface EnsembleImage {
    name: string;
    mediaType: string;
    data: string;
}

export interface NewChat {
    title: string;
    prompt: string;
    attachments: EnsembleImage[];
    model?: string;
}

export interface NewThread extends NewChat {
    projectId: string;
}

export interface NewMessage {
    text: string;
    attachments: EnsembleImage[];
}

export type EnsembleEvent =
    | { type: 'thread'; threadId: string; thread: EnsembleThread }
    | {
          type: 'chat';
          threadId: string;
          chatId: string;
          title: string;
          status: EnsembleStatus;
          messages: EnsembleMessage[];
          steps: EnsembleStep[];
      }
    | { type: 'message'; threadId: string; chatId: string; message: EnsembleMessage }
    | { type: 'steps'; threadId: string; chatId: string; steps: EnsembleStep[] }
    | { type: 'status'; threadId: string; chatId: string; status: EnsembleStatus }
    | { type: 'archived'; threadId: string }
    | { type: 'ready' };

/** A feed event; `id` (live events only) resumes the feed right after it. */
export interface FeedEvent {
    id?: string;
    event: EnsembleEvent;
}

export class EnsembleHttpError extends Error {
    constructor(
        readonly status: number,
        reason: string,
    ) {
        super(`Ensemble returned ${status}: ${reason}`);
        this.name = 'EnsembleHttpError';
    }
}

/** The token is missing, or the user removed Tencil in Ensemble › Settings › Ensemble API. */
export class EnsembleUnauthorizedError extends EnsembleHttpError {
    constructor(reason: string) {
        super(401, reason);
        this.name = 'EnsembleUnauthorizedError';
    }
}

export interface EnsembleClientOptions {
    baseUrl?: string;
    token?: string;
    timeoutMs?: number;
}

interface RequestOptions {
    body?: unknown;
    auth?: boolean;
    timeoutMs?: number;
}

/** Ensemble's public local API. Every write carries an idempotency key. */
export class EnsembleClient {
    readonly baseUrl: string;
    readonly #token?: string;
    readonly #timeoutMs: number;

    constructor(options: EnsembleClientOptions = {}) {
        this.baseUrl = new URL(options.baseUrl ?? ensembleUrl()).origin;
        this.#token = options.token;
        this.#timeoutMs = options.timeoutMs ?? 10_000;
    }

    /** Whether the Ensemble app is running; this needs no token. */
    async isRunning(): Promise<boolean> {
        try {
            const about = await this.#request<{ name: string; api: number }>('GET', '', {
                auth: false,
                timeoutMs: 1_500,
            });
            return about.name === 'ensemble' && about.api === 1;
        } catch {
            return false;
        }
    }

    /** Ask the user to allow Tencil. Ensemble keeps the request open while it asks, up to 2 minutes. */
    async connect(): Promise<string> {
        const { token } = await this.#request<{ token: string }>('POST', 'connect', {
            body: { name: 'Tencil', access: 'work' },
            auth: false,
            timeoutMs: 125_000,
        });
        return token;
    }

    projects(): Promise<EnsembleProject[]> {
        return this.#request('GET', 'projects');
    }

    /**
     * Open threads; with `port`, only the one whose app listens on that port of this Mac,
     * with `project`, only that project's.
     */
    threads(filter: { port?: number; project?: string } = {}): Promise<EnsembleThread[]> {
        const query = new URLSearchParams();
        if (filter.port !== undefined) query.set('port', String(filter.port));
        if (filter.project !== undefined) query.set('project', filter.project);
        return this.#request('GET', query.size ? `threads?${query}` : 'threads');
    }

    /** A new thread in `projectId`, on its own branch; its first chat runs `prompt`. */
    createThread(thread: NewThread): Promise<EnsembleThread> {
        return this.#request('POST', 'threads', { body: thread });
    }

    thread(threadId: string): Promise<EnsembleThread> {
        return this.#request('GET', threadPath(threadId));
    }

    /** Saves the thread's work and conversation, and frees its machine. */
    archiveThread(threadId: string): Promise<void> {
        return this.#request('POST', `${threadPath(threadId)}/archive`, { body: {} });
    }

    /** Brings an archived thread back on a new machine with its saved work. */
    reopenThread(threadId: string): Promise<EnsembleThread> {
        return this.#request('POST', `${threadPath(threadId)}/reopen`, { body: {} });
    }

    createChat(threadId: string, chat: NewChat): Promise<EnsembleChat> {
        return this.#request('POST', `${threadPath(threadId)}/chats`, { body: chat });
    }

    /** Queues behind a running turn. */
    sendMessage(threadId: string, chatId: string, message: NewMessage): Promise<void> {
        return this.#request('POST', `${chatPath(threadId, chatId)}/messages`, { body: message });
    }

    stop(threadId: string, chatId: string): Promise<void> {
        return this.#request('POST', `${chatPath(threadId, chatId)}/stop`, { body: {} });
    }

    /**
     * A thread's events, every chat included, until the feed fails. Without `after` it
     * starts with the whole state. Ensemble pings every 15 s, so a feed silent for
     * `silenceMs` counts as dropped.
     */
    async *feed(
        threadId: string,
        options: { after?: string; signal: AbortSignal; silenceMs?: number },
    ): AsyncGenerator<FeedEvent> {
        const silenceMs = options.silenceMs ?? 45_000;
        const silent = new AbortController();
        let timer = setTimeout(() => silent.abort(), silenceMs);
        const heard = () => {
            clearTimeout(timer);
            timer = setTimeout(() => silent.abort(), silenceMs);
        };
        try {
            const response = await this.#fetch(
                'GET',
                `feed?thread=${encodeURIComponent(threadId)}`,
                {
                    headers: {
                        Accept: 'text/event-stream',
                        ...(options.after ? { 'Last-Event-ID': options.after } : {}),
                    },
                    signal: AbortSignal.any([options.signal, silent.signal]),
                },
            );
            if (!response.body) throw new Error('Ensemble sent an empty feed');
            for await (const message of serverSentEvents(response.body, heard)) {
                // Ensemble names the event in the data; an `event:` field only as a fallback.
                const data = JSON.parse(message.data);
                const type = data.type ?? message.event;
                if (type === 'error') {
                    throw new Error(`Ensemble ended the feed: ${data.error}`);
                }
                yield { id: message.id, event: { ...data, type } };
            }
            throw new Error('Ensemble closed the feed');
        } finally {
            clearTimeout(timer);
        }
    }

    async #request<T>(
        method: 'GET' | 'POST',
        path: string,
        options: RequestOptions = {},
    ): Promise<T> {
        const response = await this.#fetch(method, path, {
            auth: options.auth,
            headers: options.body === undefined ? {} : { 'Content-Type': 'application/json' },
            body: options.body === undefined ? undefined : JSON.stringify(options.body),
            signal: AbortSignal.timeout(options.timeoutMs ?? this.#timeoutMs),
        });
        if (response.status === 204) return undefined as T;
        return (await response.json()) as T;
    }

    async #fetch(
        method: 'GET' | 'POST',
        path: string,
        init: {
            auth?: boolean;
            headers: Record<string, string>;
            body?: string;
            signal: AbortSignal;
        },
    ): Promise<Response> {
        const response = await fetch(`${this.baseUrl}/v1${path ? `/${path}` : ''}`, {
            method,
            headers: {
                ...init.headers,
                ...(init.auth === false ? {} : { Authorization: `Bearer ${this.#token ?? ''}` }),
                ...(method === 'POST' ? { 'Idempotency-Key': randomUUID() } : {}),
            },
            body: init.body,
            signal: init.signal,
        });
        if (response.ok) return response;
        const { error } = (await response.json().catch(() => ({}))) as { error?: string };
        const reason = error ?? response.statusText;
        throw response.status === 401
            ? new EnsembleUnauthorizedError(reason)
            : new EnsembleHttpError(response.status, reason);
    }
}

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function threadPath(threadId: string): string {
    return `threads/${encodeURIComponent(threadId)}`;
}

function chatPath(threadId: string, chatId: string): string {
    return `${threadPath(threadId)}/chats/${encodeURIComponent(chatId)}`;
}

interface ServerSentEvent {
    event: string;
    id?: string;
    data: string;
}

/** Events from a text/event-stream body. `heard` runs on every chunk, pings included. */
async function* serverSentEvents(
    body: ReadableStream<Uint8Array>,
    heard: () => void,
): AsyncGenerator<ServerSentEvent> {
    let partial = '';
    let fields: { event?: string; id?: string; data: string[] } = { data: [] };
    for await (const chunk of body.pipeThrough(new TextDecoderStream())) {
        heard();
        const lines = (partial + chunk).split(/\r?\n/);
        partial = lines.pop() ?? '';
        for (const line of lines) {
            if (line === '') {
                if (fields.data.length) {
                    yield {
                        event: fields.event ?? 'message',
                        id: fields.id,
                        data: fields.data.join('\n'),
                    };
                }
                fields = { data: [] };
            } else if (!line.startsWith(':')) {
                const [field, value] = splitField(line);
                if (field === 'event') fields.event = value;
                else if (field === 'id') fields.id = value;
                else if (field === 'data') fields.data.push(value);
            }
        }
    }
}

/** `field: value`, without the one optional space after the colon. */
function splitField(line: string): [string, string] {
    const colon = line.indexOf(':');
    if (colon < 0) return [line, ''];
    return [line.slice(0, colon), line.slice(colon + 1).replace(/^ /, '')];
}
