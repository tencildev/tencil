import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import type { ProviderMessage, ThreadStatus } from '@tencildev/protocol';

type Status = Exclude<ThreadStatus, 'draft' | 'starting'>;
type Message = Omit<ProviderMessage, 'createdAt'>;
interface Step {
    id: string;
    label: string;
    detail?: string;
    status: 'running' | 'done' | 'failed';
}
interface Chat {
    id: string;
    title: string;
    status: Status;
    messages: Message[];
    steps: Step[];
}
export interface FakeEnsembleProject {
    id: string;
    name: string;
    source: { kind: 'local'; path: string } | { kind: 'git'; url: string };
}
export interface FakeEnsembleThread {
    id: string;
    projectId: string;
    title: string;
    branch: string;
    state: string;
    status: Status;
    agent: string;
    machine: { id: string; name: string };
    chats: Chat[];
}
export interface FakeEnsembleEvent {
    id: string;
    type: string;
    data: Record<string, unknown>;
}
export interface FakeEnsembleOptions {
    projects?: FakeEnsembleProject[];
    autoAllow?: boolean;
    turnDelayMs?: number;
    reply?: (text: string) => string;
}
export class FakeEnsembleServer {
    readonly projects: FakeEnsembleProject[];
    readonly threads = new Map<string, FakeEnsembleThread>();
    readonly ports = new Map<number, string>();
    readonly events: FakeEnsembleEvent[] = [];
    readonly calls: Array<{
        method: string;
        path: string;
        body: Record<string, unknown>;
        headers: IncomingMessage['headers'];
        query: string;
    }> = [];
    readonly tokens = new Set<string>();
    readonly #http = createServer((req, res) => {
        void this.#route(req, res).catch(() => {
            res.writeHead(500);
            res.end();
        });
    });
    readonly #sockets = new Set<Socket>();
    readonly #feeds = new Map<ServerResponse, string | null>();
    readonly #pending = new Set<ServerResponse>();
    readonly #writes = new Map<string, { status: number; value: unknown }>();
    readonly #timers = new Set<ReturnType<typeof setTimeout>>();
    #port = 0;
    #sequence = 0;
    #epoch = randomUUID();
    get port() {
        return this.#port;
    }
    get url() {
        return `http://127.0.0.1:${this.#port}`;
    }
    get feedCount() {
        return this.#feeds.size;
    }
    private constructor(readonly options: FakeEnsembleOptions) {
        this.projects = options.projects ?? [];
        this.#http.on('connection', socket => {
            this.#sockets.add(socket);
            socket.on('close', () => this.#sockets.delete(socket));
        });
    }
    static async start(options: FakeEnsembleOptions = {}): Promise<FakeEnsembleServer> {
        const server = new FakeEnsembleServer(options);
        await new Promise<void>(resolve => server.#http.listen(0, '127.0.0.1', resolve));
        const address = server.#http.address();
        if (!address || typeof address === 'string') throw new Error('No port');
        server.#port = address.port;
        return server;
    }
    addThread(
        input: Partial<FakeEnsembleThread> & { projectId: string; title: string },
    ): FakeEnsembleThread {
        const thread: FakeEnsembleThread = {
            id: randomUUID(),
            branch: 'work',
            state: 'idle',
            status: 'idle',
            agent: 'claude',
            machine: { id: 'local', name: 'This Mac' },
            chats: [{ id: 'main', title: 'Main', status: 'idle', messages: [], steps: [] }],
            ...input,
        };
        this.threads.set(thread.id, thread);
        return thread;
    }
    allow(): void {
        for (const response of this.#pending) this.#allow(response);
        this.#pending.clear();
    }
    deny(status = 403): void {
        for (const response of this.#pending) {
            response.writeHead(status, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ error: 'Connection not allowed' }));
        }
        this.#pending.clear();
    }
    revoke(): void {
        this.tokens.clear();
        this.dropFeeds();
    }
    dropFeeds(): void {
        for (const response of this.#feeds.keys()) response.destroy();
    }
    resetHistory(): void {
        this.events.length = 0;
        this.#epoch = randomUUID();
    }
    emit(type: string, data: Record<string, unknown>): FakeEnsembleEvent {
        const thread = this.threads.get(String(data.threadId));
        const chat = thread?.chats.find(c => c.id === data.chatId);
        if (chat) {
            if (type === 'message') {
                const message = data.message as Message;
                const index = chat.messages.findIndex(m => m.id === message.id);
                if (index < 0) chat.messages.push(message);
                else chat.messages[index] = message;
            }
            if (type === 'steps') chat.steps = data.steps as Step[];
            if (type === 'status') chat.status = data.status as Status;
        }
        if (type === 'archived' && thread) thread.state = 'archived';
        const event = { id: `${this.#epoch}:${++this.#sequence}`, type, data };
        this.events.push(event);
        for (const [response, id] of this.#feeds) {
            if (!id || id === data.threadId) this.#writeEvent(response, event);
        }
        return event;
    }
    callsOf(method: string, path: string | RegExp): Record<string, unknown>[] {
        return this.calls
            .filter(
                c =>
                    c.method === method &&
                    (typeof path === 'string' ? c.path === path : path.test(c.path)),
            )
            .map(c => c.body);
    }
    async close(): Promise<void> {
        for (const timer of this.#timers) clearTimeout(timer);
        for (const socket of this.#sockets) socket.destroy();
        await new Promise<void>(resolve => this.#http.close(() => resolve()));
    }
    #allow(response: ServerResponse): void {
        const token = `ens_${randomUUID()}`;
        this.tokens.add(token);
        const value = { token, client: { id: randomUUID(), name: 'Tencil', access: 'work' } };
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(value));
    }
    #writeEvent(response: ServerResponse, event: { type: string; data: unknown; id?: string }) {
        response.write(
            `${event.id ? `id: ${event.id}\n` : ''}data: ${JSON.stringify({ type: event.type, ...(event.data as object) })}\n\n`,
        );
    }
    #run(threadId: string, chat: Chat, text: string) {
        this.emit('message', {
            threadId,
            chatId: chat.id,
            message: { id: randomUUID(), role: 'user', text, streaming: false },
        });
        this.emit('status', { threadId, chatId: chat.id, status: 'working' });
        const id = randomUUID();
        const reply = this.options.reply?.(text) ?? `Done: ${text.split('\n')[0]}`;
        this.emit('message', {
            threadId,
            chatId: chat.id,
            message: { id, role: 'assistant', text: reply.slice(0, 3), streaming: true },
        });
        const timer = setTimeout(() => {
            this.#timers.delete(timer);
            if (chat.status !== 'working') return;
            this.emit('message', {
                threadId,
                chatId: chat.id,
                message: { id, role: 'assistant', text: reply, streaming: false },
            });
            this.emit('status', { threadId, chatId: chat.id, status: 'idle' });
        }, this.options.turnDelayMs ?? 20);
        this.#timers.add(timer);
    }
    async #route(request: IncomingMessage, response: ServerResponse): Promise<void> {
        const url = new URL(request.url ?? '/', this.url);
        const path = url.pathname.replace(/^\/v1\/?/, '');
        const method = request.method ?? 'GET';
        let raw = '';
        for await (const chunk of request) raw += String(chunk);
        const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        this.calls.push({ method, path, body, headers: request.headers, query: url.search });
        const key = request.headers['idempotency-key'] as string | undefined;
        const json = (status: number, value?: unknown) => {
            if (key && status < 400) this.#writes.set(key, { status, value });
            response.writeHead(status, { 'content-type': 'application/json' });
            response.end(value === undefined ? undefined : JSON.stringify(value));
        };
        const local = [`127.0.0.1:${this.port}`, `localhost:${this.port}`];
        if (request.headers.origin || !local.includes(request.headers.host ?? '')) {
            return json(403, { error: 'Forbidden' });
        }
        if (method === 'GET' && !path) return json(200, { name: 'ensemble', api: 1 });
        if (method === 'POST' && !key) return json(400, { error: 'Missing Idempotency-Key' });
        if (method === 'POST' && path === 'connect') return this.#connect(body, response, json);
        const token = (request.headers.authorization ?? '').replace(/^Bearer /, '');
        if (!this.tokens.has(token)) return json(401, { error: 'Client removed' });
        const repeated = key ? this.#writes.get(key) : undefined;
        if (repeated) return json(repeated.status, repeated.value);
        if (method === 'GET' && path === 'projects') return json(200, this.projects);
        if (method === 'GET' && path === 'threads') return json(200, this.#openThreads(url));
        if (method === 'GET' && path === 'feed') return this.#feed(request, url, response, json);
        if (method === 'POST' && path === 'threads') return this.#createThread(body, json);
        const match = path.match(
            /^threads\/([^/]+)(?:\/chats(?:\/([^/]+)(?:\/(messages|stop))?)?)?$/,
        );
        const thread = match?.[1] ? this.threads.get(decodeURIComponent(match[1])) : undefined;
        if (!match || !thread) return json(404, { error: 'Not found' });
        if (method === 'GET' && !path.includes('/chats')) return json(200, thread);
        if (method === 'POST' && path.endsWith('/chats')) {
            return json(200, this.#createChat(thread, body));
        }
        const chat = thread.chats.find(c => c.id === decodeURIComponent(match[2] ?? 'main'));
        if (!chat) return json(404, { error: 'Not found' });
        if (method === 'GET') {
            const { messages, steps, status } = chat;
            return json(200, { thread, chat, status, messages, steps });
        }
        if (method === 'POST' && match[3] === 'messages') {
            this.#run(thread.id, chat, String(body.text));
            return json(204);
        }
        if (method === 'POST' && match[3] === 'stop') {
            this.emit('status', { threadId: thread.id, chatId: chat.id, status: 'idle' });
            return json(204);
        }
        json(404, { error: 'Not found' });
    }

    /** Hold the request open until the test calls `allow` or `deny`, unless `autoAllow`. */
    #connect(
        body: Record<string, unknown>,
        response: ServerResponse,
        json: (status: number, value?: unknown) => void,
    ): void {
        if (body.name !== 'Tencil' || body.access !== 'work') {
            json(422, { error: 'Invalid client' });
        } else if (this.options.autoAllow !== false) {
            this.#allow(response);
        } else {
            this.#pending.add(response);
            response.on('close', () => this.#pending.delete(response));
        }
    }

    #openThreads(url: URL): FakeEnsembleThread[] {
        const port = url.searchParams.get('port');
        const project = url.searchParams.get('project');
        return [...this.threads.values()].filter(
            thread =>
                thread.state !== 'archived' &&
                (port === null || this.ports.get(Number(port)) === thread.id) &&
                (project === null || project === thread.projectId),
        );
    }

    #createThread(
        body: Record<string, unknown>,
        json: (status: number, value?: unknown) => void,
    ): void {
        if (!this.projects.some(project => project.id === body.projectId)) {
            json(404, { error: 'No project with that projectId: GET /v1/projects lists them.' });
        } else if (!body.prompt) {
            json(422, { error: 'Send a prompt.' });
        } else {
            const title = String(body.title ?? 'Thread');
            const chat: Chat = { id: 'main', title, status: 'idle', messages: [], steps: [] };
            const thread = this.addThread({
                projectId: String(body.projectId),
                title,
                branch: `ensemble/${randomUUID()}`,
                chats: [chat],
            });
            this.emit('thread', { threadId: thread.id, thread });
            this.#run(thread.id, chat, String(body.prompt));
            json(200, thread);
        }
    }

    #createChat(thread: FakeEnsembleThread, body: Record<string, unknown>) {
        const chat: Chat = {
            id: randomUUID(),
            title: String(body.title ?? 'Chat'),
            status: 'idle',
            messages: [],
            steps: [],
        };
        thread.chats.push(chat);
        this.emit('chat', { threadId: thread.id, chatId: chat.id, ...chat });
        if (body.prompt) this.#run(thread.id, chat, String(body.prompt));
        return { id: chat.id, title: chat.title, status: chat.status };
    }

    /** Events after `Last-Event-ID` when it's known, else the whole state; then live. */
    #feed(
        request: IncomingMessage,
        url: URL,
        response: ServerResponse,
        json: (status: number, value?: unknown) => void,
    ): void {
        const threadId = url.searchParams.get('thread');
        if (threadId && !this.threads.has(threadId)) {
            json(404, { error: 'Not found' });
            return;
        }
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        this.#feeds.set(response, threadId);
        const after = request.headers['last-event-id'] ?? url.searchParams.get('after');
        const index = this.events.findIndex(event => event.id === after);
        if (index >= 0) {
            for (const event of this.events.slice(index + 1)) {
                if (!threadId || event.data.threadId === threadId)
                    this.#writeEvent(response, event);
            }
        } else {
            for (const thread of this.threads.values()) {
                if (!threadId || thread.id === threadId) this.#writeState(response, thread);
            }
        }
        this.#writeEvent(response, { type: 'ready', data: {} });
        const ping = setInterval(() => response.write(': ping\n\n'), 15_000);
        response.on('close', () => {
            clearInterval(ping);
            this.#feeds.delete(response);
        });
    }

    #writeState(response: ServerResponse, thread: FakeEnsembleThread): void {
        if (thread.state === 'archived') {
            this.#writeEvent(response, { type: 'archived', data: { threadId: thread.id } });
            return;
        }
        this.#writeEvent(response, { type: 'thread', data: { threadId: thread.id, thread } });
        for (const chat of thread.chats) {
            this.#writeEvent(response, {
                type: 'chat',
                data: { threadId: thread.id, chatId: chat.id, ...chat },
            });
        }
    }
}
