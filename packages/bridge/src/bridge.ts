import {
    ClientMessage,
    type ImageAttachment,
    PROTOCOL_VERSION,
    type ProjectSettings,
    type Provider,
    type ProviderMessage,
    type ServerMessage,
    type Thread,
    type ThreadChange,
    type ThreadMessage,
    type ThreadStep,
    type UpdateStatus,
    type Viewer,
} from '@tencildev/protocol';
import type { ChangeTracker } from './change-tracker.ts';
import type { ProjectProviders } from './project-providers.ts';
import {
    batchTitle,
    renderBatchPrompt,
    renderCommitPrompt,
    renderPrompt,
    stripContext,
    titleFor,
} from './prompt.ts';
import type { ThreadStore } from './thread-store.ts';

export interface BridgeClient {
    send(message: ServerMessage): void;
    /** Tencil Cloud: who this connection signed in as, echoed in `ready`. */
    viewer?: Viewer;
}

export interface BridgeOptions {
    providers: ProjectProviders;
    store: ThreadStore;
    project: { name: string; root: string };
    version: string;
    /**
     * The host's own updates, sent in `ready`. The local daemon has them (and
     * handles `update.start` itself); Tencil Cloud doesn't.
     */
    update?: () => UpdateStatus;
    /**
     * What agents change in the project's files, for Git actions. Without it
     * the overlay doesn't offer them (Tencil Cloud commits every run itself).
     */
    changes?: ChangeTracker;
    log?: (message: string) => void;
}

/** A turn of a provider thread with Git actions on: where the work tree started. */
interface Turn {
    from: Promise<string | undefined>;
    /** The provider reported it working; the replayed status of a watch doesn't end it before. */
    working: boolean;
    /** Another provider thread worked at the same time. */
    shared: boolean;
    /** The agent was asked to commit the change; HEAD before, to tell whether it did. */
    commit?: { head: string | undefined };
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
    /** Screenshots of queued comments, kept in memory until the batch is sent. */
    readonly #draftAttachments = new Map<string, ImageAttachment[]>();
    /** Turns in progress, by provider thread (`watchKey`), while Git actions are on. */
    readonly #turns = new Map<string, Turn>();
    #offInfo: () => void = () => {};
    readonly #offDefault: () => void;
    readonly #offSettings: () => void;

    constructor(options: BridgeOptions) {
        this.#options = options;
        this.#followDefault();
        this.#offDefault = options.providers.onDefaultChange(() => {
            this.#followDefault();
            this.#broadcast({ type: 'settings', settings: this.#settings() });
            this.#broadcast({ type: 'provider.status', provider: this.#provider().info() });
        });
        this.#offSettings = options.providers.onSettingsChange(() =>
            this.#broadcast({ type: 'settings', settings: this.#settings() }),
        );
        for (const thread of options.store.list()) {
            const change = thread.change;
            if (change?.status === 'committing' || change?.status === 'reverting') {
                options.store.upsert({
                    ...thread,
                    change: {
                        ...change,
                        status: 'failed',
                        detail: 'Tencil restarted before it finished',
                    },
                });
            }
            if (
                thread.provider.threadId &&
                options.providers.has(thread.provider.id) &&
                !this.#archived(thread.provider)
            ) {
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
                        ...(client.viewer && { viewer: client.viewer }),
                        ...(this.#options.update && { update: this.#options.update() }),
                    });
                    return;
                case 'thread.create':
                    if (message.draft) this.#queue(message);
                    else if (message.providerThreadId) await this.#continue(message);
                    else await this.#create(message);
                    return;
                case 'thread.edit': {
                    const draft = this.#require(message.threadId);
                    if (draft.status !== 'draft')
                        throw new Error('Only queued comments can be edited');
                    const [first] = draft.messages;
                    this.#update(draft.id, thread => ({
                        ...thread,
                        title: thread.context
                            ? titleFor(message.prompt, thread.context)
                            : message.prompt,
                        messages: first ? [{ ...first, text: message.prompt }] : [],
                    }));
                    return;
                }
                case 'drafts.send':
                    await this.#sendDrafts(message.drafts);
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
                case 'settings.update': {
                    const { providers } = this.#options;
                    if (message.provider) await providers.setDefault(message.provider);
                    if (message.batch !== undefined) await providers.setBatch(message.batch);
                    if (message.ruler !== undefined) await providers.setRuler(message.ruler);
                    if (message.git !== undefined) {
                        if (!this.#options.changes)
                            throw new Error("Git actions aren't available here");
                        await providers.setGit(message.git);
                    }
                    return;
                }
                case 'provider.models': {
                    const provider = this.#provider();
                    client.send({
                        type: 'provider.models',
                        provider: provider.id,
                        ...((await provider.listModels?.()) ?? { models: [] }),
                    });
                    return;
                }
                case 'model.select': {
                    const { providers } = this.#options;
                    await providers.setModel(providers.defaultId, message.model);
                    return;
                }
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
                    await this.#resolve(message.threadId, message.resolved);
                    return;
                case 'thread.commit':
                    await this.#settleChange(message.threadId, 'commit');
                    return;
                case 'thread.revert':
                    await this.#settleChange(message.threadId, 'revert');
                    return;
                case 'thread.move':
                    this.#update(message.threadId, thread => ({
                        ...thread,
                        anchor: message.anchor,
                    }));
                    return;
                case 'thread.delete': {
                    const thread = this.#options.store.get(message.threadId);
                    this.#draftAttachments.delete(message.threadId);
                    if (this.#options.store.delete(message.threadId)) {
                        this.#broadcast({ type: 'thread.removed', threadId: message.threadId });
                    }
                    if (!thread?.provider.threadId) return;
                    if (this.#pinsFor(thread.provider.id, thread.provider.threadId).length === 0) {
                        this.#turns.delete(watchKey(thread.provider.id, thread.provider.threadId));
                    }
                    // Deleting the last open pin is done with the thread, as resolving it is.
                    if (
                        !thread.resolved &&
                        this.#options.providers.has(thread.provider.id) &&
                        this.#archived(thread.provider)
                    ) {
                        await this.#archive(thread);
                    }
                    this.#release(thread.provider.id, thread.provider.threadId);
                    return;
                }
                case 'update.start':
                    throw new Error("Tencil can't update itself here");
                case 'preferences.update':
                    throw new Error("Preferences aren't saved here");
                case 'project.choices':
                    throw new Error("Projects can't be switched here");
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
        this.#offSettings();
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
        const from = await this.#snapshot();

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
                model: this.#options.providers.modelFor(provider.id),
            });
            this.#update(thread.id, current => ({
                ...current,
                status: 'working',
                provider: {
                    id: provider.id,
                    threadId: created.providerThreadId,
                    url: created.url,
                    archivable: created.archivable,
                },
            }));
            this.#beginTurn(provider.id, created.providerThreadId, from);
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

    /** Pin a comment without sending it: it waits for `drafts.send`. */
    #queue(message: Extract<ClientMessage, { type: 'thread.create' }>): void {
        const { store } = this.#options;
        if (store.get(message.id)) throw new Error(`Thread ${message.id} already exists`);
        const now = new Date().toISOString();
        store.upsert({
            id: message.id,
            title: titleFor(message.prompt, message.context),
            pageUrl: message.pageUrl,
            anchor: message.anchor,
            context: message.context,
            status: 'draft',
            resolved: false,
            messages: [localMessage(message.prompt, now)],
            provider: { id: this.#provider().id },
            createdAt: now,
            updatedAt: now,
        });
        if (message.attachments.length > 0) {
            this.#draftAttachments.set(message.id, message.attachments);
        }
        this.#broadcastThread(store.get(message.id)!, true);
    }

    /** Queued comments go out together: one message, one new provider thread, shared by their pins. */
    async #sendDrafts(
        entries: Extract<ClientMessage, { type: 'drafts.send' }>['drafts'],
    ): Promise<void> {
        const drafts = entries.flatMap(({ threadId, number }) => {
            const thread = this.#options.store.get(threadId);
            return thread?.status === 'draft' && thread.context && thread.pageUrl
                ? [{ thread, number, context: thread.context, pageUrl: thread.pageUrl }]
                : [];
        });
        if (drafts.length === 0) return;
        const provider = this.#provider();
        const attachments: ImageAttachment[] = [];
        const comments = drafts.map(({ thread, number, context, pageUrl }) => {
            const own = this.#draftAttachments.get(thread.id) ?? [];
            const screenshots = own.map((_, index) => attachments.length + index + 1);
            attachments.push(...own);
            return {
                number,
                prompt: thread.messages[0]?.text ?? thread.title,
                pageUrl,
                context,
                screenshots,
            };
        });
        const text =
            drafts.length === 1
                ? renderPrompt({ ...comments[0]!, hasScreenshot: attachments.length > 0 })
                : renderBatchPrompt(comments);
        const now = new Date().toISOString();
        // Every pin shows the shared conversation; the provider's snapshot replaces this echo.
        const echo = localMessage(stripContext(text), now);
        for (const { thread } of drafts) {
            this.#update(thread.id, current => ({
                ...current,
                status: 'starting',
                messages: [echo],
                provider: { id: provider.id },
            }));
        }
        const from = await this.#snapshot();

        try {
            const created = await provider.createThread({
                title:
                    drafts.length === 1
                        ? drafts[0]!.thread.title
                        : batchTitle(drafts.map(({ thread }) => thread.title)),
                text,
                attachments,
                model: this.#options.providers.modelFor(provider.id),
            });
            for (const { thread } of drafts) {
                this.#draftAttachments.delete(thread.id);
                this.#update(thread.id, current => ({
                    ...current,
                    status: 'working',
                    provider: {
                        id: provider.id,
                        threadId: created.providerThreadId,
                        url: created.url,
                        archivable: created.archivable,
                    },
                }));
            }
            this.#beginTurn(provider.id, created.providerThreadId, from);
            this.#watch(provider.id, created.providerThreadId);
            this.#options.log?.(`${drafts.length} queued pins → ${provider.label}`);
        } catch (error) {
            // Back in the queue, so nothing is lost and the batch can be sent again.
            for (const { thread } of drafts) {
                this.#update(thread.id, current => ({
                    ...current,
                    status: 'draft',
                    statusDetail: error instanceof Error ? error.message : String(error),
                    messages: thread.messages,
                }));
            }
            throw error;
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
                archivable: sibling?.provider.archivable,
            },
            createdAt: now,
            updatedAt: now,
        };
        store.upsert(thread);
        this.#broadcastThread(thread, true);
        this.#watch(provider.id, providerThreadId, true);
        this.#beginTurn(provider.id, providerThreadId, await this.#snapshot());

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
            this.#turns.delete(watchKey(provider.id, providerThreadId));
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
                archivable: sibling?.provider.archivable,
            },
            createdAt: now,
            updatedAt: now,
        };
        store.upsert(thread);
        this.#broadcastThread(thread, true);
        this.#watch(provider.id, message.providerThreadId, true);
    }

    async #reply(message: Extract<ClientMessage, { type: 'thread.reply' }>): Promise<void> {
        await this.#followUp(
            this.#require(message.threadId),
            message.text,
            message.attachments,
            async (providerId, providerThreadId) =>
                this.#beginTurn(providerId, providerThreadId, await this.#snapshot()),
        );
    }

    /**
     * The pin's next message to its agent, shown right away (without its
     * context block) and sent once `begin` has started tracking the turn.
     */
    async #followUp(
        thread: Thread,
        text: string,
        attachments: ImageAttachment[],
        begin: (providerId: string, providerThreadId: string) => Promise<void>,
    ): Promise<void> {
        const { id: providerId, threadId: providerThreadId } = thread.provider;
        if (!providerThreadId) throw new Error('This pin has no agent thread yet');
        await this.#resolve(thread.id, false);
        this.#update(thread.id, current => ({
            ...current,
            status: 'working',
            statusDetail: undefined,
            // Steps are per turn; the provider reports this one's afresh.
            steps: undefined,
            messages: [
                ...current.messages,
                localMessage(stripContext(text), new Date().toISOString()),
            ],
        }));
        await begin(providerId, providerThreadId);
        try {
            await this.#providerOf(thread).sendMessage({ providerThreadId, text, attachments });
        } catch (error) {
            this.#turns.delete(watchKey(providerId, providerThreadId));
            throw error;
        }
    }

    /**
     * A thread the provider started for its pins is archived once every pin on it is
     * resolved, and reopened when one is reopened. It isn't watched while archived.
     */
    async #resolve(threadId: string, resolved: boolean): Promise<void> {
        const thread = this.#require(threadId);
        if (thread.resolved === resolved) return;
        const { id: providerId, threadId: providerThreadId, archivable } = thread.provider;
        const others = providerThreadId
            ? this.#pinsFor(providerId, providerThreadId).filter(pin => pin.id !== threadId)
            : [];
        if (archivable && providerThreadId && others.every(pin => pin.resolved)) {
            if (resolved) {
                await this.#archive(thread);
            } else {
                await this.#providerOf(thread).reopen?.(providerThreadId);
                this.#watch(providerId, providerThreadId, true);
            }
        }
        this.#update(threadId, current => ({ ...current, resolved }));
    }

    /** Archive the pin's provider thread, which its other pins, if any, are done with. */
    async #archive(thread: Thread): Promise<void> {
        const { id: providerId, threadId: providerThreadId } = thread.provider;
        if (!providerThreadId) return;
        // Unwatched first, so the provider's own archived event doesn't mark the pins gone.
        this.#unwatch(providerId, providerThreadId);
        try {
            await this.#providerOf(thread).archive?.(providerThreadId);
        } catch (error) {
            if (this.#pinsFor(providerId, providerThreadId).length > 0) {
                this.#watch(providerId, providerThreadId);
            }
            throw error;
        }
    }

    /** Whether the provider thread is archived: started for its pins, which are all resolved. */
    #archived(provider: Thread['provider']): boolean {
        return (
            provider.archivable === true &&
            provider.threadId !== undefined &&
            this.#pinsFor(provider.id, provider.threadId).every(pin => pin.resolved)
        );
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
            status: (status, statusDetail) => {
                each(thread => ({ ...thread, status, statusDetail }));
                this.#followTurn(providerId, providerThreadId, status);
            },
            delivery: delivery => each(thread => ({ ...thread, delivery })),
            step: step => each(thread => mergeStep(thread, step)),
            gone: () => {
                this.#turns.delete(key);
                each(thread => ({
                    ...thread,
                    status: 'error',
                    statusDetail: `Thread no longer exists in ${provider.label}`,
                }));
            },
        });
        this.#watches.set(key, unwatch);
    }

    #release(providerId: string, providerThreadId: string): void {
        if (this.#pinsFor(providerId, providerThreadId).length === 0) {
            this.#unwatch(providerId, providerThreadId);
        }
    }

    #unwatch(providerId: string, providerThreadId: string): void {
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
        const model = providers.modelFor(providers.defaultId);
        return {
            provider: providers.defaultId,
            providers: providers.choices,
            ...(model ? { model } : {}),
            batch: providers.batch,
            ruler: providers.ruler,
            ...(this.#options.changes ? { git: providers.git } : {}),
        };
    }

    /* ------------------------------- git actions ------------------------------- */

    #gitOn(): boolean {
        return this.#options.changes !== undefined && this.#options.providers.git;
    }

    /** The work tree now, taken before a message goes out so the turn's edits stand apart. */
    async #snapshot(): Promise<string | undefined> {
        if (!this.#gitOn()) return undefined;
        try {
            return await this.#options.changes?.snapshot();
        } catch (error) {
            this.#options.log?.(`Couldn't snapshot the work tree: ${errorText(error)}`);
            return undefined;
        }
    }

    /** A turn starts from `from`; one already running keeps its own start. */
    #beginTurn(
        providerId: string,
        providerThreadId: string,
        from: string | undefined | Promise<string | undefined>,
        working = false,
    ): void {
        const key = watchKey(providerId, providerThreadId);
        if (from === undefined || this.#turns.has(key)) return;
        const turn: Turn = { from: Promise.resolve(from), working, shared: false };
        // Edits of turns that overlap can't be told apart. Commit turns edit nothing.
        for (const other of this.#turns.values()) {
            if (other.commit) continue;
            other.shared = true;
            turn.shared = true;
        }
        this.#turns.set(key, turn);
    }

    /** Turns end when the provider settles; ones started outside Tencil are picked up too. */
    #followTurn(providerId: string, providerThreadId: string, status: Thread['status']): void {
        const turn = this.#turns.get(watchKey(providerId, providerThreadId));
        if (status === 'working' || status === 'waiting') {
            if (turn) turn.working = true;
            // E.g. a message sent in the provider's own app.
            else if (status === 'working' && this.#gitOn()) {
                this.#beginTurn(providerId, providerThreadId, this.#snapshot(), true);
            }
        } else if (status === 'idle' || status === 'error') {
            void this.#endTurn(providerId, providerThreadId);
        }
    }

    /**
     * The turn's edits join the pins' open change: a follow-up adds to the
     * change, which stays one until it's committed or reverted.
     */
    async #endTurn(providerId: string, providerThreadId: string): Promise<void> {
        const key = watchKey(providerId, providerThreadId);
        const turn = this.#turns.get(key);
        const tracker = this.#options.changes;
        if (!turn?.working || !tracker) return;
        this.#turns.delete(key);
        if (turn.commit) return this.#endCommit(providerId, providerThreadId, turn.commit.head);
        try {
            const from = await turn.from;
            const to = await tracker.snapshot();
            if (!from || !to || from === to) return;
            const pins = this.#pinsFor(providerId, providerThreadId);
            const open = pins
                .map(pin => pin.change)
                .find(change => change?.status === 'ready' || change?.status === 'failed');
            const spans = [...(open?.spans ?? [])];
            const last = spans.at(-1);
            // Nothing happened in between: one span covers both turns.
            if (last?.to === from) spans[spans.length - 1] = { from: last.from, to };
            else spans.push({ from, to });
            const files = await tracker.files(spans);
            if (files.length === 0 && !open) return;
            const change: ThreadChange | undefined =
                files.length === 0
                    ? undefined
                    : {
                          status: 'ready',
                          files,
                          spans,
                          ...((turn.shared || open?.shared) && { shared: true }),
                      };
            for (const pin of this.#pinsFor(providerId, providerThreadId)) {
                this.#update(pin.id, current => ({ ...current, change }));
            }
        } catch (error) {
            this.#options.log?.(`Couldn't read the turn's changes: ${errorText(error)}`);
        }
    }

    async #settleChange(threadId: string, action: 'commit' | 'revert'): Promise<void> {
        const thread = this.#require(threadId);
        const tracker = this.#options.changes;
        if (!tracker) throw new Error("Git actions aren't available here");
        const change = thread.change;
        if (change?.status === 'committing' || change?.status === 'reverting') return;
        if (change?.status !== 'ready' && change?.status !== 'failed') {
            throw new Error(action === 'commit' ? 'Nothing to commit' : 'Nothing to revert');
        }
        const { detail: _detail, ...rest } = change;
        if (action === 'commit') return this.#askToCommit(thread, rest);
        this.#setChange(thread, { ...rest, status: 'reverting' });
        try {
            await tracker.revert(change.spans);
            this.#setChange(thread, { ...rest, status: 'reverted' });
            this.#options.log?.(`Reverted "${thread.title}"`);
        } catch (error) {
            this.#setChange(thread, { ...rest, status: 'failed', detail: errorText(error) });
        }
    }

    /**
     * The agent commits its own change, so the repository's rules for commits
     * (agent instructions, message format, changesets, hooks) apply. Whether
     * it did shows in HEAD once the turn ends (`#endCommit`).
     */
    async #askToCommit(thread: Thread, change: ThreadChange): Promise<void> {
        const { id: providerId, threadId: providerThreadId } = thread.provider;
        if (!providerThreadId) throw new Error('This pin has no agent thread yet');
        if (this.#turns.has(watchKey(providerId, providerThreadId))) {
            throw new Error("The agent is still working; commit once it's done");
        }
        const head = await this.#options.changes?.head();
        this.#setChange(thread, { ...change, status: 'committing' });
        try {
            await this.#followUp(
                thread,
                renderCommitPrompt(change.files, change.shared === true),
                [],
                async (id, threadId) => {
                    this.#turns.set(watchKey(id, threadId), {
                        from: Promise.resolve(undefined),
                        working: false,
                        shared: false,
                        commit: { head },
                    });
                },
            );
        } catch (error) {
            this.#setChange(thread, { ...change, status: 'failed', detail: errorText(error) });
        }
    }

    async #endCommit(providerId: string, providerThreadId: string, before: string | undefined) {
        try {
            const head = await this.#options.changes?.head();
            const pin = this.#pinsFor(providerId, providerThreadId).find(
                candidate => candidate.change?.status === 'committing',
            );
            if (!pin?.change) return;
            const { detail: _detail, ...change } = pin.change;
            if (head && head !== before) {
                this.#setChange(pin, { ...change, status: 'committed', commit: head });
                this.#options.log?.(`"${pin.title}" committed as ${head.slice(0, 7)}`);
            } else {
                this.#setChange(pin, {
                    ...change,
                    status: 'failed',
                    detail: "The agent didn't commit; its reply says why",
                });
            }
        } catch (error) {
            this.#options.log?.(`Couldn't read the commit: ${errorText(error)}`);
        }
    }

    /** Pins on one provider thread share their change. */
    #setChange(thread: Thread, change: ThreadChange): void {
        const { id, threadId: providerThreadId } = thread.provider;
        const pins = providerThreadId ? this.#pinsFor(id, providerThreadId) : [thread];
        for (const pin of pins) this.#update(pin.id, current => ({ ...current, change }));
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

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
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

/** Most steps a pin keeps; a long agent turn drops its oldest tool calls first. */
const MAX_STEPS = 200;

export function mergeStep(thread: Thread, step: ThreadStep): Thread {
    const current = thread.steps ?? [];
    const index = current.findIndex(s => s.id === step.id);
    let steps = index === -1 ? [...current, step] : current.map((s, i) => (i === index ? step : s));
    if (steps.length > MAX_STEPS) {
        const drop = steps.findIndex(s => s.parentId !== undefined && s.status !== 'running');
        steps = steps.filter((_, i) => i !== (drop === -1 ? 0 : drop));
    }
    return { ...thread, steps };
}
