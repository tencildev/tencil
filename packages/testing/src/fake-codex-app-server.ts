import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import { PassThrough } from 'node:stream';

export interface FakeCodexThread {
    id: string;
    cwd: string;
    name: string | null;
    preview: string;
    model: string | null;
    updatedAt: number;
    branch?: string;
    /** Saved before Codex paginated history: `thread/items/list` can't read it. */
    legacy?: boolean;
    /** What it was last started or resumed with. */
    settings: Record<string, unknown>;
    /** The saved conversation, the way `thread/items/list` returns it. */
    items: Array<{ turnId: string; item: Record<string, unknown>; startedAtMs: number }>;
}

/** An item Codex reports during a turn: a command, a file change, a tool call… */
export type FakeCodexItem = { type: string; id?: string } & Record<string, unknown>;

/** What the provider sends: the fields the fake and tests read, by name. */
export interface FakeCodexParams {
    threadId?: string;
    turnId?: string;
    name?: string;
    cwd?: string;
    model?: string;
    clientUserMessageId?: string;
    input?: Array<{ type: string; text?: string; url?: string }>;
    [key: string]: unknown;
}

export interface FakeCodexRequest {
    method: string;
    params: FakeCodexParams;
}

/** The process `spawn()` returns: what `child_process.spawn` gives the provider. */
class FakeProcess extends EventEmitter {
    readonly stdin = new PassThrough();
    readonly stdout = new PassThrough();
    readonly stderr = new PassThrough();
    #ended = false;

    kill(): void {
        this.end();
    }

    end(): void {
        if (this.#ended) return;
        this.#ended = true;
        this.stdout.end();
        this.stderr.end();
        this.emit('exit');
        this.emit('close');
    }
}

/**
 * Stands in for `codex app-server`: JSON-RPC over stdio, threads kept in memory
 * the way Codex keeps them on disk, and a scripted, streamed reply to each
 * turn. A thread is only loaded on the process that started or resumed it, as
 * with the real one, so a new process has to resume before it can continue.
 */
export class FakeCodexAppServer {
    readonly threads = new Map<string, FakeCodexThread>();
    /** Everything the provider asked, oldest first. */
    readonly requests: FakeCodexRequest[] = [];
    /** Answers to the requests made with `requestApproval`, oldest first. */
    readonly answers: unknown[] = [];
    processes = 0;
    alive = 0;
    /** `null`: signed out. */
    account: { type: string } | null = { type: 'chatgpt' };
    configModel: string | null = null;
    models = [
        { model: 'gpt-test', displayName: 'GPT Test', hidden: false, isDefault: true },
        { model: 'gpt-test-mini', displayName: 'GPT Test Mini', hidden: false, isDefault: false },
        { model: 'gpt-test-hidden', displayName: 'Hidden', hidden: true, isDefault: false },
    ];
    reply: (text: string) => string = text => `Done: ${text}`;
    /** Items each turn reports before its reply. */
    items: FakeCodexItem[] = [];
    /** Requests Codex makes during each turn, before its reply. */
    requestApproval: Array<{ method: string; params: Record<string, unknown> }> = [];
    /** Pause every turn after its first chunk until `release()` (or an interrupt). */
    holdTurns = false;
    /** The next turn ends like this instead of with a reply. */
    failNextTurn: { message: string; codexErrorInfo?: unknown } | undefined;
    /** The next turn's process dies mid-turn. */
    crashNextTurn = false;
    /** What the next process prints before dying, instead of starting. */
    failToStart: string | undefined;
    /** How long every answer takes, like a busy machine. */
    answerDelayMs = 0;

    #gates = new Set<() => void>();
    #processes = new Set<FakeProcess>();

    /** For `CodexProviderOptions.spawn`. */
    spawn = (): FakeProcess => {
        this.processes += 1;
        const process = new FakeProcess();
        if (this.failToStart !== undefined) {
            const message = this.failToStart;
            this.failToStart = undefined;
            process.stderr.write(`${message}\n`);
            setImmediate(() => process.end());
            return process;
        }
        this.alive += 1;
        this.#processes.add(process);
        new Connection(this, process);
        process.once('close', () => {
            this.alive -= 1;
            this.#processes.delete(process);
        });
        return process;
    };

    release(): void {
        for (const open of this.#gates) open();
        this.#gates.clear();
    }

    /** Wait at a gate until `release()` or an interrupt. */
    gate(): Promise<void> {
        return new Promise(resolve => this.#gates.add(resolve));
    }

    requestsOf(method: string): FakeCodexParams[] {
        return this.requests.filter(r => r.method === method).map(r => r.params);
    }

    /** Add a thread as if Codex made it earlier, outside Tencil. */
    addThread(input: Partial<FakeCodexThread> & { cwd: string }): FakeCodexThread {
        const thread: FakeCodexThread = {
            id: randomUUID(),
            name: null,
            preview: '',
            model: null,
            updatedAt: Math.floor(Date.now() / 1000),
            settings: {},
            items: [],
            ...input,
        };
        this.threads.set(thread.id, thread);
        return thread;
    }
}

class RpcFailure extends Error {
    readonly code: number;

    constructor(code: number, message: string) {
        super(message);
        this.code = code;
    }
}

/** One process's view: the threads it has loaded and their turns in progress. */
class Connection {
    readonly #server: FakeCodexAppServer;
    readonly #process: FakeProcess;
    readonly #loaded = new Set<string>();
    readonly #turns = new Map<string, { id: string; interrupted: boolean; steered: string[] }>();
    readonly #answering = new Map<number, (result: unknown) => void>();
    #nextRequest = 1000;

    constructor(server: FakeCodexAppServer, process: FakeProcess) {
        this.#server = server;
        this.#process = process;
        createInterface({ input: process.stdin }).on('line', line => this.#receive(line));
        // Like the real one, it stops once its stdin ends.
        process.stdin.once('end', () => process.end());
    }

    #receive(line: string): void {
        const message = JSON.parse(line) as {
            id?: number;
            method?: string;
            params?: FakeCodexParams;
            result?: unknown;
            error?: unknown;
        };
        if (!message.method) {
            if (message.id !== undefined) {
                this.#answering.get(message.id)?.(message.result ?? { error: message.error });
                this.#answering.delete(message.id);
            }
            return;
        }
        if (message.id === undefined) return;
        const { id, method, params = {} } = message;
        this.#server.requests.push({ method, params });
        const answer = () => {
            try {
                this.#send({ id, result: this.#handle(method, params) });
            } catch (error) {
                const code = error instanceof RpcFailure ? error.code : -32603;
                this.#send({ id, error: { code, message: (error as Error).message } });
            }
        };
        if (this.#server.answerDelayMs > 0) setTimeout(answer, this.#server.answerDelayMs);
        else answer();
    }

    #handle(method: string, params: FakeCodexParams): unknown {
        const server = this.#server;
        switch (method) {
            case 'initialize':
                return { userAgent: 'fake-codex', codexHome: '/fake', platformOs: 'macos' };
            case 'account/read':
                return { account: server.account, requiresOpenaiAuth: true };
            case 'config/read':
                return { config: { model: server.configModel }, origins: {} };
            case 'model/list':
                return { data: server.models, nextCursor: null };
            case 'thread/list': {
                const data = [...server.threads.values()]
                    .filter(thread => !params.cwd || thread.cwd === params.cwd)
                    .filter(thread => thread.items.length > 0 || thread.name !== null)
                    .sort((a, b) => b.updatedAt - a.updatedAt)
                    .map(summary);
                return { data, nextCursor: null };
            }
            case 'thread/start': {
                const thread = server.addThread({
                    cwd: params.cwd ?? '',
                    model: params.model ?? null,
                    settings: params,
                });
                this.#loaded.add(thread.id);
                return { thread: summary(thread), model: thread.model, cwd: thread.cwd };
            }
            case 'thread/resume': {
                const thread = server.threads.get(params.threadId ?? '');
                if (!thread) {
                    throw new RpcFailure(
                        -32600,
                        `no rollout found for thread id ${params.threadId}`,
                    );
                }
                thread.settings = params;
                this.#loaded.add(thread.id);
                return { thread: summary(thread), model: thread.model, cwd: thread.cwd };
            }
            case 'thread/name/set':
                this.#loadedThread(params.threadId).name = params.name ?? null;
                return {};
            case 'thread/items/list': {
                // What Codex really says about a thread it doesn't have, too.
                const thread = server.threads.get(params.threadId ?? '');
                if (!thread || thread.legacy) {
                    throw new RpcFailure(-32601, 'thread/items/list is not supported yet');
                }
                return { data: thread.items, nextCursor: null };
            }
            case 'thread/read': {
                const thread = server.threads.get(params.threadId ?? '');
                if (!thread) {
                    throw new RpcFailure(-32600, `thread not loaded: ${params.threadId}`);
                }
                // Items only get a time from their turn here, in seconds.
                const turns = [...new Set(thread.items.map(entry => entry.turnId))].map(id => ({
                    id,
                    status: 'completed',
                    error: null,
                    startedAt: Math.floor((thread.items[0]?.startedAtMs ?? 0) / 1000),
                    items: thread.items.filter(e => e.turnId === id).map(e => e.item),
                }));
                return { thread: { ...summary(thread), turns: params.includeTurns ? turns : [] } };
            }
            case 'turn/start':
                return this.#startTurn(params);
            case 'turn/interrupt': {
                const turn = this.#turns.get(params.threadId ?? '');
                if (!turn || turn.id !== params.turnId) {
                    throw new RpcFailure(-32600, `no such turn: ${params.turnId}`);
                }
                turn.interrupted = true;
                server.release();
                return {};
            }
            default:
                throw new RpcFailure(-32601, `unknown method ${method}`);
        }
    }

    #loadedThread(threadId = ''): FakeCodexThread {
        const thread = this.#server.threads.get(threadId);
        if (!thread || !this.#loaded.has(threadId)) {
            throw new RpcFailure(-32600, `thread not found: ${threadId}`);
        }
        return thread;
    }

    #startTurn(params: FakeCodexParams): unknown {
        const thread = this.#loadedThread(params.threadId);
        const running = this.#turns.get(thread.id);
        const text = (params.input ?? [])
            .flatMap(part => (part.text ? [part.text] : []))
            .join('\n\n');
        if (running) {
            // A message during a turn joins that turn.
            this.#saveUser(thread, running.id, params);
            running.steered.push(text);
            return { turn: { id: running.id, status: 'inProgress', error: null } };
        }
        const id = randomUUID();
        const turn = { id, interrupted: false, steered: [] as string[] };
        this.#turns.set(thread.id, turn);
        thread.preview ||= text;
        thread.updatedAt = Math.floor(Date.now() / 1000);
        void this.#run(thread, turn, text, params);
        return { turn: { id, status: 'inProgress', error: null } };
    }

    #saveUser(thread: FakeCodexThread, turnId: string, params: FakeCodexParams): void {
        thread.items.push({
            turnId,
            startedAtMs: Date.now(),
            item: {
                type: 'userMessage',
                id: randomUUID(),
                clientId: params.clientUserMessageId ?? null,
                content: params.input,
            },
        });
    }

    async #run(
        thread: FakeCodexThread,
        turn: { id: string; interrupted: boolean; steered: string[] },
        text: string,
        params: FakeCodexParams,
    ): Promise<void> {
        const server = this.#server;
        const threadId = thread.id;
        const notify = (method: string, body: Record<string, unknown>) =>
            this.#send({ method, params: { threadId, turnId: turn.id, ...body } });
        const finish = (status: string, error: unknown = null) => {
            this.#turns.delete(threadId);
            notify('turn/completed', { turn: { id: turn.id, status, error } });
        };

        await tick();
        notify('turn/started', { turn: { id: turn.id, status: 'inProgress', error: null } });
        this.#saveUser(thread, turn.id, params);

        for (const scripted of server.items) {
            const item = { ...scripted, id: scripted.id ?? randomUUID() };
            notify('item/started', {
                item: { ...item, status: 'inProgress' },
                startedAtMs: Date.now(),
            });
            await tick();
            thread.items.push({ turnId: turn.id, startedAtMs: Date.now(), item });
            notify('item/completed', { item, completedAtMs: Date.now() });
        }
        for (const asked of server.requestApproval) {
            server.answers.push(
                await this.#ask(asked.method, { threadId, turnId: turn.id, ...asked.params }),
            );
        }

        if (server.failNextTurn) {
            const error = server.failNextTurn;
            server.failNextTurn = undefined;
            notify('error', { error, willRetry: false });
            return finish('failed', error);
        }

        const replyId = `msg_${randomUUID()}`;
        const reply = server.reply(text);
        const half = Math.ceil(reply.length / 2);
        notify('item/started', {
            item: { type: 'agentMessage', id: replyId, text: '' },
            startedAtMs: Date.now(),
        });
        notify('item/agentMessage/delta', { itemId: replyId, delta: reply.slice(0, half) });
        if (server.crashNextTurn) {
            server.crashNextTurn = false;
            await tick();
            this.#process.stderr.write('codex crashed\n');
            return this.#process.end();
        }
        if (server.holdTurns && !turn.interrupted) await server.gate();
        if (turn.interrupted) return finish('interrupted');

        const full = reply + turn.steered.map(steered => ` And: ${steered}`).join('');
        notify('item/agentMessage/delta', { itemId: replyId, delta: full.slice(half) });
        const item = { type: 'agentMessage', id: replyId, text: full };
        thread.items.push({ turnId: turn.id, startedAtMs: Date.now(), item });
        notify('item/completed', { item, completedAtMs: Date.now() });
        finish('completed');
    }

    /** A request from Codex to the provider. Resolves with its answer. */
    #ask(method: string, params: Record<string, unknown>): Promise<unknown> {
        const id = this.#nextRequest++;
        return new Promise(resolve => {
            this.#answering.set(id, resolve);
            this.#send({ id, method, params });
        });
    }

    #send(message: unknown): void {
        if (this.#process.stdout.writable) {
            this.#process.stdout.write(`${JSON.stringify(message)}\n`);
        }
    }
}

function summary(thread: FakeCodexThread) {
    return {
        id: thread.id,
        name: thread.name,
        preview: thread.preview,
        cwd: thread.cwd,
        updatedAt: thread.updatedAt,
        gitInfo: thread.branch ? { branch: thread.branch } : null,
        status: { type: 'notLoaded' },
        turns: [],
    };
}

const tick = () => new Promise(resolve => setImmediate(resolve));
