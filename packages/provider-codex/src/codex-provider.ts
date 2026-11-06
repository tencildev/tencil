import { randomUUID } from 'node:crypto';
import { access, realpath } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type {
    CreatedThread,
    CreateThreadInput,
    ImageAttachment,
    Provider,
    ProviderInfo,
    ProviderMessage,
    ProviderModel,
    ProviderModels,
    ProviderProject,
    ProviderThreadSummary,
    SendMessageInput,
    ThreadSink,
} from '@tencildev/protocol';
import {
    AppServer,
    errorMessage,
    METHOD_NOT_FOUND,
    RpcError,
    type SpawnAppServer,
} from './app-server.ts';
import { appServerSpawner } from './find-codex.ts';
import type {
    AccountRead,
    CodexModel,
    CodexPermissions,
    CodexThread,
    CodexTurn,
    Page,
    ThreadItemEntry,
} from './protocol.ts';
import {
    messagesFromHistory,
    NOT_SIGNED_IN,
    type RunStatus,
    type TrackerUpdate,
    TurnTracker,
} from './transcript.ts';

export interface CodexProviderOptions {
    /** Directory the dev site lives in; Codex runs in its repository root. */
    projectRoot: string;
    /** The Codex binary; defaults to the one on the PATH or in the desktop app. */
    command?: string;
    /** Defaults to Codex's own default model. */
    model?: string;
    /** Defaults to full access: nobody is at a terminal to approve anything. */
    permissions?: CodexPermissions;
    /** Tencil's version, which Codex records as its client. */
    version?: string;
    /** Close the Codex process after this long without anything running. Defaults to 10 minutes. */
    idleCloseMs?: number;
    /** How soon to look again while Codex is missing or signed out. Defaults to 15 seconds. */
    recheckMs?: number;
    /** Replaces starting `codex app-server` (tests). */
    spawn?: SpawnAppServer;
    log?: (message: string) => void;
}

const FULL_ACCESS: CodexPermissions = { sandbox: 'danger-full-access', approvalPolicy: 'never' };
const DEFAULT_IDLE_CLOSE_MS = 10 * 60_000;
const DEFAULT_RECHECK_MS = 15_000;
const PAGE_SIZE = 200;
/** Enough for the inbox; a project's older threads are still in Codex itself. */
const LISTED_THREADS = 100;

interface Session {
    id: string;
    tracker: TurnTracker;
    /** The conversation so far: the history from Codex plus live updates. */
    messages: Map<string, ProviderMessage>;
    sink?: ThreadSink;
    /** The server this thread is loaded on; any other has to resume it first. */
    server?: AppServer;
    /** Loaded the history once. */
    hydrated?: Promise<void>;
    /** Codex has no such thread (deleted, or never saved). */
    missing?: boolean;
}

/**
 * Runs Codex through `codex app-server`, under the user's own install and
 * login. The daemon hosts one process per project while there's work and Codex
 * stores the conversations, so threads are Codex threads (`codex resume <id>`
 * opens one in a terminal, and the desktop app lists them too).
 */
export class CodexProvider implements Provider {
    readonly id = 'codex';
    readonly label = 'Codex';

    readonly #options: CodexProviderOptions;
    #info: ProviderInfo = { id: 'codex', label: 'Codex', state: 'connecting' };
    readonly #infoListeners = new Set<(info: ProviderInfo) => void>();
    #workspace: Promise<string> | undefined;
    #server: Promise<AppServer> | undefined;
    /** The process behind `#server`, known from the moment it starts. */
    #current: AppServer | undefined;
    #idleTimer: ReturnType<typeof setTimeout> | undefined;
    #recheckTimer: ReturnType<typeof setTimeout> | undefined;
    readonly #sessions = new Map<string, Session>();
    #disposed = false;

    constructor(options: CodexProviderOptions) {
        this.#options = options;
    }

    /** Whether Codex is there and signed in. Looks again until it is: both happen outside Tencil. */
    async start(): Promise<void> {
        clearTimeout(this.#recheckTimer);
        try {
            const [server, workspace] = await Promise.all([this.#connect(), this.#workspaceRoot()]);
            const { account, requiresOpenaiAuth } = await server.request<AccountRead>(
                'account/read',
                {},
            );
            if (!account && requiresOpenaiAuth) {
                this.#signedOut(NOT_SIGNED_IN);
                return;
            }
            this.#setInfo({ state: 'ready', target: basename(workspace) });
            this.#log(`Codex ready in ${workspace}`);
        } catch (error) {
            this.#setInfo({ state: 'unavailable', detail: errorMessage(error) });
            this.#recheckLater();
        }
    }

    info(): ProviderInfo {
        return this.#info;
    }

    onInfoChange(listener: (info: ProviderInfo) => void): () => void {
        this.#infoListeners.add(listener);
        return () => this.#infoListeners.delete(listener);
    }

    async listThreads(): Promise<{ project: ProviderProject; threads: ProviderThreadSummary[] }> {
        const [server, workspace] = await Promise.all([this.#connect(), this.#workspaceRoot()]);
        const { data } = await server.request<Page<CodexThread>>('thread/list', {
            cwd: workspace,
            sortKey: 'updated_at',
            limit: LISTED_THREADS,
        });
        const threads = data.map(
            (thread): ProviderThreadSummary => ({
                id: thread.id,
                title: thread.name || thread.preview?.split('\n', 1)[0] || 'New thread',
                status: this.#status(thread.id).status,
                updatedAt: new Date(thread.updatedAt * 1000).toISOString(),
                ...(thread.gitInfo?.branch ? { branch: thread.gitInfo.branch } : {}),
                agent: 'codex',
            }),
        );
        return { project: { name: basename(workspace) }, threads };
    }

    async listModels(): Promise<ProviderModels> {
        const [server, workspace] = await Promise.all([this.#connect(), this.#workspaceRoot()]);
        const available = await pages<CodexModel>(cursor =>
            server.request('model/list', { cursor, limit: PAGE_SIZE }),
        );
        const models = available.filter(model => !model.hidden).map(toModel);
        // What a thread gets when it names no model: `--model`, then the user's config.
        const { config } = await server
            .request<{ config?: { model?: string | null } }>('config/read', { cwd: workspace })
            .catch(() => ({ config: undefined }));
        const configured = this.#options.model ?? config?.model ?? undefined;
        if (configured && !models.some(model => model.id === configured)) {
            models.unshift(toModel({ model: configured, displayName: configured }));
        }
        return {
            models,
            defaultModel: configured ?? available.find(model => model.isDefault)?.model,
        };
    }

    threadUrl(): string | undefined {
        return undefined;
    }

    async createThread(input: CreateThreadInput): Promise<CreatedThread> {
        const [server, workspace, model] = await Promise.all([
            this.#connect(),
            this.#workspaceRoot(),
            this.#modelFor(input.model),
        ]);
        const { thread } = await server.request<{ thread: CodexThread }>('thread/start', {
            ...this.#threadSettings(workspace),
            ...(model ? { model } : {}),
        });
        const session = this.#session(thread.id);
        session.server = server;
        // Nothing to load yet; the live turn is the whole conversation.
        session.hydrated = Promise.resolve();
        await server
            .request('thread/name/set', { threadId: thread.id, name: input.title })
            .catch((error: unknown) =>
                this.#log(`Couldn't name thread ${thread.id}: ${errorMessage(error)}`),
            );
        await this.#startTurn(session, server, input.text, input.attachments);
        return { providerThreadId: thread.id };
    }

    async sendMessage(input: SendMessageInput): Promise<void> {
        const session = this.#session(input.providerThreadId);
        const [server, workspace] = await Promise.all([this.#connect(), this.#workspaceRoot()]);
        if (session.server !== server) {
            await server.request('thread/resume', {
                threadId: session.id,
                excludeTurns: true,
                ...this.#threadSettings(workspace),
            });
            session.server = server;
        }
        await this.#startTurn(session, server, input.text, input.attachments);
    }

    async interrupt(providerThreadId: string): Promise<void> {
        const session = this.#sessions.get(providerThreadId);
        const turnId = session?.tracker.activeTurn();
        if (!session?.server || !turnId) return;
        await session.server.request('turn/interrupt', { threadId: session.id, turnId });
    }

    watch(providerThreadId: string, sink: ThreadSink): () => void {
        const session = this.#session(providerThreadId);
        session.sink = sink;
        void this.#hydrate(session).then(
            () => {
                if (session.sink !== sink) return;
                if (session.missing) return sink.gone();
                const messages = [...session.messages.values()].sort((a, b) =>
                    a.createdAt.localeCompare(b.createdAt),
                );
                for (const message of messages) sink.message(message);
                for (const step of session.tracker.steps()) sink.step?.(step);
                const status = this.#status(session.id);
                sink.status(status.status, status.detail);
            },
            (error: unknown) =>
                this.#log(`Couldn't load thread ${providerThreadId}: ${errorMessage(error)}`),
        );
        return () => {
            if (session.sink === sink) session.sink = undefined;
        };
    }

    async dispose(): Promise<void> {
        this.#disposed = true;
        clearTimeout(this.#recheckTimer);
        this.#closeServer();
        this.#sessions.clear();
    }

    /* --------------------------------- sessions -------------------------------- */

    /** A thread not running here is idle, or ended in an error. */
    #status(id: string): RunStatus {
        const status = this.#sessions.get(id)?.tracker.status();
        return status ?? { status: 'idle' };
    }

    #session(id: string): Session {
        let session = this.#sessions.get(id);
        if (!session) {
            session = { id, tracker: new TurnTracker(), messages: new Map() };
            this.#sessions.set(id, session);
        }
        return session;
    }

    /** Load the conversation Codex saved, once. */
    #hydrate(session: Session): Promise<void> {
        session.hydrated ??= (async () => {
            const server = await this.#connect();
            try {
                for (const message of messagesFromHistory(await readHistory(server, session.id))) {
                    // Live updates are newer than the history.
                    if (!session.messages.has(message.id)) {
                        session.messages.set(message.id, message);
                    }
                }
            } catch (error) {
                if (!isMissingThread(error)) throw error;
                session.missing = true;
            }
        })().catch((error: unknown) => {
            // Try again on the next watch rather than remember a failed load.
            session.hydrated = undefined;
            throw error;
        });
        return session.hydrated;
    }

    async #startTurn(
        session: Session,
        server: AppServer,
        text: string,
        attachments: ImageAttachment[],
    ): Promise<void> {
        // Codex keeps this id with the message, so a replay matches it.
        const clientUserMessageId = randomUUID();
        this.#emit(session, {
            id: clientUserMessageId,
            role: 'user',
            text,
            streaming: false,
            createdAt: new Date().toISOString(),
        });
        session.tracker.setStatus({ status: 'working' });
        session.sink?.status('working');
        try {
            // During a turn this adds to that turn, which is what a follow-up means then.
            const { turn } = await server.request<{ turn: CodexTurn }>('turn/start', {
                threadId: session.id,
                clientUserMessageId,
                // Unasked, Codex sends none, and a pin has nothing to show of its thinking.
                summary: 'concise',
                input: [
                    ...attachments.map(attachment => ({ type: 'image', url: attachment.dataUrl })),
                    { type: 'text', text, text_elements: [] },
                ],
            });
            session.tracker.noteTurn(turn.id);
        } catch (error) {
            const detail = errorMessage(error);
            session.tracker.setStatus({ status: 'error', detail });
            session.sink?.status('error', detail);
            throw error;
        }
    }

    #emit(session: Session, message: ProviderMessage): void {
        session.messages.set(message.id, message);
        session.sink?.message(message);
    }

    #applyUpdate(session: Session, update: TrackerUpdate): void {
        for (const message of update.messages) this.#emit(session, message);
        for (const step of update.steps) session.sink?.step?.(step);
        if (update.status) session.sink?.status(update.status.status, update.status.detail);
        if (update.unauthorized) this.#signedOut(update.unauthorized);
    }

    /* ------------------------------ the Codex process ----------------------------- */

    /** The running server, starting one if needed. Each use keeps it open a while longer. */
    #connect(): Promise<AppServer> {
        if (this.#disposed) return Promise.reject(new Error('Tencil is shutting down'));
        this.#keepOpen();
        this.#server ??= this.#startServer().catch((error: unknown) => {
            this.#server = undefined;
            throw error;
        });
        return this.#server;
    }

    async #startServer(): Promise<AppServer> {
        const spawn = appServerSpawner(this.#options);
        const server: AppServer = new AppServer(spawn(), {
            notification: (method, params) => this.#notification(method, params),
            request: (method, params) => this.#answer(method, params),
            closed: () => this.#serverClosed(server),
            log: message => this.#log(message),
        });
        this.#current = server;
        try {
            await server.initialize(this.#options.version ?? '0.0.0');
        } catch (error) {
            // It may be alive but stuck; don't leave it behind.
            server.close();
            throw error;
        }
        return server;
    }

    #notification(method: string, params: unknown): void {
        const threadId = (params as { threadId?: string } | undefined)?.threadId;
        if (method === 'deprecationNotice' || method === 'configWarning') {
            this.#log(`Codex: ${(params as { summary?: string }).summary ?? method}`);
            return;
        }
        const session = threadId ? this.#sessions.get(threadId) : undefined;
        if (!session) return;
        if (method === 'thread/closed') {
            session.server = undefined;
            return;
        }
        const update = session.tracker.apply(method, params);
        this.#applyUpdate(session, update);
        if (update.turnEnded) this.#keepOpen();
    }

    /**
     * What Codex asks for during a turn. Nobody is at a terminal to answer, so
     * whatever gets this far is refused and Codex carries on knowing that.
     */
    #answer(method: string, params: unknown): unknown {
        const { reason, command } = (params ?? {}) as { reason?: string; command?: string };
        const asked = reason ?? command ?? method;
        switch (method) {
            case 'item/commandExecution/requestApproval':
            case 'item/fileChange/requestApproval':
                this.#log(`Refused, nobody is here to approve it: ${asked}`);
                return { decision: 'decline' };
            case 'item/permissions/requestApproval':
                this.#log(`Refused, nobody is here to approve it: ${asked}`);
                return { permissions: {}, scope: 'turn' };
            case 'mcpServer/elicitation/request':
                return { action: 'decline', content: null, _meta: null };
            case 'item/tool/requestUserInput':
                return { answers: {} };
            default:
                throw new RpcError(METHOD_NOT_FOUND, `Tencil doesn't handle ${method}`);
        }
    }

    #serverClosed(server: AppServer): void {
        if (this.#current === server) {
            this.#current = undefined;
            this.#server = undefined;
            clearTimeout(this.#idleTimer);
        }
        for (const session of this.#sessions.values()) {
            if (session.server !== server) continue;
            session.server = undefined;
            const update = session.tracker.finish();
            // It ended mid-turn: report it rather than leave the pin spinning.
            if (session.tracker.status().status === 'working') {
                update.status = {
                    status: 'error',
                    detail: 'Codex stopped before the turn finished',
                };
                session.tracker.setStatus(update.status);
            }
            this.#applyUpdate(session, update);
        }
    }

    /** The process stays while anything uses it, and goes once nothing has for a while. */
    #keepOpen(): void {
        clearTimeout(this.#idleTimer);
        this.#idleTimer = setTimeout(() => {
            const working = [...this.#sessions.values()].some(
                session => session.tracker.status().status === 'working',
            );
            if (working) this.#keepOpen();
            else this.#closeServer();
        }, this.#options.idleCloseMs ?? DEFAULT_IDLE_CLOSE_MS);
        this.#idleTimer.unref?.();
    }

    #closeServer(): void {
        clearTimeout(this.#idleTimer);
        const server = this.#server;
        this.#current = undefined;
        this.#server = undefined;
        void server?.then(
            connected => connected.close(),
            () => {},
        );
    }

    /* --------------------------------- helpers --------------------------------- */

    #threadSettings(workspace: string) {
        return { cwd: workspace, ...(this.#options.permissions ?? FULL_ACCESS) };
    }

    /** The model a new thread asks for: the pick if Codex still offers it, then `--model`. */
    async #modelFor(picked: string | undefined): Promise<string | undefined> {
        if (!picked) return this.#options.model;
        const known = await this.listModels().catch(() => undefined);
        return known?.models.some(model => model.id === picked) ? picked : this.#options.model;
    }

    /** The repository root, so Codex sees the whole project and its AGENTS.md. */
    #workspaceRoot(): Promise<string> {
        this.#workspace ??= (async () => {
            const root = await realpath(this.#options.projectRoot).catch(
                () => this.#options.projectRoot,
            );
            return (await repositoryRoot(root)) ?? root;
        })();
        return this.#workspace;
    }

    /** Signed out: a fresh process reads the login made since, so look again with one. */
    #signedOut(detail: string): void {
        this.#setInfo({ state: 'unauthorized', detail });
        this.#recheckLater();
    }

    #recheckLater(): void {
        if (this.#disposed) return;
        clearTimeout(this.#recheckTimer);
        this.#recheckTimer = setTimeout(() => {
            const busy = [...this.#sessions.values()].some(
                session => session.tracker.status().status === 'working',
            );
            if (!busy) this.#closeServer();
            void this.start();
        }, this.#options.recheckMs ?? DEFAULT_RECHECK_MS);
        this.#recheckTimer.unref?.();
    }

    #setInfo(next: Omit<ProviderInfo, 'id' | 'label'>): void {
        const info: ProviderInfo = { id: this.id, label: this.label, ...next };
        if (
            info.state === this.#info.state &&
            info.detail === this.#info.detail &&
            info.target === this.#info.target
        ) {
            return;
        }
        this.#info = info;
        for (const listener of this.#infoListeners) listener(info);
    }

    #log(message: string): void {
        this.#options.log?.(message);
    }
}

function toModel(model: Pick<CodexModel, 'model' | 'displayName'>): ProviderModel {
    return { id: model.model, label: model.displayName, group: 'Codex', agent: 'codex' };
}

/**
 * A thread's items, page by page. Only threads Codex keeps paginated history
 * for can do that; for others (and threads it doesn't have) it answers "not
 * supported", and reading the whole thread is what's left.
 */
async function readHistory(server: AppServer, threadId: string): Promise<ThreadItemEntry[]> {
    try {
        return await pages<ThreadItemEntry>(cursor =>
            server.request('thread/items/list', { threadId, cursor, limit: PAGE_SIZE }),
        );
    } catch (error) {
        if (!(error instanceof RpcError && error.code === METHOD_NOT_FOUND)) throw error;
    }
    const { thread } = await server.request<{ thread: { turns: CodexTurn[] } }>('thread/read', {
        threadId,
        includeTurns: true,
    });
    return thread.turns.flatMap(turn =>
        (turn.items ?? []).map(item => ({
            item,
            startedAtMs: turn.startedAt ? turn.startedAt * 1000 : null,
        })),
    );
}

/** Every page of a cursor-paged list. */
async function pages<T>(fetch: (cursor: string | undefined) => Promise<Page<T>>): Promise<T[]> {
    const all: T[] = [];
    let cursor: string | undefined;
    do {
        const page = await fetch(cursor);
        all.push(...page.data);
        cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return all;
}

/** Codex only says so in words: `no rollout found for thread id …`, `thread not loaded: …`. */
function isMissingThread(error: unknown): boolean {
    return error instanceof RpcError && /no rollout|not found|not loaded/i.test(error.message);
}

/** The nearest folder at or above `dir` with a `.git` entry, if any. */
async function repositoryRoot(dir: string): Promise<string | undefined> {
    for (let current = dir; ; current = dirname(current)) {
        if (await exists(join(current, '.git'))) return current;
        if (dirname(current) === current) return undefined;
    }
}

const exists = (path: string) =>
    access(path).then(
        () => true,
        () => false,
    );
