import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { stripVTControlCharacters } from 'node:util';

/** A running `codex app-server`, or a fake of one in tests. */
export interface AppServerProcess {
    stdin: Writable;
    stdout: Readable;
    stderr?: Readable | null;
    kill(): void;
    once(event: 'exit' | 'close', listener: () => void): unknown;
    once(event: 'error', listener: (error: Error) => void): unknown;
}

export type SpawnAppServer = () => AppServerProcess;

export function spawnAppServer(command: string): AppServerProcess {
    // npm's codex is a .cmd shim on Windows, which only runs through a shell.
    const shell = /\.(cmd|bat)$/i.test(command);
    return spawn(shell ? `"${command}"` : command, ['app-server'], {
        stdio: 'pipe',
        shell,
        windowsHide: true,
    });
}

export class RpcError extends Error {
    constructor(
        readonly code: number,
        message: string,
    ) {
        super(message);
        this.name = 'RpcError';
    }
}

export interface AppServerHandlers {
    notification(method: string, params: unknown): void;
    /** Answers a request from Codex; throw to refuse it. */
    request(method: string, params: unknown): unknown;
    /** The process ended, on its own or through `close()`. */
    closed(): void;
    log(message: string): void;
}

interface Pending {
    resolve(result: unknown): void;
    reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
}

export const METHOD_NOT_FOUND = -32601;
/** Starting a thread waits for the user's MCP servers, so this is generous. */
const REQUEST_TIMEOUT_MS = 120_000;
/** How long a closed server gets to finish on its own before it's killed. */
const CLOSE_GRACE_MS = 2_000;
const EXIT_DRAIN_MS = 200;

/** JSON-RPC with `codex app-server`: one JSON message per line over stdio. */
export class AppServer {
    readonly #process: AppServerProcess;
    readonly #handlers: AppServerHandlers;
    readonly #pending = new Map<number, Pending>();
    #nextId = 1;
    #closed = false;
    #lastError = '';

    constructor(process: AppServerProcess, handlers: AppServerHandlers) {
        this.#process = process;
        this.#handlers = handlers;
        // A failed write surfaces through the exit that follows it.
        process.stdin.on('error', () => {});
        process.once('error', error => this.#ended(error.message));
        // `close` waits for its last output, the reason it failed; a command Codex
        // left running can hold that open, so don't wait long.
        process.once('close', () => this.#ended());
        process.once('exit', () => setTimeout(() => this.#ended(), EXIT_DRAIN_MS).unref?.());
        createInterface({ input: process.stdout }).on('line', line => this.#receive(line));
        if (process.stderr) {
            createInterface({ input: process.stderr }).on('line', line => {
                const text = stripVTControlCharacters(line).trim();
                if (!text) return;
                this.#lastError = text;
                handlers.log(text);
            });
        }
    }

    /** The handshake every connection starts with. */
    async initialize(version: string): Promise<void> {
        await this.request('initialize', {
            clientInfo: { name: 'tencil', title: 'Tencil', version },
            capabilities: { experimentalApi: false, requestAttestation: false },
        });
        this.#write({ method: 'initialized' });
    }

    request<T>(method: string, params: unknown): Promise<T> {
        if (this.#closed) return Promise.reject(new Error(this.#stoppedMessage()));
        return new Promise<T>((resolve, reject) => {
            const id = this.#nextId++;
            const timer = setTimeout(() => {
                this.#pending.delete(id);
                reject(new Error(`Codex didn't answer ${method} in time`));
            }, REQUEST_TIMEOUT_MS);
            timer.unref?.();
            this.#pending.set(id, {
                resolve: result => resolve(result as T),
                reject,
                timer,
            });
            this.#write({ method, id, params });
        });
    }

    /** Ending stdin stops the server; kill it if it doesn't. */
    close(): void {
        if (this.#closed) return;
        this.#process.stdin.end();
        const timer = setTimeout(() => this.#process.kill(), CLOSE_GRACE_MS);
        timer.unref?.();
        this.#process.once('exit', () => clearTimeout(timer));
    }

    #receive(line: string): void {
        let message: {
            id?: number;
            method?: string;
            params?: unknown;
            result?: unknown;
            error?: { code: number; message: string };
        };
        try {
            message = JSON.parse(line);
        } catch {
            this.#handlers.log(`Unreadable message from Codex: ${line.slice(0, 200)}`);
            return;
        }
        if (message.method && message.id !== undefined) {
            this.#answer(message.id, message.method, message.params);
            return;
        }
        if (message.method) {
            try {
                this.#handlers.notification(message.method, message.params);
            } catch (error) {
                this.#handlers.log(`Couldn't handle ${message.method}: ${errorMessage(error)}`);
            }
            return;
        }
        const pending = message.id === undefined ? undefined : this.#pending.get(message.id);
        if (!pending || message.id === undefined) return;
        this.#pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) {
            pending.reject(new RpcError(message.error.code, message.error.message));
        } else {
            pending.resolve(message.result);
        }
    }

    /** Every request gets an answer: an unanswered one would hang the turn. */
    #answer(id: number, method: string, params: unknown): void {
        try {
            this.#write({ id, result: this.#handlers.request(method, params) });
        } catch (error) {
            this.#write({
                id,
                error: {
                    code: error instanceof RpcError ? error.code : METHOD_NOT_FOUND,
                    message: errorMessage(error),
                },
            });
        }
    }

    #write(message: unknown): void {
        if (!this.#closed) this.#process.stdin.write(`${JSON.stringify(message)}\n`);
    }

    #ended(reason?: string): void {
        if (this.#closed) return;
        this.#closed = true;
        if (reason) this.#lastError = reason;
        const message = this.#stoppedMessage();
        for (const pending of this.#pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(new Error(message));
        }
        this.#pending.clear();
        this.#handlers.closed();
    }

    #stoppedMessage(): string {
        return this.#lastError ? `Codex stopped: ${this.#lastError}` : 'Codex stopped';
    }
}

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
