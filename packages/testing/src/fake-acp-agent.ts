import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import { PassThrough } from 'node:stream';

/** A `session/update` the agent sends, e.g. `{ sessionUpdate: 'tool_call', … }`. */
export type FakeAcpUpdate = { sessionUpdate: string } & Record<string, unknown>;

export interface FakeAcpSession {
    sessionId: string;
    cwd: string;
    title: string | null;
    /** ISO 8601. */
    updatedAt: string;
    /** Everything the session said, in order: what `session/load` replays. */
    history: FakeAcpUpdate[];
}

/** What the provider sends: the fields the fake and tests read, by name. */
export interface FakeAcpParams {
    sessionId?: string;
    cwd?: string;
    mcpServers?: unknown[];
    prompt?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    protocolVersion?: number;
    clientCapabilities?: Record<string, unknown>;
    [key: string]: unknown;
}

export interface FakeAcpRequest {
    method: string;
    params: FakeAcpParams;
}

/** What the fake says it can do in `initialize`. */
export interface FakeAcpCapabilities {
    loadSession: boolean;
    resume: boolean;
    list: boolean;
    image: boolean;
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
 * Stands in for an agent run as an ACP server (`devin acp` and the like):
 * JSON-RPC 2.0 over stdio, sessions kept in memory the way an agent keeps them
 * on disk, and a scripted, streamed reply to each prompt. A session only takes
 * prompts on the process that created, loaded or resumed it, as with real
 * agents, so a new process has to open it again first.
 */
export class FakeAcpAgent {
    readonly sessions = new Map<string, FakeAcpSession>();
    /** Everything the provider asked, oldest first. */
    readonly requests: FakeAcpRequest[] = [];
    /** Answers to the requests made with `ask`, oldest first. */
    readonly answers: unknown[] = [];
    /** The folder each process was started in. */
    readonly started: string[] = [];
    processes = 0;
    alive = 0;
    capabilities: FakeAcpCapabilities = {
        loadSession: true,
        resume: false,
        list: true,
        image: true,
    };
    authMethods = [{ id: 'fake-login', name: 'Log in', description: 'Run `fake login`' }];
    /** Every new session is refused with ACP's "authentication required". */
    signedOut = false;
    reply: (text: string) => string = text => `Done: ${text}`;
    /** Updates each prompt sends before its reply: tool calls, thoughts, a plan. */
    updates: FakeAcpUpdate[] = [];
    /** Requests the agent makes during each prompt, before its reply. */
    ask: Array<{ method: string; params: Record<string, unknown> }> = [];
    /** Echo each prompt back as `user_message_chunk`s while it runs, as some agents do. */
    echoPrompts = false;
    /** Pause every prompt after its first chunk until `release()` (or a cancel). */
    holdTurns = false;
    /** The next prompt is answered with this error. */
    failNextPrompt: { code: number; message: string } | undefined;
    /** The next prompt ends like this instead of `end_turn`. */
    stopNextPrompt: string | undefined;
    /** The next prompt's process dies mid-turn. */
    crashNextPrompt = false;
    /** What the next process prints before dying, instead of starting. */
    failToStart: string | undefined;

    #gates = new Set<() => void>();

    /** For `AcpProviderOptions.spawn`. */
    spawn = (cwd = ''): FakeProcess => {
        this.processes += 1;
        this.started.push(cwd);
        const process = new FakeProcess();
        if (this.failToStart !== undefined) {
            const message = this.failToStart;
            this.failToStart = undefined;
            process.stderr.write(`${message}\n`);
            setImmediate(() => process.end());
            return process;
        }
        this.alive += 1;
        new Connection(this, process);
        process.once('close', () => {
            this.alive -= 1;
        });
        return process;
    };

    release(): void {
        for (const open of this.#gates) open();
        this.#gates.clear();
    }

    /** Wait at a gate until `release()` or a cancel. */
    gate(): Promise<void> {
        return new Promise(resolve => this.#gates.add(resolve));
    }

    requestsOf(method: string): FakeAcpParams[] {
        return this.requests.filter(r => r.method === method).map(r => r.params);
    }

    /** Add a session as if the agent had one from before, outside Tencil. */
    addSession(input: Partial<FakeAcpSession> & { cwd: string }): FakeAcpSession {
        const session: FakeAcpSession = {
            sessionId: randomUUID(),
            title: null,
            updatedAt: new Date().toISOString(),
            history: [],
            ...input,
        };
        this.sessions.set(session.sessionId, session);
        return session;
    }
}

class RpcFailure extends Error {
    readonly code: number;

    constructor(code: number, message: string) {
        super(message);
        this.code = code;
    }
}

/** One process's view: the sessions it has open and their prompts in progress. */
class Connection {
    readonly #agent: FakeAcpAgent;
    readonly #process: FakeProcess;
    readonly #open = new Set<string>();
    readonly #turns = new Map<string, { cancelled: boolean }>();
    readonly #answering = new Map<number, (result: unknown) => void>();
    #nextRequest = 1000;

    constructor(agent: FakeAcpAgent, process: FakeProcess) {
        this.#agent = agent;
        this.#process = process;
        createInterface({ input: process.stdin }).on('line', line => this.#receive(line));
        // Like real agents, it stops once its stdin ends.
        process.stdin.once('end', () => process.end());
    }

    #receive(line: string): void {
        const message = JSON.parse(line) as {
            jsonrpc?: string;
            id?: number;
            method?: string;
            params?: FakeAcpParams;
            result?: unknown;
            error?: unknown;
        };
        if (message.jsonrpc !== '2.0') throw new Error(`Not JSON-RPC 2.0: ${line}`);
        if (!message.method) {
            if (message.id !== undefined) {
                this.#answering.get(message.id)?.(message.result ?? { error: message.error });
                this.#answering.delete(message.id);
            }
            return;
        }
        const { id, method, params = {} } = message;
        this.#agent.requests.push({ method, params });
        if (id === undefined) {
            this.#notified(method, params);
            return;
        }
        void this.#handle(method, params).then(
            result => this.#send({ id, result }),
            (error: Error) => {
                const code = error instanceof RpcFailure ? error.code : -32603;
                this.#send({ id, error: { code, message: error.message } });
            },
        );
    }

    #notified(method: string, params: FakeAcpParams): void {
        if (method !== 'session/cancel') return;
        const turn = this.#turns.get(params.sessionId ?? '');
        if (turn) turn.cancelled = true;
        this.#agent.release();
    }

    async #handle(method: string, params: FakeAcpParams): Promise<unknown> {
        const agent = this.#agent;
        const { loadSession, resume, list, image } = agent.capabilities;
        switch (method) {
            case 'initialize':
                return {
                    protocolVersion: 1,
                    agentCapabilities: {
                        loadSession,
                        promptCapabilities: { image, audio: false, embeddedContext: false },
                        sessionCapabilities: {
                            ...(list ? { list: {} } : {}),
                            ...(resume ? { resume: {} } : {}),
                        },
                    },
                    authMethods: agent.authMethods,
                    agentInfo: { name: 'fake-acp', version: '1.0.0' },
                };
            case 'session/new': {
                if (agent.signedOut) throw new RpcFailure(-32000, 'Authentication required');
                const session = agent.addSession({ cwd: params.cwd ?? '' });
                this.#open.add(session.sessionId);
                return { sessionId: session.sessionId };
            }
            case 'session/load': {
                if (!loadSession) throw new RpcFailure(-32601, 'Method not found');
                const session = this.#known(params.sessionId);
                for (const update of session.history) this.#update(session.sessionId, update);
                this.#open.add(session.sessionId);
                return {};
            }
            case 'session/resume': {
                if (!resume) throw new RpcFailure(-32601, 'Method not found');
                const session = this.#known(params.sessionId);
                this.#open.add(session.sessionId);
                return {};
            }
            case 'session/list': {
                if (!list) throw new RpcFailure(-32601, 'Method not found');
                const sessions = [...agent.sessions.values()]
                    .filter(session => !params.cwd || session.cwd === params.cwd)
                    .map(({ history: _, ...info }) => info);
                return { sessions };
            }
            case 'session/prompt':
                return this.#prompt(params);
            default:
                throw new RpcFailure(-32601, `Method not found: ${method}`);
        }
    }

    #known(sessionId = ''): FakeAcpSession {
        const session = this.#agent.sessions.get(sessionId);
        if (!session) throw new RpcFailure(-32002, `Session not found: ${sessionId}`);
        return session;
    }

    async #prompt(params: FakeAcpParams): Promise<unknown> {
        const agent = this.#agent;
        const session = this.#known(params.sessionId);
        if (!this.#open.has(session.sessionId)) {
            throw new RpcFailure(-32002, `Session not found: ${session.sessionId}`);
        }
        if (this.#turns.has(session.sessionId)) {
            throw new RpcFailure(-32600, 'A prompt is already running in this session');
        }
        const sessionId = session.sessionId;
        const turn = { cancelled: false };
        this.#turns.set(sessionId, turn);
        const send = (update: FakeAcpUpdate) => {
            session.history.push(update);
            this.#update(sessionId, update);
        };
        try {
            await tick();
            const blocks = params.prompt ?? [];
            const text = blocks.flatMap(block => (block.text ? [block.text] : [])).join('\n\n');
            session.title ??= text.split('\n', 1)[0] ?? null;
            session.updatedAt = new Date().toISOString();
            // Saved for a replay; live, only some agents echo it.
            for (const block of blocks) {
                const update = { sessionUpdate: 'user_message_chunk', content: block };
                session.history.push(update);
                if (agent.echoPrompts) this.#update(sessionId, update);
            }

            for (const update of agent.updates) {
                send(update);
                await tick();
            }
            for (const asked of agent.ask) {
                agent.answers.push(await this.#ask(asked.method, { sessionId, ...asked.params }));
            }
            if (agent.failNextPrompt) {
                const { code, message } = agent.failNextPrompt;
                agent.failNextPrompt = undefined;
                throw new RpcFailure(code, message);
            }

            const reply = agent.reply(text);
            const half = Math.ceil(reply.length / 2);
            const chunk = (part: string) =>
                send({
                    sessionUpdate: 'agent_message_chunk',
                    content: { type: 'text', text: part },
                });
            chunk(reply.slice(0, half));
            if (agent.crashNextPrompt) {
                agent.crashNextPrompt = false;
                await tick();
                this.#process.stderr.write('fake agent crashed\n');
                this.#process.end();
                return new Promise(() => {});
            }
            if (agent.holdTurns && !turn.cancelled) await agent.gate();
            if (turn.cancelled) return { stopReason: 'cancelled' };
            chunk(reply.slice(half));
            const stopReason = agent.stopNextPrompt ?? 'end_turn';
            agent.stopNextPrompt = undefined;
            return { stopReason };
        } finally {
            this.#turns.delete(sessionId);
        }
    }

    #update(sessionId: string, update: FakeAcpUpdate): void {
        this.#send({ method: 'session/update', params: { sessionId, update } });
    }

    /** A request from the agent to the provider. Resolves with its answer. */
    #ask(method: string, params: Record<string, unknown>): Promise<unknown> {
        const id = this.#nextRequest++;
        return new Promise(resolve => {
            this.#answering.set(id, resolve);
            this.#send({ id, method, params });
        });
    }

    #send(message: Record<string, unknown>): void {
        if (this.#process.stdout.writable) {
            this.#process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
        }
    }
}

const tick = () => new Promise(resolve => setImmediate(resolve));
