/**
 * Minimal client for T3 Code's WebSocket transport (Effect RPC, JSON
 * serialization). One JSON object per frame:
 *
 *   → {_tag:"Request", id, tag, payload, headers}
 *   ← {_tag:"Chunk", requestId, values}        (streams; must be Ack'ed)
 *   ← {_tag:"Exit", requestId, exit}           (end of request/stream)
 *
 * Pulling in `effect` + `@t3tools/contracts` would be the typed route, but
 * neither is published and the wire format is small enough to speak directly.
 */

type Exit =
    | { _tag: 'Success'; value: unknown }
    | { _tag: 'Failure'; cause: ReadonlyArray<CauseEntry> };

type CauseEntry =
    | { _tag: 'Fail'; error: unknown }
    | { _tag: 'Die'; defect: unknown }
    | { _tag: 'Interrupt' };

type ServerFrame =
    | { _tag: 'Chunk'; requestId: string; values: unknown[] }
    | { _tag: 'Exit'; requestId: string; exit: Exit }
    | { _tag: 'Defect'; defect: unknown }
    | { _tag: 'Pong' }
    | { _tag: 'ClientProtocolError'; error: unknown };

interface Pending {
    onChunk?: (value: unknown) => void;
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
}

export class RpcError extends Error {
    constructor(
        message: string,
        readonly tag?: string,
        readonly details?: unknown,
    ) {
        super(message);
        this.name = 'RpcError';
    }
}

const PING_INTERVAL_MS = 15_000;

export class RpcSocket {
    #ws: WebSocket;
    #nextId = 1;
    #pending = new Map<string, Pending>();
    #ping: ReturnType<typeof setInterval> | undefined;
    #closeListeners = new Set<(reason: string) => void>();

    private constructor(ws: WebSocket) {
        this.#ws = ws;
        ws.addEventListener('message', event => this.#onFrame(String(event.data)));
        ws.addEventListener('close', event => this.#onClose(event.reason || `code ${event.code}`));
        this.#ping = setInterval(() => this.#send({ _tag: 'Ping' }), PING_INTERVAL_MS);
    }

    /** Default for `request` when no timeout is passed. */
    requestTimeoutMs = 30_000;

    static open(url: string, timeoutMs = 10_000): Promise<RpcSocket> {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(url);
            const timer = setTimeout(() => {
                ws.close();
                reject(new RpcError(`Timed out connecting to ${redactTicket(url)}`));
            }, timeoutMs);
            ws.addEventListener('open', () => {
                clearTimeout(timer);
                resolve(new RpcSocket(ws));
            });
            ws.addEventListener('error', () => {
                clearTimeout(timer);
                reject(new RpcError(`Could not connect to ${redactTicket(url)}`));
            });
        });
    }

    get open(): boolean {
        return this.#ws.readyState === WebSocket.OPEN;
    }

    onClose(listener: (reason: string) => void): () => void {
        this.#closeListeners.add(listener);
        return () => this.#closeListeners.delete(listener);
    }

    /** Unary request; rejects after `timeoutMs` so a stalled server can't hang callers. */
    request<T>(tag: string, payload: unknown, timeoutMs = this.requestTimeoutMs): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            let timer: ReturnType<typeof setTimeout> | undefined;
            const id = this.#start(tag, payload, {
                resolve: value => {
                    clearTimeout(timer);
                    resolve(value as T);
                },
                reject: error => {
                    clearTimeout(timer);
                    reject(error);
                },
            });
            if (!id) {
                reject(new RpcError('Socket is closed'));
                return;
            }
            timer = setTimeout(() => {
                if (!this.#pending.delete(id)) return;
                this.#send({ _tag: 'Interrupt', requestId: id });
                reject(new RpcError(`${tag} timed out after ${timeoutMs / 1000}s`));
            }, timeoutMs);
        });
    }

    /**
     * Open a server stream. `onItem` receives every value; the returned promise
     * settles when the stream ends. Call the returned `cancel` to unsubscribe.
     */
    stream<T>(
        tag: string,
        payload: unknown,
        onItem: (item: T) => void,
    ): { done: Promise<void>; cancel: () => void } {
        let id: string | undefined;
        const done = new Promise<void>((resolve, reject) => {
            id = this.#start(tag, payload, {
                onChunk: onItem as (value: unknown) => void,
                resolve: () => resolve(),
                reject,
            });
            if (!id) reject(new RpcError('Socket is closed'));
        });
        return {
            done,
            cancel: () => {
                if (!id || !this.#pending.has(id)) return;
                this.#pending.delete(id);
                this.#send({ _tag: 'Interrupt', requestId: id });
            },
        };
    }

    close(): void {
        this.#ws.close(1000, 'client closed');
    }

    #start(tag: string, payload: unknown, pending: Pending): string | undefined {
        if (!this.open) return undefined;
        const id = String(this.#nextId++);
        this.#pending.set(id, pending);
        this.#send({ _tag: 'Request', id, tag, payload, headers: [] });
        return id;
    }

    #send(frame: unknown): void {
        if (this.open) this.#ws.send(JSON.stringify(frame));
    }

    #onFrame(raw: string): void {
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            return;
        }
        for (const frame of (Array.isArray(parsed) ? parsed : [parsed]) as ServerFrame[]) {
            this.#handle(frame);
        }
    }

    #handle(frame: ServerFrame): void {
        switch (frame._tag) {
            case 'Chunk': {
                const pending = this.#pending.get(frame.requestId);
                // Effect RPC applies backpressure: the server waits for an Ack per chunk.
                this.#send({ _tag: 'Ack', requestId: frame.requestId });
                if (pending?.onChunk) for (const value of frame.values) pending.onChunk(value);
                return;
            }
            case 'Exit': {
                const pending = this.#pending.get(frame.requestId);
                if (!pending) return;
                this.#pending.delete(frame.requestId);
                if (frame.exit._tag === 'Success') pending.resolve(frame.exit.value);
                else pending.reject(errorFromCause(frame.exit.cause));
                return;
            }
            case 'Defect':
            case 'ClientProtocolError': {
                const error = new RpcError(
                    `Server protocol error: ${describe('defect' in frame ? frame.defect : frame.error)}`,
                );
                for (const pending of this.#pending.values()) pending.reject(error);
                this.#pending.clear();
                return;
            }
        }
    }

    #onClose(reason: string): void {
        clearInterval(this.#ping);
        const error = new RpcError(`Connection closed (${reason})`);
        for (const pending of this.#pending.values()) pending.reject(error);
        this.#pending.clear();
        for (const listener of this.#closeListeners) listener(reason);
    }
}

function errorFromCause(cause: ReadonlyArray<CauseEntry>): RpcError {
    const fail = cause.find(entry => entry._tag === 'Fail');
    if (fail && fail._tag === 'Fail') {
        const error = fail.error as { _tag?: string; message?: string } | undefined;
        return new RpcError(
            error?.message ?? error?._tag ?? describe(fail.error),
            error?._tag,
            fail.error,
        );
    }
    const die = cause.find(entry => entry._tag === 'Die');
    if (die && die._tag === 'Die') return new RpcError(`Server defect: ${describe(die.defect)}`);
    return new RpcError('Request interrupted');
}

function describe(value: unknown): string {
    if (typeof value === 'string') return value;
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function redactTicket(url: string): string {
    return url.replace(/wsTicket=[^&]+/, 'wsTicket=…');
}
