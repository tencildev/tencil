import { batch, signal } from '@preact/signals';
import type {
    BuildInfo,
    ClientMessageInput,
    ProjectSettings,
    ProviderInfo,
    ProviderModel,
    ProviderProject,
    ProviderThreadSummary,
    ServerMessage,
    Thread,
    UpdateStatus,
} from '@tencildev/protocol';
import { forgetToken, signInRequired, storedToken, viewer } from './cloud-auth.ts';
import { newId } from './id.ts';

export type BridgeState = 'connecting' | 'open' | 'closed';

export const bridgeState = signal<BridgeState>('connecting');
/** The provider new pins go to. */
export const provider = signal<ProviderInfo | null>(null);
export const settings = signal<ProjectSettings | null>(null);
export const project = signal<{ name: string; root: string } | null>(null);
/** The daemon's Tencil version, from its `ready`. */
export const daemonVersion = signal<string | null>(null);
/** The daemon's updates: a newer version, an update in progress (null on Tencil Cloud). */
export const update = signal<UpdateStatus | null>(null);
/** The version the daemon ran before an update from this page restarted it. */
export const updatedFrom = signal<string | null>(null);
export const threads = signal<ReadonlyMap<string, Thread>>(new Map());
/** The provider's own threads for this project (null until first fetched). */
export const providerThreads = signal<ProviderThreadSummary[] | null>(null);
export const providerProject = signal<ProviderProject | null>(null);
/** Models the default provider can start threads on (null until fetched or unsupported). */
export const providerModels = signal<{
    provider: string;
    models: ProviderModel[];
    defaultModel?: string;
} | null>(null);
/** Set when the daemon can't tell which project this page belongs to. */
export const projectChoices = signal<Array<{ root: string; title: string }> | null>(null);
/** Set when the daemon refused this site; the developer can allow it at `approveUrl`. */
export const originBlocked = signal<{ origin: string; approveUrl: string } | null>(null);
/** What to do when there are no project choices. */
export const projectChoicesHint = signal<string | undefined>(undefined);
export const lastError = signal<{ message: string; threadId?: string; at: number } | null>(null);

let socket: WebSocket | undefined;
let retry = 500;
let bridgeUrl = '';
/** Set on Tencil Cloud builds, sent with every `hello`. */
let pageBuild: BuildInfo | undefined;
/** Repository root from the Vite or Next loader, so the daemon can find the project. */
let pageRoot: string | undefined;

export function connect(url: string, build?: BuildInfo, root?: string): void {
    bridgeUrl = url;
    pageBuild = build;
    pageRoot = root;
    // Allowing happens in another tab; try again as soon as the developer is back.
    window.addEventListener('focus', () => {
        if (originBlocked.value) reconnect();
    });
    open();
}

/** Tencil Cloud rather than the daemon on this machine. */
export function isCloud(): boolean {
    return pageBuild !== undefined;
}

export function cloudUrl(): string {
    return bridgeUrl;
}

/** Start over with a fresh `hello`, e.g. after signing in or out. */
export function reconnect(): void {
    const previous = socket;
    socket = undefined;
    previous?.close();
    retry = 500;
    open();
}

/** The token sent with the last `hello`, to forget it when Tencil Cloud rejects it. */
let sentToken: string | undefined;

/** Where the daemon runs, e.g. `localhost:4747`. */
export function daemonHost(): string {
    try {
        return new URL(bridgeUrl).host;
    } catch {
        return bridgeUrl;
    }
}

export function send(message: ClientMessageInput): boolean {
    if (socket?.readyState !== WebSocket.OPEN) {
        lastError.value = { message: 'Not connected to the Tencil bridge', at: Date.now() };
        return false;
    }
    socket.send(JSON.stringify(message));
    return true;
}

/** Optimistic insert so a new pin renders before the bridge round-trips. */
export function upsertLocal(thread: Thread): void {
    const next = new Map(threads.value);
    next.set(thread.id, thread);
    threads.value = next;
}

function open(): void {
    const wsUrl = new URL('/ws', bridgeUrl);
    wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    bridgeState.value = 'connecting';
    const ws = new WebSocket(wsUrl);
    socket = ws;

    sentToken = pageBuild ? storedToken(bridgeUrl) : undefined;
    ws.addEventListener('open', () => {
        retry = 500;
        ws.send(
            JSON.stringify({
                type: 'hello',
                protocol: 1,
                pageUrl: location.href,
                ...(pageRoot && { root: pageRoot }),
                ...(pageBuild && { build: pageBuild }),
                ...(sentToken && { token: sentToken }),
            }),
        );
    });
    ws.addEventListener('message', event => {
        try {
            handle(JSON.parse(String(event.data)) as ServerMessage);
        } catch (error) {
            console.warn('[tencil] bad message', error);
        }
    });
    ws.addEventListener('close', () => {
        if (socket !== ws) return;
        bridgeState.value = 'closed';
        // Retrying won't help until the site is allowed; coming back to the page will.
        if (originBlocked.value) return;
        // A daemon restarting on a new version is back in seconds: keep trying quickly.
        const restarting = update.value?.state === 'restarting';
        setTimeout(open, restarting ? 500 : retry);
        if (!restarting) retry = Math.min(retry * 2, 10_000);
    });
}

function handle(message: ServerMessage): void {
    switch (message.type) {
        case 'ready':
            batch(() => {
                bridgeState.value = 'open';
                originBlocked.value = null;
                signInRequired.value = null;
                viewer.value = message.viewer ?? null;
                projectChoices.value = null;
                provider.value = message.provider;
                settings.value = message.settings;
                project.value = message.project;
                if (update.value?.state === 'restarting') updatedFrom.value = daemonVersion.value;
                daemonVersion.value = message.version;
                update.value = message.update ?? null;
                threads.value = new Map(message.threads.map(thread => [thread.id, thread]));
            });
            return;
        case 'origin.blocked':
            originBlocked.value = { origin: message.origin, approveUrl: message.approveUrl };
            return;
        case 'project.unknown':
            batch(() => {
                bridgeState.value = 'open';
                originBlocked.value = null;
                projectChoices.value = message.choices;
                projectChoicesHint.value = message.emptyHint;
            });
            return;
        case 'auth.required':
            // A token we sent was refused (expired, revoked, another project): drop it.
            if (sentToken) forgetToken(bridgeUrl);
            batch(() => {
                bridgeState.value = 'open';
                viewer.value = null;
                signInRequired.value = { signIn: message.signIn, reason: message.reason };
            });
            return;
        case 'provider.status':
            provider.value = message.provider;
            return;
        case 'update':
            update.value = message.update;
            return;
        case 'settings':
            batch(() => {
                const switched = settings.value?.provider !== message.settings.provider;
                settings.value = message.settings;
                if (!switched) return;
                // The lists were the previous provider's.
                providerThreads.value = null;
                providerProject.value = null;
                providerModels.value = null;
            });
            return;
        case 'thread.upsert':
            upsertLocal(message.thread);
            return;
        case 'thread.removed': {
            const next = new Map(threads.value);
            next.delete(message.threadId);
            threads.value = next;
            return;
        }
        case 'provider.models':
            providerModels.value = {
                provider: message.provider,
                models: message.models,
                defaultModel: message.defaultModel,
            };
            return;
        case 'provider.threads':
            batch(() => {
                providerThreads.value = message.threads;
                providerProject.value = message.project;
            });
            return;
        case 'error':
            lastError.value = {
                message: message.message,
                threadId: message.threadId,
                at: Date.now(),
            };
            return;
    }
}

/** A provider's name, e.g. for a pin made with a provider that is no longer the default. */
export function providerLabel(id: string): string {
    return settings.value?.providers.find(option => option.id === id)?.label ?? id;
}

export function refreshProviderThreads(): void {
    if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'provider.threads' }));
    }
}

export function refreshProviderModels(): void {
    if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'provider.models' }));
    }
}

/** Open a provider thread in the dock, reusing an existing unpinned record. */
export function openProviderThread(summary: ProviderThreadSummary): string | null {
    for (const thread of threads.value.values()) {
        if (thread.provider.threadId === summary.id && !thread.anchor) return thread.id;
    }
    const id = newId();
    const sent = send({
        type: 'thread.open',
        id,
        providerThreadId: summary.id,
        title: summary.title,
    });
    return sent ? id : null;
}
