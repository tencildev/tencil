import {
    ClientMessage,
    PROTOCOL_VERSION,
    type ProjectSettings,
    type Provider,
    type ProviderMessage,
    type ServerMessage,
    type Thread,
    type ThreadMessage,
} from '@tencil/protocol';
import type { ProjectProviders } from './project-providers.ts';
import { renderPrompt, stripContext, titleFor } from './prompt.ts';
import type { ThreadStore } from './thread-store.ts';

export interface BridgeClient {
    send(message: ServerMessage): void;
}

export interface BridgeOptions {
    providers: ProjectProviders;
    store: ThreadStore;
    project: { name: string; root: string };
    version: string;
    log?: (message: string) => void;
}

/** Local echo ids, replaced once the provider reports the real user message. */
const LOCAL_PREFIX = 'local:';
const BROADCAST_THROTTLE_MS = 80;

/**
 * Owns pins and fans provider updates out to every connected overlay. One
 * bridge serves one project; any number of tabs may be connected.
 */
export class Bridge {
    readonly #options: BridgeOptions;
    readonly #clients = new Set<BridgeClient>();
    /** One provider subscription per provider thread, shared by every pin bound to it. */
    readonly #watches = new Map<string, () => void>();
    readonly #pendingBroadcast = new Map<string, ReturnType<typeof setTimeout>>();
    #offInfo: () => void = () => {};
    readonly #offDefault: () => void;

    constructor(options: BridgeOptions) {
        this.#options = options;
        this.#followDefault();
        this.#offDefault = options.providers.onDefaultChange(() => {
            this.#followDefault();
            this.#broadcast({ type: 'settings', settings: this.#settings() });
            this.#broadcast({ type: 'provider.status', provider: this.#provider().info() });
        });
        for (const thread of options.store.list()) {
            if (thread.provider.threadId && options.providers.has(thread.provider.id)) {
                this.#watch(thread.provider.id, thread.provider.threadId);
            }
        }
    }

    connect(client: BridgeClient): () => void {
        this.#clients.add(client);
        return () => this.#clients.delete(client);
    }

    async handle(client: BridgeClient, raw: unknown): Promise<void> {
        const parsed = ClientMessage.safeParse(raw);
        if (!parsed.success) {
            client.send({
                type: 'error',
                message: `Invalid message: ${parsed.error.issues[0]?.message}`,
            });
            return;
        }
        const message = parsed.data;
        try {
            switch (message.type) {
                case 'hello':
                    client.send({
                        type: 'ready',
                        protocol: PROTOCOL_VERSION,
                        version: this.#options.version,
                        project: this.#options.project,
                        provider: this.#provider().info(),
                        settings: this.#settings(),
                        threads: this.#options.store.list(),
                    });
                    return;
                case 'thread.create':
                    await (message.providerThreadId
                        ? this.#continue(message)
                        : this.#create(message));
                    return;
                case 'thread.open':
                    this.#open(message);
                    return;
                case 'provider.pair':
                    await this.#provider().pair?.();
                    return;
                case 'provider.threads':
                    client.send({
                        type: 'provider.threads',
                        ...(await this.#provider().listThreads()),
                    });
                    return;
                case 'settings.update':
                    await this.#options.providers.setDefault(message.provider);
                    return;
                case 'thread.reply':
                    await this.#reply(message);
                    return;
                case 'thread.interrupt': {
                    const thread = this.#require(message.threadId);
                    if (thread.provider.threadId) {
                        await this.#providerOf(thread).interrupt(thread.provider.threadId);
                    }
                    return;
                }
                case 'thread.resolve':
                    this.#update(message.threadId, thread => ({
                        ...thread,
                        resolved: message.resolved,
                    }));
                    return;
                case 'thread.move':
                    this.#update(message.threadId, thread => ({
                        ...thread,
                        anchor: message.anchor,
                    }));
                    return;
                case 'thread.delete': {
                    const provider = this.#options.store.get(message.threadId)?.provider;
                    if (this.#options.store.delete(message.threadId)) {
                        this.#broadcast({ type: 'thread.removed', threadId: message.threadId });
                    }
                    if (provider?.threadId) this.#release(provider.id, provider.threadId);
                    return;
                }
            }
        } catch (error) {
            const threadId = 'threadId' in message ? message.threadId : undefined;
            client.send({
                type: 'error',
                message: error instanceof Error ? error.message : String(error),
                ...(threadId ? { threadId } : {}),
            });
        }
    }

    async dispose(): Promise<void> {
        this.#offInfo();
        this.#offDefault();
        for (const unwatch of this.#watches.values()) unwatch();
        for (const timer of this.#pendingBroadcast.values()) clearTimeout(timer);
        await this.#options.store.flush();
    }

    /* --------------------------------- actions --------------------------------- */

    async #create(message: Extract<ClientMessage, { type: 'thread.create' }>): Promise<void> {
        const { store } = this.#options;
        const provider = this.#provider();
        if (store.get(message.id)) throw new Error(`Thread ${message.id} already exists`);
        const now = new Date().toISOString();
        const thread: Thread = {
            id: message.id,
            title: titleFor(message.prompt, message.context),
            pageUrl: message.pageUrl,
            anchor: message.anchor,
            context: message.context,
            status: 'starting',
            resolved: false,
            messages: [localMessage(message.prompt, now)],
            provider: { id: provider.id },
            createdAt: now,
            updatedAt: now,
        };
        store.upsert(thread);
        this.#broadcastThread(thread, true);

        try {
            const created = await provider.createThread({
                title: thread.title,
                text: renderPrompt({
                    prompt: message.prompt,
                    pageUrl: message.pageUrl,
                    context: message.context,
                    hasScreenshot: message.attachments.length > 0,
                }),
                attachments: message.attachments,
            });
            this.#update(thread.id, current => ({
                ...current,
                status: 'working',
                provider: { id: provider.id, threadId: created.providerThreadId, url: created.url },
            }));
            this.#watch(provider.id, created.providerThreadId);
            this.#options.log?.(`Pin "${thread.title}" → ${provider.label}`);
        } catch (error) {
            this.#update(thread.id, current => ({
                ...current,
                status: 'error',
                statusDetail: error instanceof Error ? error.message : String(error),
            }));
        }
    }

    /** Pin an element onto an existing provider thread: the prompt becomes its next message. */
    async #continue(message: Extract<ClientMessage, { type: 'thread.create' }>): Promise<void> {
        const { store } = this.#options;
        // The thread comes from the default provider's list.
        const provider = this.#provider();
        const providerThreadId = message.providerThreadId!;
        if (store.get(message.id)) throw new Error(`Thread ${message.id} already exists`);
        const now = new Date().toISOString();
        const sibling = this.#pinsFor(provider.id, providerThreadId)[0];
        const thread: Thread = {
            id: message.id,
            title: titleFor(message.prompt, message.context),
            pageUrl: message.pageUrl,
            anchor: message.anchor,
            context: message.context,
            status: 'working',
            resolved: false,
            // Show the conversation so far; the provider snapshot replaces it when it arrives.
            messages: [...(sibling?.messages ?? []), localMessage(message.prompt, now)],
            provider: {
                id: provider.id,
                threadId: providerThreadId,
                url: provider.threadUrl(providerThreadId),
            },
            createdAt: now,
            updatedAt: now,
        };
        store.upsert(thread);
        this.#broadcastThread(thread, true);
        this.#watch(provider.id, providerThreadId, true);

        try {
            await provider.sendMessage({
                providerThreadId,
                text: renderPrompt({
                    prompt: message.prompt,
                    pageUrl: message.pageUrl,
                    context: message.context,
                    hasScreenshot: message.attachments.length > 0,
                }),
                attachments: message.attachments,
            });
            this.#options.log?.(`Pin "${thread.title}" → existing ${provider.label} thread`);
        } catch (error) {
            this.#update(thread.id, current => ({
                ...current,
                status: 'error',
                statusDetail: error instanceof Error ? error.message : String(error),
            }));
        }
    }

    /** Track an existing provider thread without an element, e.g. to continue it from the dock. */
    #open(message: Extract<ClientMessage, { type: 'thread.open' }>): void {
        const { store } = this.#options;
        const provider = this.#provider();
        const pins = this.#pinsFor(provider.id, message.providerThreadId);
        const existing = pins.find(thread => !thread.anchor);
        if (existing) {
            this.#broadcastThread(existing, true);
            return;
        }
        const sibling = pins[0];
        const now = new Date().toISOString();
        const thread: Thread = {
            id: message.id,
            title: message.title ?? sibling?.title ?? 'Thread',
            status: sibling?.status ?? 'idle',
            resolved: false,
            messages: sibling?.messages ?? [],
            provider: {
                id: provider.id,
                threadId: message.providerThreadId,
                url: provider.threadUrl(message.providerThreadId),
            },
            createdAt: now,
            updatedAt: now,
        };
        store.upsert(thread);
        this.#broadcastThread(thread, true);
        this.#watch(provider.id, message.providerThreadId, true);
    }

    async #reply(message: Extract<ClientMessage, { type: 'thread.reply' }>): Promise<void> {
        const thread = this.#require(message.threadId);
        if (!thread.provider.threadId) throw new Error('This pin has no agent thread yet');
        this.#update(thread.id, current => ({
            ...current,
            resolved: false,
            status: 'working',
            statusDetail: undefined,
            messages: [...current.messages, localMessage(message.text, new Date().toISOString())],
        }));
        await this.#providerOf(thread).sendMessage({
            providerThreadId: thread.provider.threadId,
            text: message.text,
            attachments: message.attachments,
        });
    }

    /* ------------------------------ provider sink ------------------------------ */

    /**
     * Subscribe once per provider thread and fan updates out to every bound pin.
     * `replay` re-subscribes an existing watch so a newly bound pin receives the
     * provider's snapshot too.
     */
    #watch(providerId: string, providerThreadId: string, replay = false): void {
        const key = watchKey(providerId, providerThreadId);
        if (this.#watches.has(key) && !replay) return;
        this.#watches.get(key)?.();
        const provider = this.#options.providers.get(providerId);
        const each = (change: (thread: Thread) => Thread) => {
            for (const thread of this.#pinsFor(providerId, providerThreadId)) {
                this.#update(thread.id, change);
            }
        };
        const unwatch = provider.watch(providerThreadId, {
            message: message => each(thread => mergeMessage(thread, message)),
            status: (status, statusDetail) => each(thread => ({ ...thread, status, statusDetail })),
            gone: () =>
                each(thread => ({
                    ...thread,
                    status: 'error',
                    statusDetail: `Thread no longer exists in ${provider.label}`,
                })),
        });
        this.#watches.set(key, unwatch);
    }

    #release(providerId: string, providerThreadId: string): void {
        if (this.#pinsFor(providerId, providerThreadId).length > 0) return;
        const key = watchKey(providerId, providerThreadId);
        this.#watches.get(key)?.();
        this.#watches.delete(key);
    }

    #pinsFor(providerId: string, providerThreadId: string): Thread[] {
        return this.#options.store
            .list()
            .filter(
                thread =>
                    thread.provider.id === providerId &&
                    thread.provider.threadId === providerThreadId,
            );
    }

    /* -------------------------------- providers -------------------------------- */

    /** The provider new pins go to. */
    #provider(): Provider {
        return this.#options.providers.default();
    }

    /** The provider a pin was made with; switching the default doesn't move old pins. */
    #providerOf(thread: Thread): Provider {
        if (!this.#options.providers.has(thread.provider.id)) {
            throw new Error(`This pin's agent (${thread.provider.id}) isn't available`);
        }
        return this.#options.providers.get(thread.provider.id);
    }

    /** Report the default provider's status, and follow it when the project switches. */
    #followDefault(): void {
        this.#offInfo();
        this.#offInfo = this.#provider().onInfoChange(provider =>
            this.#broadcast({ type: 'provider.status', provider }),
        );
    }

    #settings(): ProjectSettings {
        const { providers } = this.#options;
        return { provider: providers.defaultId, providers: providers.choices };
    }

    /* --------------------------------- helpers --------------------------------- */

    #require(threadId: string): Thread {
        const thread = this.#options.store.get(threadId);
        if (!thread) throw new Error(`Unknown thread ${threadId}`);
        return thread;
    }

    #update(threadId: string, change: (thread: Thread) => Thread): void {
        const current = this.#options.store.get(threadId);
        if (!current) return;
        const next = { ...change(current), updatedAt: new Date().toISOString() };
        this.#options.store.upsert(next);
        this.#broadcastThread(next);
    }

    /** Streaming produces many updates per second; coalesce per thread. */
    #broadcastThread(thread: Thread, immediate = false): void {
        const send = () => {
            this.#pendingBroadcast.delete(thread.id);
            const latest = this.#options.store.get(thread.id);
            if (latest) this.#broadcast({ type: 'thread.upsert', thread: latest });
        };
        if (immediate) {
            clearTimeout(this.#pendingBroadcast.get(thread.id));
            send();
            return;
        }
        if (this.#pendingBroadcast.has(thread.id)) return;
        this.#pendingBroadcast.set(thread.id, setTimeout(send, BROADCAST_THROTTLE_MS));
    }

    #broadcast(message: ServerMessage): void {
        for (const client of this.#clients) client.send(message);
    }
}

function watchKey(providerId: string, providerThreadId: string): string {
    return `${providerId}:${providerThreadId}`;
}

function localMessage(text: string, createdAt: string): ThreadMessage {
    return {
        id: `${LOCAL_PREFIX}${crypto.randomUUID()}`,
        role: 'user',
        text,
        streaming: false,
        createdAt,
    };
}

export function mergeMessage(thread: Thread, incoming: ProviderMessage): Thread {
    const message: ThreadMessage = {
        ...incoming,
        text: incoming.role === 'user' ? stripContext(incoming.text) : incoming.text,
    };
    let messages = thread.messages;
    if (message.role === 'user') {
        // Swap the optimistic echo for the provider's copy.
        const echo = messages.findIndex(
            m => m.id.startsWith(LOCAL_PREFIX) && m.text.trim() === message.text.trim(),
        );
        if (echo !== -1) messages = messages.filter((_, index) => index !== echo);
    }
    const index = messages.findIndex(m => m.id === message.id);
    if (index === -1) {
        messages = [...messages, message].sort(
            (a, b) =>
                a.createdAt.localeCompare(b.createdAt) ||
                // Keep unconfirmed local echoes after confirmed messages with the same timestamp.
                Number(a.id.startsWith(LOCAL_PREFIX)) - Number(b.id.startsWith(LOCAL_PREFIX)),
        );
    } else {
        messages = messages.map((m, i) => (i === index ? message : m));
    }
    return { ...thread, messages };
}
