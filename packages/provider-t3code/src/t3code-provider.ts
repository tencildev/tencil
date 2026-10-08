import { randomUUID } from 'node:crypto';
import { access, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import type {
    CreatedThread,
    CreateThreadInput,
    Provider,
    ProviderInfo,
    ProviderProject,
    ProviderThreadSummary,
    SendMessageInput,
    ThreadSink,
} from '@fixhere/protocol';
import {
    CredentialStore,
    createLocalPairingCode,
    DEFAULT_T3_URL,
    exchangePairingCredential,
    normalizeBaseUrl,
    requestWebSocketTicket,
    UnauthorizedError,
} from './auth.ts';
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
    /** Defaults to the server `fixhere connect` paired with last, then localhost:3773. */
    baseUrl?: string;
    /** Explicit bearer token. Defaults to the one stored by `fixhere connect`. */
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
    timeouts?: { httpMs?: number; rpcMs?: number; retryMinMs?: number; retryMaxMs?: number };
    log?: (message: string) => void;
}

interface WireProject {
    id: string;
    title: string;
    workspaceRoot: string;
    defaultModelSelection?: ModelSelection | null;
    repositoryIdentity?: { owner?: string; name?: string; displayName?: string } | null;
    projectIcon?: { kind: 'emoji'; emoji: string } | { kind: string } | null;
}

interface WireServerProvider {
    instanceId: string;
    driver?: string;
    enabled: boolean;
    installed: boolean;
    status: string;
    models: Array<{ slug: string; isDefault?: boolean }>;
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
    modelSelection?: { instanceId?: string; provider?: string } | null;
}

interface Connection {
    token: string;
    /** instanceId → driver, filled lazily for provider icons. */
    drivers?: Map<string, string>;
    icon?: { url: string; expiresAt: number };
    socket: RpcSocket;
    protocol: ProtocolAdapter;
    environmentId: string;
    project: WireProject;
    modelSelection: ModelSelection;
}

const DEFAULT_TIMEOUTS = { httpMs: 8_000, rpcMs: 30_000, retryMinMs: 1_000, retryMaxMs: 15_000 };

export class T3CodeProvider implements Provider {
    readonly id = 't3code';
    readonly label = 'T3 Code';

    readonly #options: T3CodeProviderOptions;
    readonly #credentials: CredentialStore;
    #baseUrl: string;
    #info: ProviderInfo = { id: 't3code', label: 'T3 Code', state: 'connecting' };
    #infoListeners = new Set<(info: ProviderInfo) => void>();
    #connection: Connection | undefined;
    #watchers = new Map<string, Watcher>();
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
                detail: "Couldn't pair automatically. Run `npx fixhere connect` with a pairing link from T3 Code.",
            });
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

    async createThread(input: CreateThreadInput): Promise<CreatedThread> {
        const connection = this.#requireConnection();
        const threadId = randomUUID();
        await connection.protocol.startThread(connection.socket, {
            threadId,
            projectId: connection.project.id,
            title: input.title,
            text: input.text,
            attachments: input.attachments,
            modelSelection: connection.modelSelection,
            runtimeMode: this.#runtimeMode(),
            interactionMode: this.#options.interactionMode ?? 'default',
        });
        return { providerThreadId: threadId, url: this.#threadUrl(connection, threadId) };
    }

    async sendMessage(input: SendMessageInput): Promise<void> {
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
        const connection = this.#requireConnection();
        const turnId = this.#watchers.get(providerThreadId)?.tracker.activeTurnId();
        if (!turnId) return;
        await connection.protocol.interrupt(connection.socket, providerThreadId, turnId);
    }

    watch(providerThreadId: string, sink: ThreadSink): () => void {
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
                `Connected to T3 Code at ${this.#baseUrl} · project "${connection.project.title}" · ${connection.modelSelection.instanceId}/${connection.modelSelection.model} · protocol v${connection.protocol.version}`,
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
            orchestrationProtocolVersion?: number;
        }>(
            '/.well-known/t3/environment',
            undefined,
            `T3 Code isn't running at ${this.#baseUrl}. Open T3 Code and Fixhere connects on its own.`,
        );
        const protocol = environment.orchestrationProtocolVersion === 2 ? v2 : v1;

        const token = this.#options.token ?? (await this.#credentials.get(this.#baseUrl))?.token;
        if (!token) throw new UnauthorizedError();

        const ticket = await requestWebSocketTicket(this.#baseUrl, token, this.#timeouts.httpMs);
        const wsUrl = new URL('/ws', this.#baseUrl);
        wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
        if (protocol.version === 2) wsUrl.searchParams.set('orchestrationProtocol', '2');
        wsUrl.searchParams.set('wsTicket', ticket);
        const socket = await RpcSocket.open(wsUrl.toString());
        socket.requestTimeoutMs = this.#timeouts.rpcMs;

        try {
            const project = await this.#resolveProject(socket, protocol, token);
            const modelSelection =
                this.#options.modelSelection ??
                project.defaultModelSelection ??
                (await this.#defaultModelSelection(socket));

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
                project,
                modelSelection,
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

    async #defaultModelSelection(socket: RpcSocket): Promise<ModelSelection> {
        const config = await socket.request<{ providers: WireServerProvider[] }>(
            'server.getConfig',
            {},
        );
        const usable = config.providers.filter(
            provider => provider.enabled && provider.installed && provider.status !== 'error',
        );
        const provider = usable.find(p => p.status === 'ready') ?? usable[0];
        const model = provider?.models.find(m => m.isDefault) ?? provider?.models[0];
        if (!provider || !model) {
            throw new Error(
                'T3 Code has no usable provider. Set one up in T3 Code → Settings → Providers.',
            );
        }
        return { instanceId: provider.instanceId, model: model.slug };
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

    /* --------------------------------- helpers --------------------------------- */

    #threadUrl(connection: Connection, threadId: string): string {
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
