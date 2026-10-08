import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { basename, resolve } from 'node:path';
import type { Duplex } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type { Provider, ServerMessage } from '@fixhere/protocol';
import {
    type CredentialStore,
    listT3Projects,
    type ModelSelection,
    type RuntimeMode,
    T3CodeProvider,
    type T3CodeProviderOptions,
} from '@fixhere/provider-t3code';
import { WebSocket, WebSocketServer } from 'ws';
import { VERSION } from '../version.ts';
import { Bridge, type BridgeClient } from './bridge.ts';
import { type Exec, ProjectResolver } from './project-resolver.ts';
import { isAllowedHost, isAllowedOrigin, knownHostsFor } from './security.ts';
import { defaultDataDir, ThreadStore } from './thread-store.ts';

export const DEFAULT_PORT = 4747;
/** Screenshots ride along as data URLs. */
const MAX_PAYLOAD_BYTES = 32 * 1024 * 1024;

export interface DaemonOptions {
    port?: number;
    /** Main address; status checks and local tools use it. Defaults to 127.0.0.1. */
    host?: string;
    /** Extra addresses to listen on, e.g. a Tailscale IP for a remote browser. */
    listen?: string[];
    /** Extra origins allowed to connect, besides loopback ones. */
    allowedOrigins?: string[];
    /** Pins, credentials and remembered projects; defaults to ~/.config/fixhere. */
    dataDir?: string;
    t3?: Pick<T3CodeProviderOptions, 'autoPair' | 'createPairingCode' | 'timeouts'> & {
        url?: string;
        token?: string;
        credentials?: CredentialStore;
        modelSelection?: ModelSelection;
        runtimeMode?: RuntimeMode;
        createProjectIfMissing?: boolean;
    };
    /** Overrides how pages map to projects (tests). */
    resolveProject?: (pageUrl: string) => Promise<string | undefined>;
    /** Overrides process lookups for the default resolver (tests). */
    exec?: Exec;
    /** Build the provider for a project; defaults to T3 Code. */
    createProvider?: (root: string) => Provider;
    log?: (message: string) => void;
}

export interface ProjectStatus {
    root: string;
    name: string;
    clients: number;
    provider: ReturnType<Provider['info']>;
}

export interface Daemon {
    url: string;
    scriptUrl: string;
    port: number;
    projects(): ProjectStatus[];
    close(): Promise<void>;
}

interface Session {
    root: string;
    bridge: Bridge;
    provider: Provider;
    clients: number;
}

/**
 * One Fixhere daemon per machine. Pages load `/fixhere.js` from it; each
 * page's WebSocket is attached to the project it belongs to (worked out from
 * the dev server's port, or picked by the user), and every project gets its
 * own bridge, provider connection and pin store, created on first use.
 */
export async function startDaemon(options: DaemonOptions = {}): Promise<Daemon> {
    const port = options.port ?? DEFAULT_PORT;
    const host = options.host ?? '127.0.0.1';
    const addresses = [host, ...(options.listen ?? []).filter(address => address !== host)];
    const allowedOrigins = options.allowedOrigins ?? [];
    const knownHosts = knownHostsFor(addresses, allowedOrigins);
    const dataDir = options.dataDir ?? defaultDataDir();
    const log = options.log ?? (() => {});
    const resolver = new ProjectResolver({ dataDir, exec: options.exec });
    const resolveProject = options.resolveProject ?? (pageUrl => resolver.resolve(pageUrl));
    const sessions = new Map<string, Promise<Session>>();
    const overlayPath = resolveOverlayPath();

    const createProvider =
        options.createProvider ??
        ((root: string) => {
            const { url, token, ...t3 } = options.t3 ?? {};
            return new T3CodeProvider({
                ...t3,
                projectRoot: root,
                baseUrl: url ?? process.env.FIXHERE_T3_URL,
                token: token ?? process.env.FIXHERE_T3_TOKEN,
                createProjectIfMissing: t3.createProjectIfMissing ?? true,
                log: message => log(`[${basename(root)}] ${message}`),
            });
        });

    const session = (root: string): Promise<Session> => {
        const key = resolve(root);
        let pending = sessions.get(key);
        if (!pending) {
            pending = (async () => {
                const provider = createProvider(key);
                const store = new ThreadStore(key, dataDir);
                await store.load();
                const bridge = new Bridge({
                    provider,
                    store,
                    project: { name: basename(key), root: key },
                    version: VERSION,
                    log: message => log(`[${basename(key)}] ${message}`),
                });
                void provider.start();
                log(`Serving ${key}`);
                return { root: key, bridge, provider, clients: 0 };
            })();
            sessions.set(key, pending);
        }
        return pending;
    };

    const choices = async () =>
        (
            await listT3Projects({
                baseUrl: options.t3?.url ?? process.env.FIXHERE_T3_URL,
                token: options.t3?.token ?? process.env.FIXHERE_T3_TOKEN,
                credentials: options.t3?.credentials,
            })
        ).map(project => ({ root: project.workspaceRoot, title: project.title }));

    const settled = async () =>
        (await Promise.allSettled(sessions.values()))
            .filter((r): r is PromiseFulfilledResult<Session> => r.status === 'fulfilled')
            .map(r => r.value);
    let statuses: ProjectStatus[] = [];
    const refreshStatuses = async () => {
        statuses = (await settled()).map(s => ({
            root: s.root,
            name: basename(s.root),
            clients: s.clients,
            provider: s.provider.info(),
        }));
    };

    const handleRequest = async (request: IncomingMessage, response: ServerResponse) => {
        if (!isAllowedHost(request, knownHosts)) {
            response.writeHead(403, { 'content-type': 'text/plain' });
            return void response.end('Forbidden host');
        }
        const url = new URL(request.url ?? '/', 'http://localhost');
        if (url.pathname === '/fixhere.js') {
            try {
                const body = await readFile(overlayPath);
                response.writeHead(200, {
                    'content-type': 'text/javascript; charset=utf-8',
                    'cache-control': 'no-cache',
                    'access-control-allow-origin': '*',
                });
                response.end(body);
            } catch {
                response.writeHead(500, { 'content-type': 'text/plain' });
                response.end(`Overlay bundle missing at ${overlayPath}. Build it first.`);
            }
            return;
        }
        if (url.pathname === '/health') {
            await refreshStatuses();
            response.writeHead(200, { 'content-type': 'application/json' });
            // No CORS headers: pages can't read this, only local tools.
            return void response.end(
                JSON.stringify({
                    name: 'fixhere',
                    version: VERSION,
                    pid: process.pid,
                    projects: statuses,
                }),
            );
        }
        response.writeHead(404, { 'content-type': 'text/plain' });
        response.end('Not found');
    };

    const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
    const handleUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
        const url = new URL(request.url ?? '/', 'http://localhost');
        if (
            url.pathname !== '/ws' ||
            !isAllowedHost(request, knownHosts) ||
            !isAllowedOrigin(request, allowedOrigins)
        ) {
            socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
            return void socket.destroy();
        }
        wss.handleUpgrade(request, socket, head, ws => serveClient(ws));
    };

    /** A page connection: resolve its project on `hello`, then relay to that project's bridge. */
    function serveClient(ws: WebSocket): void {
        const client: BridgeClient = {
            send: (message: ServerMessage) => {
                if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
            },
        };
        let current: Session | undefined;
        let detach: (() => void) | undefined;
        let pageUrl = '';
        // Messages are processed in order even though attaching is async.
        let queue = Promise.resolve();

        const attach = async (root: string, hello: unknown) => {
            detach?.();
            if (current) current.clients--;
            current = await session(root);
            current.clients++;
            detach = current.bridge.connect(client);
            await current.bridge.handle(client, hello);
        };

        const handle = async (raw: unknown) => {
            const message = raw as { type?: string; pageUrl?: string; root?: string };
            if (message.type === 'hello') {
                pageUrl = message.pageUrl ?? '';
                const root = await resolveProject(pageUrl).catch(() => undefined);
                if (root) return attach(root, raw);
                return client.send({ type: 'project.unknown', pageUrl, choices: await choices() });
            }
            if (message.type === 'project.select' && message.root) {
                await resolver.remember(pageUrl, message.root);
                return attach(message.root, { type: 'hello', protocol: 1, pageUrl });
            }
            if (!current) return client.send({ type: 'error', message: 'No project selected yet' });
            await current.bridge.handle(client, raw);
        };

        ws.on('message', data => {
            let parsed: unknown;
            try {
                parsed = JSON.parse(String(data));
            } catch {
                return client.send({ type: 'error', message: 'Malformed JSON' });
            }
            queue = queue
                .then(() => handle(parsed))
                .catch((error: unknown) => {
                    client.send({
                        type: 'error',
                        message: error instanceof Error ? error.message : String(error),
                    });
                });
        });
        ws.on('close', () => {
            detach?.();
            if (current) current.clients--;
        });
    }

    const listenOn = (address: string, listenPort: number) =>
        new Promise<Server>((resolveListen, reject) => {
            const server = createServer(handleRequest);
            server.on('upgrade', handleUpgrade);
            server.once('error', reject);
            server.listen(listenPort, address, () => {
                server.off('error', reject);
                resolveListen(server);
            });
        });
    const servers = [await listenOn(host, port)];
    const address = servers[0]?.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    try {
        for (const extra of addresses.slice(1)) servers.push(await listenOn(extra, actualPort));
    } catch (error) {
        for (const server of servers) server.close();
        throw error;
    }
    const publicHost = host === '127.0.0.1' || host === '0.0.0.0' ? 'localhost' : host;
    const url = `http://${publicHost}:${actualPort}`;
    log(`Fixhere daemon listening on ${url}`);
    for (const extra of addresses.slice(1)) log(`Also listening on http://${extra}:${actualPort}`);

    return {
        url,
        scriptUrl: `${url}/fixhere.js`,
        port: actualPort,
        projects: () => statuses,
        async close() {
            for (const ws of wss.clients) ws.terminate();
            for (const s of await settled()) {
                await s.bridge.dispose();
                await s.provider.dispose();
            }
            await Promise.all(
                servers.map(server => new Promise<void>(done => server.close(() => done()))),
            );
        },
    };
}

/** Is a Fixhere daemon answering on this port? Returns its health report. */
export async function probeDaemon(
    port = DEFAULT_PORT,
    host = '127.0.0.1',
): Promise<{ version: string; pid: number; projects: ProjectStatus[] } | undefined> {
    try {
        const response = await fetch(`http://${host}:${port}/health`, {
            signal: AbortSignal.timeout(1_500),
        });
        const body = (await response.json()) as {
            name?: string;
            version: string;
            pid: number;
            projects?: ProjectStatus[];
        };
        return body.name === 'fixhere'
            ? { version: body.version, pid: body.pid, projects: body.projects ?? [] }
            : undefined;
    } catch {
        return undefined;
    }
}

/** Published builds ship the overlay next to this file; the monorepo uses the workspace build. */
function resolveOverlayPath(): string {
    const candidates = [
        fileURLToPath(new URL('./overlay.global.js', import.meta.url)),
        // dist/*.mjs in the workspace, and src/daemon/server.ts under vitest.
        fileURLToPath(new URL('../../overlay/dist/fixhere.global.js', import.meta.url)),
        fileURLToPath(new URL('../../../overlay/dist/fixhere.global.js', import.meta.url)),
    ];
    return candidates.find(candidate => existsSync(candidate)) ?? candidates[0]!;
}
