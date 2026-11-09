import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { stripVTControlCharacters } from 'node:util';
import { ErrorCode, type InitializeResult, PROTOCOL_VERSION } from './protocol.ts';

/** A running ACP agent, or a fake of one in tests. */
export interface AgentProcess {
    stdin: Writable;
    stdout: Readable;
    stderr?: Readable | null;
    kill(): void;
    once(event: 'exit' | 'close', listener: () => void): unknown;
    once(event: 'error', listener: (error: Error) => void): unknown;
}

/** Starts the agent in a folder. */
export type SpawnAgent = (cwd: string) => AgentProcess;

/** Start `program` with `args`; a Windows `.cmd` or `.bat` shim only runs through a shell. */
export function spawnAgent(program: string, args: string[], cwd: string): AgentProcess {
    const shell = /\.(cmd|bat)$/i.test(program);
    const quote = (part: string) => (/[\s"&|<>^]/.test(part) ? `"${part}"` : part);
    return shell
        ? spawn([program, ...args].map(quote).join(' '), [], {
              cwd,
              stdio: 'pipe',
              shell: true,
              windowsHide: true,
          })
        : spawn(program, args, { cwd, stdio: 'pipe', windowsHide: true });
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

export interface ConnectionHandlers {
    notification(method: string, params: unknown): void;
    /** Answers a request from the agent; throw (an `RpcError`) to refuse it. */
    request(method: string, params: unknown): unknown;
    /** The process ended, on its own or through `close()`. */
    closed(): void;
    log(message: string): void;
}

interface Pending {
    resolve(result: unknown): void;
    reject(error: Error): void;
    timer?: ReturnType<typeof setTimeout>;
}

/** Starting a session can wait for the agent's own MCP servers, so this is generous. */
const REQUEST_TIMEOUT_MS = 120_000;
/** How long a closed agent gets to finish on its own before it's killed. */
const CLOSE_GRACE_MS = 2_000;
const EXIT_DRAIN_MS = 200;

/** JSON-RPC 2.0 with an ACP agent: one JSON message per line over stdio. */
export class AgentConnection {
    readonly #label: string;
    readonly #process: AgentProcess;
    readonly #handlers: ConnectionHandlers;
    readonly #pending = new Map<number, Pending>();
    #nextId = 1;
    #closed = false;
    #lastError = '';

    constructor(label: string, process: AgentProcess, handlers: ConnectionHandlers) {
        this.#label = label;
        this.#process = process;
        this.#handlers = handlers;
        // A failed write surfaces through the exit that follows it.
        process.stdin.on('error', () => {});
        process.once('error', error => this.#ended(error.message));
        // `close` waits for its last output, the reason it failed; a command the
        // agent left running can hold that open, so don't wait long.
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

    get closed(): boolean {
        return this.#closed;
    }

    /**
     * The handshake every connection starts with. Tencil reads and writes files
     * for the agent, and has no terminal to offer: the agent runs commands itself.
     */
    initialize(version: string): Promise<InitializeResult> {
        return this.request<InitializeResult>('initialize', {
            protocolVersion: PROTOCOL_VERSION,
            clientCapabilities: {
                fs: { readTextFile: true, writeTextFile: true },
                terminal: false,
            },
            clientInfo: { name: 'tencil', title: 'Tencil', version },
        });
    }

    /** `timeoutMs: 0` waits as long as it takes, for a prompt that lasts the whole turn. */
    request<T>(method: string, params: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
        if (this.#closed) return Promise.reject(new Error(this.#stoppedMessage()));
        return new Promise<T>((resolve, reject) => {
            const id = this.#nextId++;
            const pending: Pending = { resolve: result => resolve(result as T), reject };
            if (timeoutMs > 0) {
                pending.timer = setTimeout(() => {
                    this.#pending.delete(id);
                    reject(new Error(`${this.#label} didn't answer ${method} in time`));
                }, timeoutMs);
                pending.timer.unref?.();
            }
            this.#pending.set(id, pending);
            this.#write({ jsonrpc: '2.0', id, method, params });
        });
    }

    notify(method: string, params: unknown): void {
        this.#write({ jsonrpc: '2.0', method, params });
    }

    /** Ending stdin stops most agents; kill it if it doesn't. */
    close(): void {
        if (this.#closed) return;
        this.#process.stdin.end();
        const timer = setTimeout(() => this.#process.kill(), CLOSE_GRACE_MS);
        timer.unref?.();
        this.#process.once('exit', () => clearTimeout(timer));
    }

    #receive(line: string): void {
        if (!line.trim()) return;
        let message: {
            id?: number | string | null;
            method?: string;
            params?: unknown;
            result?: unknown;
            error?: { code: number; message: string; data?: unknown };
        };
        try {
            message = JSON.parse(line);
        } catch {
            this.#handlers.log(`Unreadable message from ${this.#label}: ${line.slice(0, 200)}`);
            return;
        }
        if (message.method && message.id !== undefined && message.id !== null) {
            void this.#answer(message.id, message.method, message.params);
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
        const id = typeof message.id === 'number' ? message.id : Number(message.id);
        const pending = this.#pending.get(id);
        if (!pending) return;
        this.#pending.delete(id);
        clearTimeout(pending.timer);
        if (message.error) {
            pending.reject(new RpcError(message.error.code, rpcErrorText(message.error)));
        } else {
            pending.resolve(message.result);
        }
    }

    /** Every request gets an answer: an unanswered one would hang the turn. */
    async #answer(id: number | string, method: string, params: unknown): Promise<void> {
        try {
            const result = await this.#handlers.request(method, params);
            this.#write({ jsonrpc: '2.0', id, result: result ?? null });
        } catch (error) {
            this.#write({
                jsonrpc: '2.0',
                id,
                error: {
                    code: error instanceof RpcError ? error.code : ErrorCode.internal,
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
        return this.#lastError
            ? `${this.#label} stopped: ${this.#lastError}`
            : `${this.#label} stopped`;
    }
}

/** Agents often put the useful part in `data`: `Internal error` says little by itself. */
function rpcErrorText(error: { message: string; data?: unknown }): string {
    const data = error.data;
    const detail =
        typeof data === 'string'
            ? data
            : typeof (data as { message?: unknown } | undefined)?.message === 'string'
              ? (data as { message: string }).message
              : undefined;
    return detail && !error.message.includes(detail)
        ? `${error.message}: ${detail}`
        : error.message;
}

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
