import { access, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import type {
    CreatedThread,
    CreateThreadInput,
    ImageAttachment,
    Provider,
    ProviderInfo,
    ProviderModels,
    ProviderProject,
    ProviderThreadSummary,
    SendMessageInput,
    ThreadSink,
} from '@tencildev/protocol';
import { type AcpAgent, agentSpawner, type FindOptions } from './agents.ts';
import { AgentConnection, errorMessage, RpcError, type SpawnAgent } from './connection.ts';
import { type AgentModels, type ModelCache, modelSetting } from './models.ts';
import {
    type AgentCapabilities,
    type AuthMethod,
    type ContentBlock,
    ErrorCode,
    type PermissionOption,
    type RequestPermissionParams,
    type SessionInfo,
    type SessionUpdate,
    type StopReason,
} from './protocol.ts';
import { stopStatus, Transcript, type TranscriptUpdate } from './transcript.ts';

/**
 * What Tencil answers when the agent asks for permission, since nobody is at a
 * terminal to ask: everything, reading and editing files, or only reading.
 */
export type AcpPermissions = 'full-access' | 'edits' | 'read-only';

export interface AcpProviderOptions {
    agent: AcpAgent;
    /** Directory the dev site lives in; the agent works in its repository root. */
    projectRoot: string;
    /** Defaults to full access: nobody is at a terminal to approve anything. */
    permissions?: AcpPermissions;
    /** Tencil's version, which the agent sees as its client's. */
    version?: string;
    /** Close the agent after this long without anything running. Defaults to 10 minutes. */
    idleCloseMs?: number;
    /** How soon to look again while the agent is missing or signed out. Defaults to 15 seconds. */
    recheckMs?: number;
    /** Where the agent's models are kept between projects and restarts. */
    models?: ModelCache;
    /** Replaces starting the agent's command (tests). */
    spawn?: SpawnAgent;
    /** Where to look for the agent's program (tests). */
    find?: FindOptions;
    log?: (message: string) => void;
}

const DEFAULT_IDLE_CLOSE_MS = 10 * 60_000;
const DEFAULT_RECHECK_MS = 15_000;
/** Enough for the inbox; older sessions are still in the agent itself. */
const LISTED_THREADS = 100;

/** What each permission level allows without asking, by ACP tool kind. */
const ALLOWED_KINDS: Record<Exclude<AcpPermissions, 'full-access'>, ReadonlySet<string>> = {
    edits: new Set(['read', 'search', 'think', 'edit', 'delete', 'move']),
    'read-only': new Set(['read', 'search', 'think']),
};

/** A running agent process and what it said it can do. */
interface Agent {
    connection: AgentConnection;
    capabilities: AgentCapabilities;
    authMethods: AuthMethod[];
}

interface Session {
    id: string;
    transcript: Transcript;
    sink?: ThreadSink;
    /** The agent process the session is open on; any other has to load or resume it first. */
    connection?: AgentConnection;
    /** Loaded the conversation once, or started it here. */
    hydrated?: Promise<void>;
    /** Being made live on the current agent process. */
    opening?: Promise<Agent>;
    /** The agent has no such session. */
    missing?: boolean;
    /** Updates arriving now are a `session/load` replay, not a turn. */
    replaying?: boolean;
    /** Prompts run one after another: a follow-up during a turn waits for it to end. */
    queue: Promise<void>;
    /** Prompts sent or waiting. */
    pending: number;
}

/**
 * Runs any agent that speaks the Agent Client Protocol (Devin, Gemini CLI,
 * OpenCode, …) the way an editor does: its own command as a subprocess,
 * JSON-RPC over stdio, in the project's checkout under the user's own login.
 * One process per project while there's work. Threads are the agent's
 * sessions, so its own tools can open them, when it has any.
 */
export class AcpProvider implements Provider {
    readonly id: string;
    readonly label: string;

    readonly #options: AcpProviderOptions;
    #info: ProviderInfo;
    readonly #infoListeners = new Set<(info: ProviderInfo) => void>();
    #workspace: Promise<string> | undefined;
    /** The checkout, once known; the project folder until then. */
    #cwd: string;
    #agent: Promise<Agent> | undefined;
    /** The process behind `#agent`, known from the moment it starts. */
    #current: AgentConnection | undefined;
    #idleTimer: ReturnType<typeof setTimeout> | undefined;
    #recheckTimer: ReturnType<typeof setTimeout> | undefined;
    readonly #sessions = new Map<string, Session>();
    /** Loads replay a whole conversation each, so a restart with many pins takes them in turn. */
    #loads: Promise<unknown> = Promise.resolve();
    /** The agent's models, from its sessions or the cache. */
    #models: AgentModels | undefined;
    /** Read from the cache once, when the provider is made. */
    readonly #modelsCached: Promise<void>;
    #disposed = false;

    constructor(options: AcpProviderOptions) {
        this.#options = options;
        this.id = options.agent.id;
        this.label = options.agent.label;
        this.#info = { id: this.id, label: this.label, state: 'connecting' };
        this.#cwd = options.projectRoot;
        this.#modelsCached = (options.models?.get() ?? Promise.resolve(undefined)).then(
            cached => {
                this.#models ??= cached;
            },
            () => {},
        );
    }

    /** Whether the agent starts and answers. Looks again until it does: installing it happens outside Tencil. */
    async start(): Promise<void> {
        clearTimeout(this.#recheckTimer);
        try {
            const [, workspace] = await Promise.all([this.#connect(), this.#workspaceRoot()]);
            this.#setInfo({ state: 'ready', target: basename(workspace) });
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

    /** The agent's sessions in this project, when it can list them. */
    async listThreads(): Promise<{ project: ProviderProject; threads: ProviderThreadSummary[] }> {
        const [agent, workspace] = await Promise.all([this.#connect(), this.#workspaceRoot()]);
        const project = { name: basename(workspace) };
        if (!agent.capabilities.sessionCapabilities?.list) return { project, threads: [] };
        const sessions: SessionInfo[] = [];
        let cursor: string | undefined;
        do {
            const page = await agent.connection.request<{
                sessions: SessionInfo[];
                nextCursor?: string | null;
            }>('session/list', { cwd: workspace, ...(cursor ? { cursor } : {}) });
            sessions.push(...page.sessions);
            cursor = page.nextCursor ?? undefined;
        } while (cursor && sessions.length < LISTED_THREADS);
        const now = new Date().toISOString();
        const threads = sessions
            // Not every agent filters by folder.
            .filter(session => session.cwd === workspace)
            .map(
                (session): ProviderThreadSummary => ({
                    id: session.sessionId,
                    title: session.title?.split('\n', 1)[0]?.trim() || 'New thread',
                    status:
                        this.#sessions.get(session.sessionId)?.transcript.status().status ?? 'idle',
                    updatedAt: session.updatedAt ?? now,
                    agent: this.id,
                }),
            )
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .slice(0, LISTED_THREADS);
        return { project, threads };
    }

    threadUrl(): string | undefined {
        return undefined;
    }

    /**
     * The models the agent's sessions offer, once one of them has said: agents
     * name their models per session, so there are none before the first one.
     */
    async listModels(): Promise<ProviderModels> {
        await this.#modelsCached;
        const models = this.#models;
        if (!models) return { models: [] };
        return {
            models: models.choices.map(choice => ({
                id: choice.value,
                label: choice.name,
                group: choice.group ?? this.label,
                agent: this.id,
            })),
            ...(models.defaultModel ? { defaultModel: models.defaultModel } : {}),
        };
    }

    async createThread(input: CreateThreadInput): Promise<CreatedThread> {
        const [agent, workspace] = await Promise.all([this.#connect(), this.#workspaceRoot()]);
        const created = await this.#guard(
            agent.connection.request<{ sessionId: string; configOptions?: unknown }>(
                'session/new',
                { cwd: workspace, mcpServers: [] },
            ),
        );
        const { sessionId } = created;
        const session = this.#session(sessionId);
        session.connection = agent.connection;
        // Nothing to load yet; this turn is the whole conversation.
        session.hydrated = Promise.resolve();
        const setting = this.#learnModels(created.configOptions, true);
        if (input.model) await this.#pickModel(agent, sessionId, setting, input.model);
        this.#prompt(session, input.text, input.attachments);
        return { providerThreadId: sessionId };
    }

    async sendMessage(input: SendMessageInput): Promise<void> {
        const session = this.#session(input.providerThreadId);
        try {
            await this.#open(session);
        } catch (error) {
            const detail = errorMessage(error);
            session.transcript.setStatus({ status: 'error', detail });
            session.sink?.status('error', detail);
            throw error;
        }
        this.#prompt(session, input.text, input.attachments);
    }

    /** Stops the turn in progress. A message sent during it still goes once it has stopped. */
    async interrupt(providerThreadId: string): Promise<void> {
        const session = this.#sessions.get(providerThreadId);
        if (!session?.connection || session.pending === 0) return;
        session.connection.notify('session/cancel', { sessionId: session.id });
    }

    watch(providerThreadId: string, sink: ThreadSink): () => void {
        const session = this.#session(providerThreadId);
        session.sink = sink;
        void this.#hydrate(session).then(
            () => {
                if (session.sink !== sink) return;
                if (session.missing) return sink.gone();
                const messages = session.transcript
                    .messages()
                    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
                for (const message of messages) sink.message(message);
                for (const step of session.transcript.steps()) sink.step?.(step);
                const status = session.transcript.status();
                sink.status(status.status, status.detail);
            },
            (error: unknown) =>
                this.#log(`Couldn't load session ${providerThreadId}: ${errorMessage(error)}`),
        );
        return () => {
            if (session.sink === sink) session.sink = undefined;
        };
    }

    async dispose(): Promise<void> {
        this.#disposed = true;
        clearTimeout(this.#recheckTimer);
        this.#closeAgent();
        this.#sessions.clear();
    }

    /* --------------------------------- sessions -------------------------------- */

    #session(id: string): Session {
        let session = this.#sessions.get(id);
        if (!session) {
            session = {
                id,
                transcript: new Transcript(() => this.#cwd),
                queue: Promise.resolve(),
                pending: 0,
            };
            this.#sessions.set(id, session);
        }
        return session;
    }

    /**
     * A session this process didn't start: replay it with `session/load` when
     * the agent can, once. Without that the pin keeps what it showed before.
     */
    #hydrate(session: Session): Promise<void> {
        session.hydrated ??= (async () => {
            const agent = await this.#connect();
            if (!agent.capabilities.loadSession) return;
            try {
                await this.#load(session, agent);
            } catch (error) {
                if (!isMissingSession(error)) throw error;
                session.missing = true;
            }
        })().catch((error: unknown) => {
            // Try again on the next watch rather than remember a failed load.
            session.hydrated = undefined;
            throw error;
        });
        return session.hydrated;
    }

    /** Make the session live on the current agent process, so a prompt can go to it. */
    #open(session: Session): Promise<Agent> {
        session.opening ??= this.#reopen(session).finally(() => {
            session.opening = undefined;
        });
        return session.opening;
    }

    async #reopen(session: Session): Promise<Agent> {
        // A replay that's under way opens the session too; don't load it twice.
        await session.hydrated?.catch(() => {});
        const agent = await this.#connect();
        if (session.connection === agent.connection) return agent;
        const { loadSession, sessionCapabilities } = agent.capabilities;
        const canResume = Boolean(sessionCapabilities?.resume);
        const known = session.transcript.messages().length > 0;
        const workspace = await this.#workspaceRoot();
        try {
            if (canResume && (known || !loadSession)) {
                // Picking up without a replay; the pin already has the conversation.
                const resumed = await this.#guard(
                    agent.connection.request<{ configOptions?: unknown } | null>('session/resume', {
                        sessionId: session.id,
                        cwd: workspace,
                        mcpServers: [],
                    }),
                );
                this.#learnModels(resumed?.configOptions, false);
                if (!known) session.transcript.continueUnseen();
                session.connection = agent.connection;
            } else if (loadSession) {
                await this.#load(session, agent);
            } else {
                throw new Error(
                    `${this.label} can't pick up this conversation again: it can't load or resume sessions. Start a new pin to go on.`,
                );
            }
        } catch (error) {
            if (isMissingSession(error)) {
                session.missing = true;
                throw new Error(`This conversation no longer exists in ${this.label}`);
            }
            throw error;
        }
        session.hydrated ??= Promise.resolve();
        return agent;
    }

    /** `session/load`: the agent replays the conversation, then answers. */
    #load(session: Session, agent: Agent): Promise<void> {
        const load = this.#loads.then(async () => {
            const workspace = await this.#workspaceRoot();
            session.replaying = true;
            session.transcript.beginReplay();
            try {
                const loaded = await this.#guard(
                    agent.connection.request<{ configOptions?: unknown } | null>('session/load', {
                        sessionId: session.id,
                        cwd: workspace,
                        mcpServers: [],
                    }),
                );
                this.#learnModels(loaded?.configOptions, false);
            } catch (error) {
                session.transcript.abortReplay();
                throw error;
            } finally {
                session.replaying = false;
            }
            session.connection = agent.connection;
            for (const message of session.transcript.endReplay()) session.sink?.message(message);
        });
        this.#loads = load.catch(() => {});
        return load;
    }

    /** Queue a prompt; it starts once the turn before it, if any, has ended. */
    #prompt(session: Session, text: string, attachments: ImageAttachment[]): void {
        session.pending += 1;
        if (session.transcript.status().status !== 'working') {
            session.transcript.setStatus({ status: 'working' });
            session.sink?.status('working');
        }
        session.queue = session.queue
            .then(() => this.#run(session, text, attachments))
            .finally(() => {
                session.pending -= 1;
                this.#keepOpen();
            });
    }

    async #run(session: Session, text: string, attachments: ImageAttachment[]): Promise<void> {
        let agent: Agent | undefined;
        try {
            agent = await this.#open(session);
            const prompt = this.#content(agent, text, attachments);
            this.#apply(session, session.transcript.prompt(text));
            const { stopReason } = await this.#guard(
                agent.connection.request<{ stopReason: StopReason }>(
                    'session/prompt',
                    { sessionId: session.id, prompt },
                    0,
                ),
            );
            const update = session.transcript.finish(stopStatus(stopReason, this.label));
            if (update.status?.status === 'idle' && session.pending > 1) {
                // The next message goes right away; don't flash the pin done in between.
                session.transcript.setStatus({ status: 'working' });
                update.status = undefined;
            }
            this.#apply(session, update);
        } catch (error) {
            const stopped = agent?.connection.closed;
            if (stopped) this.#log(errorMessage(error));
            const detail = stopped
                ? `${this.label} stopped before the turn finished`
                : errorMessage(error);
            this.#apply(session, session.transcript.finish({ status: 'error', detail }));
        }
    }

    /** Images first, then the text; images only when the agent takes them. */
    #content(agent: Agent, text: string, attachments: ImageAttachment[]): ContentBlock[] {
        const images = agent.capabilities.promptCapabilities?.image ? attachments : [];
        if (images.length < attachments.length) {
            this.#log(`${this.label} doesn't take images; sent the text alone`);
        }
        return [
            ...images.map(image => ({
                type: 'image',
                mimeType: image.mimeType,
                data: image.dataUrl.replace(/^data:[^,]*,/, ''),
            })),
            { type: 'text', text },
        ];
    }

    /**
     * What a session's settings say about the agent's models. A session that
     * was just made is on the default, so its model is noted as that.
     */
    #learnModels(configOptions: unknown, fresh: boolean): ReturnType<typeof modelSetting> {
        const setting = modelSetting(configOptions);
        if (!setting) return undefined;
        const defaultModel = fresh ? setting.current : this.#models?.defaultModel;
        this.#models = { ...setting.models, ...(defaultModel ? { defaultModel } : {}) };
        this.#options.models?.set(this.#models);
        return setting;
    }

    /** Put a new session on the model picked for it, when the agent has that one. */
    async #pickModel(
        agent: Agent,
        sessionId: string,
        setting: ReturnType<typeof modelSetting>,
        model: string,
    ): Promise<void> {
        if (!setting || setting.current === model) return;
        if (!setting.models.choices.some(choice => choice.value === model)) {
            this.#log(`${this.label} doesn't offer ${model} here; it runs on its default`);
            return;
        }
        try {
            const result = await agent.connection.request<{ configOptions?: unknown } | null>(
                'session/set_config_option',
                { sessionId, configId: setting.models.configId, value: model },
            );
            this.#learnModels(result?.configOptions, false);
        } catch (error) {
            this.#log(`${this.label} didn't switch to ${model}: ${errorMessage(error)}`);
        }
    }

    #apply(session: Session, update: TranscriptUpdate): void {
        for (const message of update.messages) session.sink?.message(message);
        for (const step of update.steps) session.sink?.step?.(step);
        if (update.status) session.sink?.status(update.status.status, update.status.detail);
    }

    /* ------------------------------ the agent process ----------------------------- */

    /** The running agent, starting one if needed. Each use keeps it open a while longer. */
    #connect(): Promise<Agent> {
        if (this.#disposed) return Promise.reject(new Error('Tencil is shutting down'));
        this.#keepOpen();
        this.#agent ??= this.#startAgent().catch((error: unknown) => {
            this.#agent = undefined;
            throw error;
        });
        return this.#agent;
    }

    async #startAgent(): Promise<Agent> {
        const spawn = agentSpawner(this.#options.agent, {
            ...this.#options.find,
            spawn: this.#options.spawn,
        });
        const workspace = await this.#workspaceRoot();
        const connection: AgentConnection = new AgentConnection(this.label, spawn(workspace), {
            notification: (method, params) => this.#notification(connection, method, params),
            request: (method, params) => this.#answer(method, params),
            closed: () => this.#agentClosed(connection),
            log: message => this.#log(message),
        });
        this.#current = connection;
        try {
            const init = await connection.initialize(this.#options.version ?? '0.0.0');
            const about = init.agentInfo
                ? ` (${init.agentInfo.name} ${init.agentInfo.version})`
                : '';
            this.#log(`${this.label} ready in ${workspace}${about}`);
            return {
                connection,
                capabilities: init.agentCapabilities ?? {},
                authMethods: init.authMethods ?? [],
            };
        } catch (error) {
            // It may be alive but stuck; don't leave it behind.
            connection.close();
            throw error;
        }
    }

    #notification(connection: AgentConnection, method: string, params: unknown): void {
        if (method !== 'session/update') return;
        const { sessionId, update } = params as { sessionId: string; update: SessionUpdate };
        if (update.sessionUpdate === 'config_option_update') {
            this.#learnModels((update as { configOptions?: unknown }).configOptions, false);
            return;
        }
        const session = this.#sessions.get(sessionId);
        // Updates from a process the session has left are stale.
        if (!session || (!session.replaying && session.connection !== connection)) return;
        const result = session.transcript.apply(update);
        if (!session.replaying) this.#apply(session, result);
    }

    /** What the agent asks of Tencil, as its client. */
    async #answer(method: string, params: unknown): Promise<unknown> {
        switch (method) {
            case 'session/request_permission':
                return this.#permission(params as RequestPermissionParams);
            case 'fs/read_text_file': {
                const { path, line, limit } = params as {
                    path: string;
                    line?: number | null;
                    limit?: number | null;
                };
                const text = await readFile(absolute(path), 'utf8');
                if (!line && !limit) return { content: text };
                const start = Math.max((line ?? 1) - 1, 0);
                const lines = text.split('\n');
                return {
                    content: lines.slice(start, limit ? start + limit : undefined).join('\n'),
                };
            }
            case 'fs/write_text_file': {
                const { path, content } = params as { path: string; content: string };
                if (this.#permissions() === 'read-only') {
                    this.#log(`Refused, nobody is here to approve it: writing ${path}`);
                    throw new RpcError(
                        ErrorCode.internal,
                        'Writing files needs approval, and nobody is here to give it',
                    );
                }
                const file = absolute(path);
                await mkdir(dirname(file), { recursive: true });
                await writeFile(file, content);
                return {};
            }
            default:
                throw new RpcError(ErrorCode.methodNotFound, `Tencil doesn't handle ${method}`);
        }
    }

    /**
     * Nobody is at a terminal to answer, so the permission level decides: allow
     * once, or refuse and let the agent carry on knowing that.
     */
    #permission({ toolCall, options }: RequestPermissionParams): unknown {
        const level = this.#permissions();
        const allowed = level === 'full-access' || ALLOWED_KINDS[level].has(toolCall.kind ?? '');
        const prefer: Array<PermissionOption['kind']> = allowed
            ? ['allow_once', 'allow_always']
            : ['reject_once', 'reject_always'];
        const option = prefer
            .map(kind => options.find(candidate => candidate.kind === kind))
            .find(Boolean);
        if (!allowed) {
            this.#log(`Refused, nobody is here to approve it: ${toolCall.title ?? toolCall.kind}`);
        }
        return option
            ? { outcome: { outcome: 'selected', optionId: option.optionId } }
            : { outcome: { outcome: 'cancelled' } };
    }

    #permissions(): AcpPermissions {
        return this.#options.permissions ?? 'full-access';
    }

    #agentClosed(connection: AgentConnection): void {
        if (this.#current === connection) {
            this.#current = undefined;
            this.#agent = undefined;
            clearTimeout(this.#idleTimer);
        }
        // A prompt in flight fails on its own and says so; the rest are opened again on use.
        for (const session of this.#sessions.values()) {
            if (session.connection === connection) session.connection = undefined;
        }
    }

    /**
     * The process stays while anything uses it and goes once nothing has for a
     * while, unless the agent can't take a session up again in a new one.
     */
    #keepOpen(): void {
        clearTimeout(this.#idleTimer);
        this.#idleTimer = setTimeout(() => {
            void this.#idle();
        }, this.#options.idleCloseMs ?? DEFAULT_IDLE_CLOSE_MS);
        this.#idleTimer.unref?.();
    }

    async #idle(): Promise<void> {
        const sessions = [...this.#sessions.values()];
        if (sessions.some(session => session.pending > 0 || session.replaying)) {
            return this.#keepOpen();
        }
        const agent = await this.#agent?.catch(() => undefined);
        const { loadSession, sessionCapabilities } = agent?.capabilities ?? {};
        const strands =
            !loadSession &&
            !sessionCapabilities?.resume &&
            sessions.some(
                session => session.connection && session.connection === agent?.connection,
            );
        if (strands) return this.#keepOpen();
        this.#closeAgent();
    }

    #closeAgent(): void {
        clearTimeout(this.#idleTimer);
        const agent = this.#agent;
        this.#current = undefined;
        this.#agent = undefined;
        void agent?.then(
            running => running.connection.close(),
            () => {},
        );
    }

    /* --------------------------------- helpers --------------------------------- */

    /** Notes an answer that says the agent isn't signed in, then passes the error on. */
    async #guard<T>(request: Promise<T>): Promise<T> {
        try {
            return await request;
        } catch (error) {
            if (!isAuthRequired(error)) throw error;
            const agent = await this.#agent?.catch(() => undefined);
            const detail = this.#signInHint(agent?.authMethods ?? []);
            this.#signedOut(detail);
            throw new Error(detail);
        }
    }

    #signInHint(methods: AuthMethod[]): string {
        const how =
            this.#options.agent.login ??
            methods.find(method => method.description)?.description ??
            'Sign in to it in a terminal, then try again.';
        return `${this.label} is not signed in. ${how.replace(/\.?$/, '.')}`;
    }

    /** The repository root, so the agent sees the whole project and its instructions. */
    #workspaceRoot(): Promise<string> {
        this.#workspace ??= (async () => {
            const root = await realpath(this.#options.projectRoot).catch(
                () => this.#options.projectRoot,
            );
            this.#cwd = (await repositoryRoot(root)) ?? root;
            return this.#cwd;
        })();
        return this.#workspace;
    }

    /** Signed out: a fresh process reads a login made since, so look again with one. */
    #signedOut(detail: string): void {
        this.#setInfo({ state: 'unauthorized', detail });
        this.#recheckLater();
    }

    #recheckLater(): void {
        if (this.#disposed) return;
        clearTimeout(this.#recheckTimer);
        this.#recheckTimer = setTimeout(() => {
            const busy = [...this.#sessions.values()].some(session => session.pending > 0);
            if (!busy) this.#closeAgent();
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

function isAuthRequired(error: unknown): boolean {
    return error instanceof RpcError && error.code === ErrorCode.authRequired;
}

/** `-32002` is ACP's "not found"; agents that predate it say so in words. */
function isMissingSession(error: unknown): boolean {
    return (
        error instanceof RpcError &&
        (error.code === ErrorCode.resourceNotFound ||
            /session.*(not found|does not exist|unknown)|no such session/i.test(error.message))
    );
}

/** ACP paths are absolute; refuse anything else rather than guess what it's relative to. */
function absolute(path: string): string {
    if (typeof path !== 'string' || !isAbsolute(path)) {
        throw new RpcError(ErrorCode.invalidParams, `Not an absolute path: ${String(path)}`);
    }
    return path;
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
