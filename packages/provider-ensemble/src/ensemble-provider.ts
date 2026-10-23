import { homedir } from 'node:os';
import { basename } from 'node:path';
import type {
    CreatedThread,
    CreateThreadInput,
    ImageAttachment,
    Provider,
    ProviderInfo,
    ProviderProject,
    ProviderThreadSummary,
    SendMessageInput,
    ThreadSink,
} from '@tencildev/protocol';
import {
    EnsembleClient,
    EnsembleHttpError,
    type EnsembleImage,
    type EnsembleProject,
    EnsembleUnauthorizedError,
    ensembleUrl,
    errorMessage,
} from './api.ts';
import { EnsembleCredentialStore } from './auth.ts';
import { targetForFolder } from './folders.ts';
import { ensembleRoot, ensembleThreadId } from './projects.ts';
import { ThreadFeed, type ThreadFeedOptions } from './thread-feed.ts';

export interface EnsembleProviderOptions {
    /**
     * The Ensemble thread this project is (`ensemble://thread/<id>`), or the folder
     * a dev server runs in.
     */
    projectRoot: string;
    baseUrl?: string;
    credentials?: EnsembleCredentialStore;
    timeouts?: ThreadFeedOptions['timeouts'] & {
        requestMs?: number;
        /** How long to wait before trying an Ensemble app that isn't running again. */
        retryMs?: number;
    };
    log?: (message: string) => void;
}

/** Where pins go: a chat each in one thread, or a new thread each in a project. */
type Target = { kind: 'thread'; threadId: string } | { kind: 'project'; project: EnsembleProject };

/**
 * Sends pins to the Ensemble thread serving the page, one chat per pin, through
 * Ensemble's public local API. A page served from an Ensemble project's own folder
 * starts a thread per pin instead. Pins in a thread share one feed.
 */
export class EnsembleProvider implements Provider {
    readonly id = 'ensemble';
    readonly label = 'Ensemble';
    readonly #baseUrl: string;
    #target?: Target;
    readonly #credentials: EnsembleCredentialStore;
    readonly #feeds = new Map<string, ThreadFeed>();
    readonly #listeners = new Set<(info: ProviderInfo) => void>();
    #info: ProviderInfo = { id: 'ensemble', label: 'Ensemble', state: 'connecting' };
    /** Set while Ensemble accepts the token and the thread is open. */
    #client?: EnsembleClient;
    #starting?: Promise<void>;
    #pairing?: Promise<void>;
    #retry?: ReturnType<typeof setTimeout>;
    #disposed = false;

    constructor(readonly options: EnsembleProviderOptions) {
        this.#baseUrl = new URL(options.baseUrl ?? ensembleUrl()).origin;
        const threadId = ensembleThreadId(options.projectRoot);
        if (threadId) this.#target = { kind: 'thread', threadId };
        this.#credentials = options.credentials ?? new EnsembleCredentialStore();
    }

    info(): ProviderInfo {
        return this.#info;
    }

    onInfoChange(listener: (info: ProviderInfo) => void): () => void {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }

    start(): Promise<void> {
        this.#starting ??= this.#connect().finally(() => {
            this.#starting = undefined;
        });
        return this.#starting;
    }

    /** Ask the user to allow Tencil in Ensemble, then connect with the new token. */
    pair(): Promise<void> {
        this.#pairing ??= this.#pair().finally(() => {
            this.#pairing = undefined;
        });
        return this.#pairing;
    }

    async listThreads(): Promise<{ project: ProviderProject; threads: ProviderThreadSummary[] }> {
        const target = await this.#requireTarget();
        const [name, threads] =
            target.kind === 'thread'
                ? await this.#call(async client => {
                      const thread = await client.thread(target.threadId);
                      return [thread.title, [thread]] as const;
                  })
                : [
                      target.project.name,
                      await this.#call(client => client.threads({ project: target.project.id })),
                  ];
        // Ensemble gives no times, so every chat counts as current.
        const updatedAt = new Date().toISOString();
        return {
            project: { name },
            threads: threads.flatMap(thread =>
                thread.chats.map(chat => {
                    const id = chatThreadId(thread.id, chat.id);
                    return {
                        id,
                        title: chat.title,
                        status: chat.status,
                        updatedAt,
                        url: this.threadUrl(id),
                    };
                }),
            ),
        };
    }

    threadUrl(providerThreadId: string): string {
        return ensembleRoot(parseChatThreadId(providerThreadId).threadId);
    }

    async createThread(input: CreateThreadInput): Promise<CreatedThread> {
        const target = await this.#requireTarget();
        const chat = {
            title: input.title,
            prompt: input.text,
            attachments: input.attachments.map(toEnsembleImage),
            ...(input.model ? { model: input.model } : {}),
        };
        const providerThreadId =
            target.kind === 'thread'
                ? chatThreadId(
                      target.threadId,
                      (await this.#call(client => client.createChat(target.threadId, chat))).id,
                  )
                : await this.#call(async client => {
                      const thread = await client.createThread({
                          projectId: target.project.id,
                          ...chat,
                      });
                      return chatThreadId(thread.id, thread.chats[0]?.id ?? 'main');
                  });
        return { providerThreadId, url: this.threadUrl(providerThreadId) };
    }

    async sendMessage(input: SendMessageInput): Promise<void> {
        const { threadId, chatId } = parseChatThreadId(input.providerThreadId);
        await this.#call(client =>
            client.sendMessage(threadId, chatId, {
                text: input.text,
                attachments: input.attachments.map(toEnsembleImage),
            }),
        );
    }

    async interrupt(providerThreadId: string): Promise<void> {
        const { threadId, chatId } = parseChatThreadId(providerThreadId);
        await this.#call(client => client.stop(threadId, chatId));
    }

    watch(providerThreadId: string, sink: ThreadSink): () => void {
        const { threadId, chatId } = parseChatThreadId(providerThreadId);
        let feed = this.#feeds.get(threadId);
        if (!feed) {
            feed = new ThreadFeed(threadId, {
                onUnauthorized: () => this.#unauthorized(),
                log: this.options.log,
                timeouts: this.options.timeouts,
            });
            this.#feeds.set(threadId, feed);
        }
        const unwatch = feed.watch(chatId, sink);
        if (this.#client) feed.follow(this.#client);
        return () => {
            unwatch();
            if (!feed.watched) this.#feeds.delete(threadId);
        };
    }

    async dispose(): Promise<void> {
        this.#disposed = true;
        clearTimeout(this.#retry);
        for (const feed of this.#feeds.values()) feed.stop();
        this.#feeds.clear();
    }

    async #connect(): Promise<void> {
        clearTimeout(this.#retry);
        if (!(await new EnsembleClient({ baseUrl: this.#baseUrl }).isRunning())) {
            return this.#retryLater("Ensemble isn't running. Open the Ensemble app.");
        }
        const token = await this.#credentials.get(this.#baseUrl);
        if (!token) return this.#unauthorized();
        const client = new EnsembleClient({
            baseUrl: this.#baseUrl,
            token,
            timeoutMs: this.options.timeouts?.requestMs,
        });
        try {
            let target = this.#target;
            if (!target) {
                const found = await targetForFolder(client, this.options.projectRoot);
                if (found.kind === 'missing') {
                    // Retrying picks the project up once the user adds it in Ensemble.
                    return this.#retryLater(
                        `${basename(found.repository)} isn't in Ensemble yet. Add ${tildify(found.repository)} as a project in Ensemble.`,
                    );
                }
                target = found;
            }
            const label =
                target.kind === 'thread'
                    ? (await client.thread(target.threadId)).title
                    : `${target.project.name} · new thread per pin`;
            if (this.#disposed) return;
            this.#target = target;
            this.#client = client;
            this.#setInfo({ state: 'ready', target: label });
            for (const feed of this.#feeds.values()) feed.follow(client);
        } catch (error) {
            if (error instanceof EnsembleUnauthorizedError) return this.#unauthorized();
            if (error instanceof EnsembleHttpError && error.status === 404) {
                return this.#setInfo({
                    state: 'unavailable',
                    detail: 'This Ensemble thread is closed. Choose an open one.',
                });
            }
            this.#retryLater(`Ensemble didn't answer: ${errorMessage(error)}`);
        }
    }

    async #pair(): Promise<void> {
        this.#setInfo({ state: 'connecting', detail: 'Allow Tencil in the Ensemble app.' });
        try {
            const token = await new EnsembleClient({ baseUrl: this.#baseUrl }).connect();
            await this.#credentials.set(this.#baseUrl, token);
        } catch (error) {
            this.#setInfo({ state: 'unauthorized', canPair: true, detail: errorMessage(error) });
            throw error;
        }
        // A connect already under way read the old token; connect again once it's done.
        await this.#starting;
        await this.start();
    }

    /** Run a call once connected; a refused token asks the user to pair again. */
    async #call<T>(call: (client: EnsembleClient) => Promise<T>): Promise<T> {
        if (!this.#client) await this.start();
        const client = this.#client;
        if (!client) throw new Error(this.#info.detail ?? 'Not connected to Ensemble');
        try {
            return await call(client);
        } catch (error) {
            if (error instanceof EnsembleUnauthorizedError) this.#unauthorized();
            throw error;
        }
    }

    async #requireTarget(): Promise<Target> {
        if (!this.#target) await this.start();
        if (!this.#target) throw new Error(this.#info.detail ?? 'Not connected to Ensemble');
        return this.#target;
    }

    #unauthorized(): void {
        this.#client = undefined;
        for (const feed of this.#feeds.values()) feed.stop();
        this.#setInfo({
            state: 'unauthorized',
            canPair: true,
            detail: 'Not connected to Ensemble. Pair, then allow Tencil in the Ensemble app.',
        });
    }

    #retryLater(detail: string): void {
        this.#client = undefined;
        this.#setInfo({ state: 'unavailable', detail });
        if (this.#disposed) return;
        this.#retry = setTimeout(() => void this.start(), this.options.timeouts?.retryMs ?? 5_000);
        this.#retry.unref?.();
    }

    #setInfo(next: Omit<ProviderInfo, 'id' | 'label'>): void {
        if (this.#disposed) return;
        this.#info = { id: this.id, label: this.label, ...next };
        for (const listener of this.#listeners) listener(this.#info);
    }
}

/** A pin's id is its Ensemble thread and chat: `<threadId>/<chatId>`. */
function chatThreadId(threadId: string, chatId: string): string {
    return `${threadId}/${chatId}`;
}

function parseChatThreadId(providerThreadId: string): { threadId: string; chatId: string } {
    const [threadId, chatId, ...rest] = providerThreadId.split('/');
    if (!threadId || !chatId || rest.length) {
        throw new Error(`Not an Ensemble chat: ${providerThreadId}`);
    }
    return { threadId, chatId };
}

function tildify(path: string): string {
    const home = homedir();
    return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

function toEnsembleImage(image: ImageAttachment): EnsembleImage {
    return {
        name: image.name,
        mediaType: image.mimeType,
        data: image.dataUrl.slice(image.dataUrl.indexOf(',') + 1),
    };
}
