import { randomUUID } from 'node:crypto';
import { access, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import type {
    CreatedThread,
    CreateThreadInput,
    Provider,
    ProviderInfo,
    ProviderMachines,
    ProviderMessage,
    ProviderModels,
    ProviderProject,
    ProviderThreadSummary,
    SendMessageInput,
    ThreadSink,
} from '@tencildev/protocol';
import {
    CredentialStore,
    createLocalPairingCode,
    DEFAULT_T3_URL,
    exchangePairingCredential,
    normalizeBaseUrl,
    requestWebSocketTicket,
    UnauthorizedError,
} from './auth.ts';
import { McpClient, McpToolError } from './mcp-client.ts';
import {
    type ModelSources,
    modelId,
    modelOptions,
    pickedSelection,
    resolveModelSelection,
    type WireModelSettings,
    type WireServerProvider,
} from './model-selection.ts';
import type {
    ModelSelection,
    ProtocolAdapter,
    RuntimeMode,
    ThreadTracker,
} from './protocols/adapter.ts';
import { v1 } from './protocols/v1.ts';
import { v2 } from './protocols/v2.ts';
import { RpcError, RpcSocket } from './rpc-socket.ts';

export interface T3CodeProviderOptions {
    /** Directory the dev site lives in; mapped to a T3 Code project by workspace root. */
    projectRoot: string;
    /** Defaults to the server `tencil connect` paired with last, then localhost:3773. */
    baseUrl?: string;
    /** Explicit bearer token. Defaults to the one stored by `tencil connect`. */
    token?: string;
    credentials?: CredentialStore;
    modelSelection?: ModelSelection;
    runtimeMode?: RuntimeMode;
    interactionMode?: 'default' | 'plan';
    /** Register `projectRoot` as a T3 Code project when no project matches. */
    createProjectIfMissing?: boolean;
    /** Pair with a local T3 Code on its own when no token is stored. Defaults to true. */
    autoPair?: boolean;
    /** Mints a pairing code. Defaults to running the `t3` CLI matching the server version. */
    createPairingCode?: (baseUrl: string) => Promise<string | undefined>;
    timeouts?: {
        httpMs?: number;
        rpcMs?: number;
        retryMinMs?: number;
        retryMaxMs?: number;
        /** How often a thread on a linked machine is read while it works, and once idle. */
        remoteBusyMs?: number;
        remoteIdleMs?: number;
    };
    log?: (message: string) => void;
}

interface WireProject {
    id: string;
    title: string;
    workspaceRoot: string;
    defaultModelSelection?: ModelSelection | null;
    repositoryIdentity?: {
        canonicalKey?: string;
        origin?: { canonicalKey?: string };
        owner?: string;
        name?: string;
        displayName?: string;
    } | null;
    projectIcon?: { kind: 'emoji'; emoji: string } | { kind: string } | null;
}

interface Watcher {
    sink: ThreadSink;
    tracker: ThreadTracker;
    cancel?: () => void;
}

/** Loose view of a shell thread; V1 and V2 servers both send these fields. */
interface WireShellThread {
    id: string;
    projectId: string;
    title: string;
    updatedAt: string;
    archivedAt?: string | null;
    session?: { status?: string } | null;
    latestTurn?: { state?: string } | null;
    hasPendingApprovals?: boolean;
    hasPendingUserInput?: boolean;
    status?: string;
    branch?: string | null;
    linkedPullRequest?: { number: number; url: string } | null;
    branchPullRequest?: { number: number; url: string } | null;
    backgroundLiveness?: 'working' | 'monitoring' | null;
    modelSelection?: {
        instanceId?: string;
        provider?: string;
        model?: string;
        options?: unknown;
    } | null;
}

interface Connection {
    token: string;
    /** instanceId → driver, filled lazily for provider icons. */
    drivers?: Map<string, string>;
    icon?: { url: string; expiresAt: number };
    socket: RpcSocket;
    protocol: ProtocolAdapter;
    environmentId: string;
    /** The machine's name in T3 Code, e.g. `officebox`. */
    environmentLabel?: string;
    /** This T3 Code can link machines; without it Tencil never signs in to `/mcp`. */
    peerLinks: boolean;
    project: WireProject;
}

/** A thread on a linked machine; T3 Code only reaches it through `/mcp`, so it's polled. */
interface RemoteWatcher {
    sink: ThreadSink;
    /** Read again now, e.g. right after a message was sent. */
    poke: () => void;
    stop: () => void;
}

interface WireLink {
    environmentId: string;
    label: string;
    status: 'reachable' | 'unreachable' | 'expired';
    lastError?: string | null;
}

interface WireReadItem {
    position: number;
    itemId: string;
    type: string;
    status: string;
    text: string | null;
    updatedAt: string;
}

interface WireRead {
    thread: { status: string; activeRunId: string | null; pendingRequestCount?: number };
    items: WireReadItem[];
    nextPosition: number | null;
    hasMore: boolean;
}

/** Item states that don't change any more. */
const FINISHED_ITEMS = new Set(['completed', 'failed', 'cancelled', 'interrupted']);

const DEFAULT_TIMEOUTS = {
    httpMs: 8_000,
    rpcMs: 30_000,
    retryMinMs: 1_000,
    retryMaxMs: 15_000,
    // A linked machine's thread is polled: quickly while it works, slower once idle.
    remoteBusyMs: 2_000,
    remoteIdleMs: 15_000,
};

export class T3CodeProvider implements Provider {
    readonly id = 't3code';
    readonly label = 'T3 Code';

    readonly #options: T3CodeProviderOptions;
    readonly #credentials: CredentialStore;
    #baseUrl: string;
    #info: ProviderInfo = { id: 't3code', label: 'T3 Code', state: 'connecting', canPair: true };
    #infoListeners = new Set<(info: ProviderInfo) => void>();
    #connection: Connection | undefined;
    #watchers = new Map<string, Watcher>();
    #remoteWatchers = new Map<string, RemoteWatcher>();
    #mcp: McpClient | undefined;
    /** Linked machine → its project for this repository. */
    #remoteProjects = new Map<string, string>();
    readonly #timeouts: typeof DEFAULT_TIMEOUTS;
    #retryDelay: number;
    #retryTimer: ReturnType<typeof setTimeout> | undefined;
    #disposed = false;
    #connecting = false;
    /** Set once a project was resolved; later reconnects never re-create a deleted project. */
    #hadProject = false;
    /** Auto-pairing runs once per server; after that the user pairs explicitly. */
    #autoPaired = new Set<string>();

    constructor(options: T3CodeProviderOptions) {
        this.#options = options;
        this.#timeouts = { ...DEFAULT_TIMEOUTS, ...options.timeouts };
        this.#retryDelay = this.#timeouts.retryMinMs;
        this.#baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_T3_URL);
        this.#credentials = options.credentials ?? new CredentialStore();
    }

    async start(): Promise<void> {
        await this.#connect();
    }

    /**
     * Pair with the local T3 Code: mint a pairing code, exchange it for a token
     * and reconnect. Used automatically on first run and by the overlay's Pair button.
     */
    async pair(): Promise<void> {
        if (!this.#options.baseUrl) {
            const paired = await this.#credentials.lastBaseUrl();
            if (paired) this.#baseUrl = normalizeBaseUrl(paired);
        }
        this.#setInfo({ state: 'connecting', detail: 'Pairing with T3 Code…' });
        const mint = this.#options.createPairingCode ?? createLocalPairingCode;
        const code = await mint(this.#baseUrl).catch(() => undefined);
        if (!code) {
            this.#setInfo({
                state: 'unauthorized',
                detail: "Couldn't pair automatically. Run `npx tencil connect` with a pairing link from T3 Code.",
            });
            // Pairing may still happen elsewhere (setup, connect): keep looking for a token.
            this.#scheduleReconnect();
            return;
        }
        try {
            const credential = await exchangePairingCredential({
                baseUrl: this.#baseUrl,
                credential: code,
            });
            await this.#credentials.set(this.#baseUrl, credential);
            this.#log(`Paired with T3 Code at ${this.#baseUrl}`);
        } catch (error) {
            this.#setInfo({ state: 'unauthorized', detail: errorMessage(error) });
            this.#scheduleReconnect();
            return;
        }
        clearTimeout(this.#retryTimer);
        this.#retryDelay = this.#timeouts.retryMinMs;
        await this.#connect();
    }

    info(): ProviderInfo {
        return this.#info;
    }

    onInfoChange(listener: (info: ProviderInfo) => void): () => void {
        this.#infoListeners.add(listener);
        return () => this.#infoListeners.delete(listener);
    }

    async listThreads(): Promise<{ project: ProviderProject; threads: ProviderThreadSummary[] }> {
        const connection = this.#requireConnection();
        const [shell, drivers, project] = await Promise.all([
            this.#fetchJson<{ threads: WireShellThread[] }>(
                '/api/orchestration/shell',
                connection.token,
            ),
            this.#drivers(connection),
            this.#projectPresentation(connection),
        ]);
        const threads = shell.threads
            .filter(thread => thread.projectId === connection.project.id && !thread.archivedAt)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .map((thread): ProviderThreadSummary => {
                const pullRequest = thread.linkedPullRequest ?? thread.branchPullRequest;
                const instance =
                    thread.modelSelection?.instanceId ?? thread.modelSelection?.provider;
                return {
                    id: thread.id,
                    title: thread.title,
                    status: summaryStatus(thread),
                    updatedAt: thread.updatedAt,
                    url: this.#threadUrl(connection, thread.id),
                    ...(thread.branch ? { branch: thread.branch } : {}),
                    ...(pullRequest
                        ? { pullRequest: { number: pullRequest.number, url: pullRequest.url } }
                        : {}),
                    ...(thread.backgroundLiveness ? { background: thread.backgroundLiveness } : {}),
                    ...(instance ? { agent: drivers.get(instance) ?? instance } : {}),
                };
            });
        return { project, threads };
    }

    async #drivers(connection: Connection): Promise<Map<string, string>> {
        if (connection.drivers) return connection.drivers;
        const config = await connection.socket
            .request<{ providers: WireServerProvider[] }>('server.getConfig', {})
            .catch(() => ({ providers: [] }));
        connection.drivers = new Map(
            config.providers.map(provider => [
                provider.instanceId,
                provider.driver ?? provider.instanceId,
            ]),
        );
        return connection.drivers;
    }

    /** Everything that decides a new thread's model, read fresh: settings change while we run. */
    async #modelSources(connection: Connection): Promise<ModelSources> {
        const [config, shell] = await Promise.all([
            connection.socket.request<{
                providers: WireServerProvider[];
                settings?: WireModelSettings;
            }>('server.getConfig', {}),
            this.#fetchJson<{ projects: WireProject[]; threads: WireShellThread[] }>(
                '/api/orchestration/shell',
                connection.token,
            ),
        ]);
        const { id } = connection.project;
        const project = shell.projects.find(candidate => candidate.id === id);
        // Pinned threads are watched; they'd only echo the model Tencil picked itself.
        const recent = shell.threads
            .filter(thread => thread.projectId === id && !this.#watchers.has(thread.id))
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .flatMap(({ modelSelection: selection }) => {
                const instanceId = selection?.instanceId ?? selection?.provider;
                if (!instanceId || !selection?.model) return [];
                const { model, options } = selection;
                return [{ instanceId, model, ...(options ? { options } : {}) }];
            });
        return {
            providers: config.providers,
            settings: config.settings,
            projectId: id,
            projectDefault: (project ?? connection.project).defaultModelSelection,
            recent,
        };
    }

    /** Name like `owner/repo` and the project icon, matching T3 Code's sidebar. */
    async #projectPresentation(connection: Connection): Promise<ProviderProject> {
        const { project } = connection;
        const identity = project.repositoryIdentity;
        const name =
            identity?.owner && identity.name
                ? `${identity.owner}/${identity.name}`
                : (identity?.displayName ?? project.title);
        const override = project.projectIcon;
        if (override && override.kind === 'emoji' && 'emoji' in override) {
            return { name, emoji: override.emoji };
        }
        if (!connection.icon || connection.icon.expiresAt - 30_000 < Date.now()) {
            const signed = await connection.socket
                .request<{ relativeUrl: string; expiresAt: number }>('assets.createUrl', {
                    resource: { _tag: 'project-favicon', cwd: project.workspaceRoot },
                })
                .catch(() => null);
            if (signed) {
                // Older servers report seconds, newer ones milliseconds.
                const expiresAt =
                    signed.expiresAt < 1e12 ? signed.expiresAt * 1000 : signed.expiresAt;
                connection.icon = {
                    url: new URL(signed.relativeUrl, this.#baseUrl).toString(),
                    expiresAt,
                };
            }
        }
        return connection.icon ? { name, iconUrl: connection.icon.url } : { name };
    }

    threadUrl(providerThreadId: string): string | undefined {
        return this.#connection ? this.#threadUrl(this.#connection, providerThreadId) : undefined;
    }

    async listModels(): Promise<ProviderModels> {
        const connection = this.#requireConnection();
        const sources = await this.#modelSources(connection);
        const fallback = this.#options.modelSelection ?? resolveModelSelection(sources);
        return {
            models: modelOptions(sources.providers),
            ...(fallback ? { defaultModel: modelId(fallback) } : {}),
        };
    }

    /**
     * This machine, plus the machines T3 Code links to (Settings → Labs →
     * Linked environments). Only this machine when linking is off or unreachable.
     */
    async listMachines(): Promise<ProviderMachines> {
        const connection = this.#requireConnection();
        const here = {
            id: connection.environmentId,
            label: connection.environmentLabel ?? 'This machine',
            reachable: true,
        };
        const links = connection.peerLinks
            ? await this.#links().catch((error: unknown) => {
                  this.#log(`No linked machines: ${errorMessage(error)}`);
                  return [];
              })
            : [];
        return {
            machines: [
                here,
                ...links.map(link => ({
                    id: link.environmentId,
                    label: link.label,
                    reachable: link.status === 'reachable',
                    ...(link.status === 'reachable' ? {} : { detail: linkDetail(link) }),
                })),
            ],
            defaultMachine: here.id,
        };
    }

    async createThread(input: CreateThreadInput): Promise<CreatedThread> {
        const connection = this.#requireConnection();
        if (input.machine && input.machine !== connection.environmentId) {
            // Never quietly run somewhere else than the machine the user picked.
            const links = await this.#links().catch((error: unknown) => {
                throw new Error(
                    `Couldn't reach the machine picked for new threads (${errorMessage(error)}). Pick another one in the composer.`,
                );
            });
            const link = links.find(candidate => candidate.environmentId === input.machine);
            if (!link) {
                throw new Error(
                    'The machine picked for new threads is no longer linked in T3 Code. Pick another one in the composer.',
                );
            }
            return this.#createRemoteThread(connection, link, input);
        }
        const sources = await this.#modelSources(connection);
        const modelSelection =
            pickedSelection(sources.providers, input.model) ??
            this.#options.modelSelection ??
            resolveModelSelection(sources);
        if (!modelSelection) {
            throw new Error(
                'T3 Code has no usable provider. Set one up in T3 Code → Settings → Providers.',
            );
        }
        const threadId = randomUUID();
        this.#log(`New thread on ${modelId(modelSelection)}`);
        await connection.protocol.startThread(connection.socket, {
            threadId,
            projectId: connection.project.id,
            title: input.title,
            text: input.text,
            attachments: input.attachments,
            modelSelection,
            runtimeMode: this.#runtimeMode(),
            interactionMode: this.#options.interactionMode ?? 'default',
        });
        return { providerThreadId: threadId, url: this.#threadUrl(connection, threadId) };
    }

    async sendMessage(input: SendMessageInput): Promise<void> {
        const remote = parseRemoteId(input.providerThreadId);
        if (remote) {
            this.#requireConnection();
            await this.#requireMcp().call('t3_thread_send', {
                environmentId: remote.environmentId,
                threadId: remote.threadId,
                // A reply is shown as sent, so no note; screenshots just stay here.
                message: input.text,
                mode: 'auto',
            });
            this.#remoteWatchers.get(input.providerThreadId)?.poke();
            return;
        }
        const connection = this.#requireConnection();
        const tracker = this.#watchers.get(input.providerThreadId)?.tracker;
        await connection.protocol.sendMessage(connection.socket, {
            threadId: input.providerThreadId,
            text: input.text,
            attachments: input.attachments,
            busy: tracker?.status().status === 'working',
            runtimeMode: this.#runtimeMode(),
            interactionMode: this.#options.interactionMode ?? 'default',
        });
    }

    async interrupt(providerThreadId: string): Promise<void> {
        const remote = parseRemoteId(providerThreadId);
        if (remote) {
            this.#requireConnection();
            await this.#requireMcp().call('t3_thread_interrupt', {
                environmentId: remote.environmentId,
                threadId: remote.threadId,
            });
            this.#remoteWatchers.get(providerThreadId)?.poke();
            return;
        }
        const connection = this.#requireConnection();
        const turnId = this.#watchers.get(providerThreadId)?.tracker.activeTurnId();
        if (!turnId) return;
        await connection.protocol.interrupt(connection.socket, providerThreadId, turnId);
    }

    watch(providerThreadId: string, sink: ThreadSink): () => void {
        const remote = parseRemoteId(providerThreadId);
        if (remote) return this.#watchRemote(providerThreadId, remote, sink);
        this.#watchers.get(providerThreadId)?.cancel?.();
        const watcher: Watcher = {
            sink,
            tracker: (this.#connection?.protocol ?? v1).createTracker(),
        };
        this.#watchers.set(providerThreadId, watcher);
        if (this.#connection) this.#subscribe(this.#connection, providerThreadId, watcher);
        return () => {
            watcher.cancel?.();
            if (this.#watchers.get(providerThreadId) === watcher)
                this.#watchers.delete(providerThreadId);
        };
    }

    async dispose(): Promise<void> {
        this.#disposed = true;
        clearTimeout(this.#retryTimer);
        for (const watcher of this.#watchers.values()) watcher.cancel?.();
        this.#watchers.clear();
        for (const watcher of this.#remoteWatchers.values()) watcher.stop();
        this.#remoteWatchers.clear();
        this.#connection?.socket.close();
        this.#connection = undefined;
    }

    /* -------------------------------- connection ------------------------------- */

    async #connect(): Promise<void> {
        if (this.#disposed || this.#connecting) return;
        this.#connecting = true;
        let unauthorized = false;
        try {
            const connection = await this.#establish();
            this.#connection = connection;
            this.#retryDelay = this.#timeouts.retryMinMs;
            this.#setInfo({ state: 'ready', target: connection.project.title });
            this.#log(
                `Connected to T3 Code at ${this.#baseUrl} · project "${connection.project.title}" · protocol v${connection.protocol.version}`,
            );
            for (const [threadId, watcher] of this.#watchers) {
                this.#subscribe(connection, threadId, watcher);
            }
        } catch (error) {
            unauthorized = error instanceof UnauthorizedError;
            if (unauthorized) {
                this.#setInfo({ state: 'unauthorized', detail: (error as Error).message });
            } else {
                this.#setInfo({ state: 'unavailable', detail: errorMessage(error) });
            }
        } finally {
            this.#connecting = false;
        }
        if (this.#connection || this.#disposed) return;
        if (
            unauthorized &&
            (this.#options.autoPair ?? true) &&
            !this.#autoPaired.has(this.#baseUrl)
        ) {
            this.#autoPaired.add(this.#baseUrl);
            await this.pair();
            return;
        }
        this.#scheduleReconnect();
    }

    async #establish(): Promise<Connection> {
        if (!this.#options.baseUrl) {
            const paired = await this.#credentials.lastBaseUrl();
            if (paired) this.#baseUrl = normalizeBaseUrl(paired);
        }
        const environment = await this.#fetchJson<{
            environmentId: string;
            label?: string;
            orchestrationProtocolVersion?: number;
            capabilities?: { peerLinks?: boolean };
        }>(
            '/.well-known/t3/environment',
            undefined,
            `T3 Code isn't running at ${this.#baseUrl}. Open T3 Code and Tencil connects on its own.`,
        );
        const protocol = environment.orchestrationProtocolVersion === 2 ? v2 : v1;

        const token = this.#options.token ?? (await this.#credentials.get(this.#baseUrl))?.token;
        if (!token) {
            throw new UnauthorizedError(
                'Not paired with T3 Code yet. Press Pair, or run `npx tencil connect`.',
            );
        }

        const ticket = await requestWebSocketTicket(this.#baseUrl, token, this.#timeouts.httpMs);
        const wsUrl = new URL('/ws', this.#baseUrl);
        wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
        if (protocol.version === 2) wsUrl.searchParams.set('orchestrationProtocol', '2');
        wsUrl.searchParams.set('wsTicket', ticket);
        const socket = await RpcSocket.open(wsUrl.toString());
        socket.requestTimeoutMs = this.#timeouts.rpcMs;

        try {
            const project = await this.#resolveProject(socket, protocol, token);

            socket.onClose(reason => {
                if (this.#connection?.socket !== socket) return;
                this.#connection = undefined;
                for (const watcher of this.#watchers.values()) watcher.cancel = undefined;
                this.#setInfo({ state: 'connecting', detail: `Reconnecting (${reason})` });
                this.#scheduleReconnect();
            });
            return {
                token,
                socket,
                protocol,
                environmentId: environment.environmentId,
                ...(environment.label ? { environmentLabel: environment.label } : {}),
                peerLinks: environment.capabilities?.peerLinks === true,
                project,
            };
        } catch (error) {
            socket.close();
            throw error;
        }
    }

    #scheduleReconnect(): void {
        if (this.#disposed) return;
        clearTimeout(this.#retryTimer);
        this.#retryTimer = setTimeout(() => void this.#connect(), this.#retryDelay);
        this.#retryDelay = Math.min(this.#retryDelay * 2, this.#timeouts.retryMaxMs);
    }

    async #resolveProject(
        socket: RpcSocket,
        protocol: ProtocolAdapter,
        token: string,
    ): Promise<WireProject> {
        const root = await realpath(this.#options.projectRoot).catch(
            () => this.#options.projectRoot,
        );
        const shell = await this.#fetchJson<{ projects: WireProject[] }>(
            '/api/orchestration/shell',
            token,
        );
        // Deepest workspace root containing the dev project wins, so a package in a
        // monorepo maps to the repo-level project when it has none of its own. A
        // project above the repository (say ~/Code) is someone else's scope.
        const repository = await repositoryRoot(root);
        let match: WireProject | undefined;
        for (const project of shell.projects) {
            const projectRoot = await realpath(project.workspaceRoot).catch(
                () => project.workspaceRoot,
            );
            const contains =
                isInside(root, projectRoot) && (!repository || isInside(projectRoot, repository));
            if (contains && (!match || projectRoot.length > match.workspaceRoot.length)) {
                match = { ...project, workspaceRoot: projectRoot };
            }
        }
        if (match) {
            this.#hadProject = true;
            return match;
        }

        if (!this.#options.createProjectIfMissing || this.#hadProject) {
            throw new Error(`No T3 Code project for ${root}. Add the folder in T3 Code first.`);
        }
        const workspaceRoot = repository ?? root;
        const project: WireProject = {
            id: randomUUID(),
            title: basename(workspaceRoot),
            workspaceRoot,
            defaultModelSelection: null,
        };
        await protocol.createProject(socket, {
            projectId: project.id,
            title: project.title,
            workspaceRoot: project.workspaceRoot,
        });
        this.#log(`Added ${workspaceRoot} to T3 Code as project "${project.title}"`);
        this.#hadProject = true;
        return project;
    }

    /* --------------------------------- threads --------------------------------- */

    #subscribe(connection: Connection, threadId: string, watcher: Watcher): void {
        watcher.cancel?.();
        // Each subscription replays a full snapshot, so start from a clean slate.
        watcher.tracker = connection.protocol.createTracker();
        const stream = connection.socket.stream<unknown>(
            'orchestration.subscribeThread',
            { threadId },
            item => {
                const update = watcher.tracker.apply(item);
                for (const message of update.messages) watcher.sink.message(message);
                if (update.status) watcher.sink.status(update.status.status, update.status.detail);
                if (update.gone) watcher.sink.gone();
            },
        );
        watcher.cancel = stream.cancel;
        stream.done.catch((error: unknown) => {
            if (error instanceof RpcError && /not.?found/i.test(`${error.tag} ${error.message}`)) {
                watcher.sink.gone();
            }
        });
    }

    /* ----------------------------- linked machines ----------------------------- */

    #requireMcp(): McpClient {
        // Same server as the WebSocket; rebuilt if pairing moved to another one.
        if (this.#mcp?.baseUrl !== this.#baseUrl) {
            this.#remoteProjects.clear();
            this.#mcp = new McpClient({
                baseUrl: this.#baseUrl,
                credentials: this.#credentials,
                createPairingCode: this.#options.createPairingCode ?? createLocalPairingCode,
                timeoutMs: this.#timeouts.rpcMs,
                log: message => this.#log(message),
            });
        }
        return this.#mcp;
    }

    async #links(): Promise<WireLink[]> {
        const result = await this.#requireMcp().call<{ links: WireLink[] }>(
            't3_environment_links',
            {},
        );
        return result.links;
    }

    async #createRemoteThread(
        connection: Connection,
        link: WireLink,
        input: CreateThreadInput,
    ): Promise<CreatedThread> {
        if (link.status !== 'reachable') {
            throw new Error(`${link.label} can't be reached: ${linkDetail(link)}`);
        }
        const projectId = await this.#remoteProject(connection, link);
        this.#log(`New thread on ${link.label}`);
        const launched = await this.#requireMcp().call<{ threadId: string }>('t3_thread_launch', {
            environmentId: link.environmentId,
            projectId,
            title: input.title,
            // T3 Code can't send attachments to another machine yet.
            message: withoutScreenshotNote(input.text, input.attachments.length),
            runtimeMode: this.#runtimeMode(),
            interactionMode: this.#options.interactionMode ?? 'default',
        });
        const providerThreadId = remoteId(link.environmentId, launched.threadId);
        return {
            providerThreadId,
            url: this.#remoteThreadUrl(link.environmentId, launched.threadId),
        };
    }

    /** The linked machine's project for the same repository as this one. */
    async #remoteProject(connection: Connection, link: WireLink): Promise<string> {
        const known = this.#remoteProjects.get(link.environmentId);
        if (known) return known;
        const key = repositoryKey(connection.project);
        if (!key) {
            throw new Error(
                `"${connection.project.title}" has no git remote, so Tencil can't find it on ${link.label}.`,
            );
        }
        for (let cursor: number | null = 0; cursor !== null; ) {
            const page: { projects: WireProject[]; nextCursor: number | null } =
                await this.#requireMcp().call('t3_project_list', {
                    environmentId: link.environmentId,
                    limit: 100,
                    cursor,
                });
            const match = page.projects.find(project => repositoryKey(project) === key);
            if (match) {
                this.#remoteProjects.set(link.environmentId, match.id);
                return match.id;
            }
            cursor = page.nextCursor ?? null;
        }
        throw new Error(`${link.label} has no T3 Code project for ${key}. Add it there first.`);
    }

    /**
     * Polls a linked machine's thread: T3 Code forwards reads to it, but no
     * subscription. Fast while it works, slower when idle, again fast after a send.
     */
    #watchRemote(
        providerThreadId: string,
        remote: { environmentId: string; threadId: string },
        sink: ThreadSink,
    ): () => void {
        this.#remoteWatchers.get(providerThreadId)?.stop();
        const sent = new Map<string, string>();
        let lastStatus = '';
        /** Reads start after this position: before the oldest open item, else after the newest. */
        let cursor = -1;
        let failing = false;
        let stopped = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let delay = this.#timeouts.remoteBusyMs;

        const read = (args: Record<string, unknown>) =>
            this.#requireMcp().call<WireRead>('t3_thread_read', {
                environmentId: remote.environmentId,
                threadId: remote.threadId,
                view: 'messages',
                limit: 100,
                maxCharsPerItem: 20_000,
                ...args,
            });

        const tick = async () => {
            timer = undefined;
            if (stopped) return;
            try {
                if (!this.#connection) throw new Error('T3 Code is not connected yet');
                // Pages come oldest first; the first read starts at the beginning.
                const items: WireReadItem[] = [];
                let result: WireRead;
                let position = cursor;
                do {
                    result = await read({ afterPosition: position });
                    items.push(...result.items);
                    if (result.nextPosition === null) break;
                    position = result.nextPosition;
                } while (result.hasMore);
                if (stopped) return;
                failing = false;
                // A reply still being written is read again next time; finished ones aren't.
                const open = items.filter(item => !FINISHED_ITEMS.has(item.status));
                const newest = items.reduce((max, item) => Math.max(max, item.position), cursor);
                cursor = open.length ? Math.min(...open.map(item => item.position)) - 1 : newest;
                const working = result.thread.activeRunId !== null;
                for (const item of items.sort((a, b) => a.position - b.position)) {
                    const message = remoteMessage(item, working);
                    if (!message) continue;
                    const fingerprint = `${message.text}\u0000${message.streaming}`;
                    if (sent.get(message.id) === fingerprint) continue;
                    sent.set(message.id, fingerprint);
                    sink.message(message);
                }
                const status = remoteStatus(result.thread);
                if (status !== lastStatus) {
                    lastStatus = status;
                    sink.status(status);
                }
                delay =
                    status === 'idle' ? this.#timeouts.remoteIdleMs : this.#timeouts.remoteBusyMs;
            } catch (error) {
                if (error instanceof McpToolError && error.code === 'thread_not_found') {
                    stopped = true;
                    sink.gone();
                    return;
                }
                // Once per outage, not on every retry of a machine that's asleep.
                if (!failing) {
                    this.#log(`Couldn't read a thread on another machine: ${errorMessage(error)}`);
                }
                failing = true;
                delay = Math.min(delay * 2, this.#timeouts.retryMaxMs);
            }
            if (!stopped) timer = setTimeout(() => void tick(), delay);
        };

        const watcher: RemoteWatcher = {
            sink,
            poke: () => {
                delay = this.#timeouts.remoteBusyMs;
                if (timer) {
                    clearTimeout(timer);
                    timer = setTimeout(
                        () => void tick(),
                        Math.min(500, this.#timeouts.remoteBusyMs),
                    );
                }
            },
            stop: () => {
                stopped = true;
                clearTimeout(timer);
            },
        };
        this.#remoteWatchers.set(providerThreadId, watcher);
        void tick();
        return () => {
            watcher.stop();
            if (this.#remoteWatchers.get(providerThreadId) === watcher) {
                this.#remoteWatchers.delete(providerThreadId);
            }
        };
    }

    #remoteThreadUrl(environmentId: string, threadId: string): string {
        return `${this.#baseUrl}/${encodeURIComponent(environmentId)}/${encodeURIComponent(threadId)}`;
    }

    /* --------------------------------- helpers --------------------------------- */

    #threadUrl(connection: Connection, threadId: string): string {
        const remote = parseRemoteId(threadId);
        if (remote) return this.#remoteThreadUrl(remote.environmentId, remote.threadId);
        return `${this.#baseUrl}/${connection.environmentId}/${threadId}`;
    }

    #runtimeMode(): RuntimeMode {
        return this.#options.runtimeMode ?? 'full-access';
    }

    #requireConnection(): Connection {
        if (!this.#connection) {
            throw new Error(this.#info.detail ?? 'T3 Code is not connected yet');
        }
        return this.#connection;
    }

    async #fetchJson<T>(path: string, token?: string, unreachableMessage?: string): Promise<T> {
        let response: Response;
        try {
            response = await fetch(new URL(path, this.#baseUrl), {
                // A server mid-restart can accept the connection and never answer.
                signal: AbortSignal.timeout(this.#timeouts.httpMs),
                headers: {
                    'x-t3-orchestration-protocol': '2',
                    ...(token ? { authorization: `Bearer ${token}` } : {}),
                },
            });
        } catch {
            throw new Error(unreachableMessage ?? `Request to ${path} failed`);
        }
        if (response.status === 401 || response.status === 403) throw new UnauthorizedError();
        if (!response.ok) throw new Error(`${path} returned ${response.status}`);
        return (await response.json()) as T;
    }

    #setInfo(next: Omit<ProviderInfo, 'id' | 'label'>): void {
        const info: ProviderInfo = { id: this.id, label: this.label, canPair: true, ...next };
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

/**
 * A thread on a linked machine is `<environmentId>/<threadId>`; this machine's
 * stay bare, so existing pins keep working. Pins only store this id, so it
 * routes them after a restart too.
 */
export function remoteId(environmentId: string, threadId: string): string {
    return `${encodeURIComponent(environmentId)}/${encodeURIComponent(threadId)}`;
}

export function parseRemoteId(
    providerThreadId: string,
): { environmentId: string; threadId: string } | undefined {
    const slash = providerThreadId.indexOf('/');
    if (slash <= 0) return undefined;
    return {
        environmentId: decodeURIComponent(providerThreadId.slice(0, slash)),
        threadId: decodeURIComponent(providerThreadId.slice(slash + 1)),
    };
}

/** Forks share the upstream's key, as T3 Code groups them. */
function repositoryKey(project: WireProject): string | undefined {
    const identity = project.repositoryIdentity;
    return identity?.origin?.canonicalKey ?? identity?.canonicalKey;
}

function linkDetail(link: WireLink): string {
    if (link.status === 'expired') return 'The link expired. Link it again in T3 Code.';
    return link.lastError ?? 'It does not answer right now.';
}

/** The prompt says when a screenshot didn't come along, so the agent doesn't look for it. */
function withoutScreenshotNote(text: string, attachments: number): string {
    if (attachments === 0) return text;
    return `${text}\n\n(Screenshots can't be sent to this machine, so none are attached.)`;
}

function remoteMessage(item: WireReadItem, working: boolean): ProviderMessage | undefined {
    if (item.text === null) return undefined;
    const role = item.type === 'user_message' ? 'user' : 'assistant';
    const open = item.status === 'running' || item.status === 'pending';
    return {
        id: item.itemId,
        role,
        text: item.text,
        streaming: role === 'assistant' && working && open,
        createdAt: item.updatedAt,
    };
}

function remoteStatus(thread: WireRead['thread']): 'working' | 'waiting' | 'idle' | 'error' {
    // T3 Code reports a finished turn as `waiting` too; only open requests need the user.
    if ((thread.pendingRequestCount ?? 0) > 0) return 'waiting';
    if (thread.activeRunId !== null) return 'working';
    if (thread.status === 'failed') return 'error';
    return 'idle';
}

function summaryStatus(thread: WireShellThread): ProviderThreadSummary['status'] {
    if (thread.hasPendingApprovals || thread.hasPendingUserInput) return 'waiting';
    const session = thread.session?.status ?? thread.status;
    if (session === 'running' || session === 'starting') return 'working';
    if (thread.latestTurn?.state === 'running') return 'working';
    if (session === 'error' || thread.latestTurn?.state === 'error') return 'error';
    return 'idle';
}

/** The nearest folder at or above `dir` with a `.git` entry, if any. */
export async function repositoryRoot(dir: string): Promise<string | undefined> {
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

/** Whether `path` is `parent` or inside it, on any platform's separators. */
export function isInside(path: string, parent: string): boolean {
    const rel = relative(parent, path);
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
