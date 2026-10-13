import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import {
    type BuildInfo,
    type ClientMessageInput,
    type CreatedThread,
    type CreateThreadInput,
    PROTOCOL_VERSION,
    type Provider,
    type ProviderInfo,
    type SendMessageInput,
    type ServerMessage,
    type Thread,
    type ThreadSink,
} from '@tencildev/protocol';
import { WebSocket } from 'ws';
import type { CloudCredentials } from './credentials.ts';

/** What a project's checkout says about where Tencil Cloud should work. */
export interface Checkout {
    /** `owner/name` on GitHub. */
    repo: string;
    branch: string;
    sha: string;
}

export interface TencilCloudProviderOptions {
    projectRoot: string;
    credentials: CloudCredentials;
    /** Reads the checkout's GitHub repository, branch and commit; git by default. */
    checkout?: (root: string) => Promise<Checkout>;
    fetch?: typeof fetch;
    /** Opens the runner's socket (tests). */
    connect?: (url: string) => WebSocket;
    log?: (message: string) => void;
}

const RECONNECT_MS = [1000, 2000, 5000, 10_000, 30_000];

/**
 * Tencil Cloud as a provider of the local daemon: pins go to a sandboxed
 * agent that works on the branch as it is on GitHub and pushes a pull request.
 * The daemon is a client of the runner, like a preview's overlay: same socket,
 * same runs, queue and billing, signed in with the machine's `tencil login`.
 * Uncommitted and unpushed changes aren't part of it.
 */
export class TencilCloudProvider implements Provider {
    readonly id = 'cloud';
    readonly label = 'Tencil Cloud';
    readonly #options: TencilCloudProviderOptions;
    readonly #fetch: typeof fetch;
    readonly #listeners = new Set<(info: ProviderInfo) => void>();
    readonly #sinks = new Map<string, ThreadSink>();
    readonly #threads = new Map<string, Thread>();
    /** What each sink was last told, so an upsert only reports what changed. */
    readonly #reported = new Map<string, Map<string, string>>();
    #info: ProviderInfo = { id: 'cloud', label: 'Tencil Cloud', state: 'connecting' };
    #socket: WebSocket | undefined;
    #ready: Promise<void> | undefined;
    #build: BuildInfo | undefined;
    #attempt = 0;
    #disposed = false;
    #reconnect: ReturnType<typeof setTimeout> | undefined;

    constructor(options: TencilCloudProviderOptions) {
        this.#options = options;
        this.#fetch = options.fetch ?? fetch;
    }

    async start(): Promise<void> {
        await this.#connected().catch(() => undefined);
    }

    info(): ProviderInfo {
        return this.#info;
    }

    onInfoChange(listener: (info: ProviderInfo) => void): () => void {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }

    async listThreads() {
        return { project: { name: this.#build?.repo ?? 'Tencil Cloud' }, threads: [] };
    }

    threadUrl(providerThreadId: string): string | undefined {
        return this.#threads.get(providerThreadId)?.delivery?.pullRequest?.url;
    }

    async createThread(input: CreateThreadInput): Promise<CreatedThread> {
        await this.#connected({ checkoutChanged: true });
        const id = `cloud-${randomUUID()}`;
        const pin = input.pin ?? {
            // A batch: its text already holds every comment and element.
            prompt: input.text,
            pageUrl: 'about:blank',
            anchor: { selector: 'body', offsetX: 0, offsetY: 0 },
            context: {
                tagName: 'body',
                selector: 'body',
                html: '',
                components: [],
                rect: { x: 0, y: 0, width: 0, height: 0 },
                viewport: { width: 0, height: 0, dpr: 1 },
            },
        };
        this.#send({
            type: 'thread.create',
            id,
            pageUrl: pin.pageUrl,
            prompt: pin.prompt,
            anchor: pin.anchor,
            context: pin.context,
            attachments: input.attachments,
        });
        return { providerThreadId: id };
    }

    async sendMessage(input: SendMessageInput): Promise<void> {
        await this.#connected({ checkoutChanged: true });
        this.#send({
            type: 'thread.reply',
            threadId: input.providerThreadId,
            text: input.text,
            attachments: input.attachments,
        });
    }

    async interrupt(providerThreadId: string): Promise<void> {
        await this.#connected();
        this.#send({ type: 'thread.interrupt', threadId: providerThreadId });
    }

    watch(providerThreadId: string, sink: ThreadSink): () => void {
        this.#sinks.set(providerThreadId, sink);
        this.#reported.set(providerThreadId, new Map());
        const thread = this.#threads.get(providerThreadId);
        if (thread) this.#report(thread);
        void this.#connected().catch(() => undefined);
        return () => {
            if (this.#sinks.get(providerThreadId) === sink) {
                this.#sinks.delete(providerThreadId);
                this.#reported.delete(providerThreadId);
            }
        };
    }

    async dispose(): Promise<void> {
        this.#disposed = true;
        clearTimeout(this.#reconnect);
        this.#socket?.close(1000, 'Daemon stopping');
    }

    /** Connect (or reconnect after the checkout moved to another branch or commit). */
    async #connected(options: { checkoutChanged?: boolean } = {}): Promise<void> {
        if (options.checkoutChanged && this.#build) {
            const checkout = await this.#checkout();
            if (checkout.branch !== this.#build.branch || checkout.sha !== this.#build.sha) {
                this.#socket?.close(1000, 'Checkout changed');
                this.#ready = undefined;
            }
        }
        this.#ready ??= this.#open().catch(error => {
            this.#ready = undefined;
            // Keep "run tencil login": that's the useful part.
            if (this.#info.state !== 'unauthorized') {
                this.#setInfo({ state: 'unavailable', detail: messageOf(error) });
            }
            this.#scheduleReconnect();
            throw error;
        });
        return this.#ready;
    }

    async #open(): Promise<void> {
        const { credentials } = this.#options;
        const saved = await credentials.load();
        if (!saved) {
            this.#setInfo({
                state: 'unauthorized',
                detail: 'Run `npx tencil login` on this machine to use Tencil Cloud',
            });
            throw new Error('Not signed in to Tencil Cloud');
        }
        const checkout = await this.#checkout();
        const token = await credentials.token();
        const projectKey = await this.#projectKey(saved.url, checkout.repo, token);
        const build: BuildInfo = { projectKey, ...checkout };
        this.#build = build;

        const socketUrl = new URL('/ws', saved.url);
        socketUrl.protocol = socketUrl.protocol === 'https:' ? 'wss:' : 'ws:';
        const socket = (this.#options.connect ?? (url => new WebSocket(url)))(socketUrl.toString());
        this.#socket = socket;
        await new Promise<void>((resolve, reject) => {
            let settled = false;
            const settle = (error?: Error) => {
                if (settled) return;
                settled = true;
                if (error) reject(error);
                else resolve();
            };
            socket.on('open', () =>
                this.#sendOn(socket, {
                    type: 'hello',
                    protocol: PROTOCOL_VERSION,
                    pageUrl: `${saved.url}/`,
                    build,
                    token,
                }),
            );
            socket.on('message', raw => {
                let message: ServerMessage;
                try {
                    message = JSON.parse(String(raw)) as ServerMessage;
                } catch {
                    return;
                }
                if (message.type === 'ready') {
                    this.#attempt = 0;
                    this.#setInfo({
                        state: 'ready',
                        detail: `Works on ${build.branch} as it is on GitHub; local changes aren't included`,
                        target: `${build.repo} · ${build.branch}`,
                    });
                    for (const thread of message.threads) this.#upsert(thread);
                    settle();
                    return;
                }
                if (message.type === 'auth.required') {
                    // Expired: refresh once and connect again.
                    void credentials.token({ force: true }).then(
                        () => socket.close(1000, 'Signing in again'),
                        error => {
                            this.#setInfo({ state: 'unauthorized', detail: messageOf(error) });
                            settle(new Error(messageOf(error)));
                        },
                    );
                    return;
                }
                if (message.type === 'thread.upsert') return this.#upsert(message.thread);
                if (message.type === 'error') {
                    this.#options.log?.(`Tencil Cloud: ${message.message}`);
                    if (message.threadId)
                        this.#sinks.get(message.threadId)?.status('error', message.message);
                    if (!settled) settle(new Error(message.message));
                }
            });
            socket.on('close', (_code, reason) => {
                if (this.#socket === socket) {
                    this.#socket = undefined;
                    this.#ready = undefined;
                    this.#scheduleReconnect();
                }
                settle(new Error(String(reason) || 'Tencil Cloud closed the connection'));
            });
            socket.on('error', error => settle(error));
        });
    }

    /** Mirror the runner's copy of a pin onto the local pin, reporting only what changed. */
    #upsert(thread: Thread): void {
        this.#threads.set(thread.id, thread);
        this.#report(thread);
    }

    #report(thread: Thread): void {
        const sink = this.#sinks.get(thread.id);
        const reported = this.#reported.get(thread.id);
        if (!sink || !reported) return;
        const changed = (key: string, value: unknown) => {
            const serialized = JSON.stringify(value);
            if (reported.get(key) === serialized) return false;
            reported.set(key, serialized);
            return true;
        };
        for (const message of thread.messages) {
            if (changed(`message:${message.id}`, message)) sink.message(message);
        }
        for (const step of thread.steps ?? []) {
            if (changed(`step:${step.id}`, step)) sink.step?.(step);
        }
        if (thread.delivery && changed('delivery', thread.delivery))
            sink.delivery?.(thread.delivery);
        const status =
            thread.status === 'starting' || thread.status === 'draft' ? 'working' : thread.status;
        if (changed('status', [status, thread.statusDetail]))
            sink.status(status, thread.statusDetail);
    }

    async #projectKey(url: string, repo: string, token: string): Promise<string> {
        const response = await this.#fetch(`${url}/api/projects?${new URLSearchParams({ repo })}`, {
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        });
        if (response.status === 401)
            throw new Error('Tencil Cloud sign-in expired. Run `npx tencil login`.');
        if (!response.ok) throw new Error(`Tencil Cloud answered ${response.status}`);
        const { data } = (await response.json()) as { data: Array<{ key: string }> };
        const key = data[0]?.key;
        if (!key) throw new Error(`${repo} isn't a Tencil Cloud project you're a member of`);
        return key;
    }

    #checkout(): Promise<Checkout> {
        return (this.#options.checkout ?? gitCheckout)(this.#options.projectRoot);
    }

    #send(message: ClientMessageInput): void {
        if (!this.#socket) throw new Error('Not connected to Tencil Cloud');
        this.#sendOn(this.#socket, message);
    }

    #sendOn(socket: WebSocket, message: ClientMessageInput): void {
        socket.send(JSON.stringify(message));
    }

    #scheduleReconnect(): void {
        if (this.#disposed || this.#reconnect) return;
        const delay = RECONNECT_MS[Math.min(this.#attempt++, RECONNECT_MS.length - 1)] ?? 30_000;
        this.#reconnect = setTimeout(() => {
            this.#reconnect = undefined;
            // Only worth it while a pin waits for news.
            if (this.#sinks.size > 0) void this.#connected().catch(() => undefined);
        }, delay);
        this.#reconnect.unref?.();
    }

    #setInfo(change: Partial<ProviderInfo>): void {
        this.#info = { id: this.id, label: this.label, ...change } as ProviderInfo;
        for (const listener of this.#listeners) listener(this.#info);
    }
}

const exec = promisify(execFile);

/** The checkout's GitHub repository (from `origin`), branch and commit. */
export async function gitCheckout(root: string): Promise<Checkout> {
    const git = async (...args: string[]) =>
        (await exec('git', ['-C', root, ...args])).stdout.trim();
    const remote = await git('remote', 'get-url', 'origin').catch(() => '');
    const repo = githubRepo(remote);
    if (!repo) throw new Error("This project's git remote `origin` isn't on GitHub");
    const branch = await git('rev-parse', '--abbrev-ref', 'HEAD');
    if (branch === 'HEAD') throw new Error('Check out a branch to use Tencil Cloud');
    return { repo, branch, sha: await git('rev-parse', 'HEAD') };
}

export function githubRepo(remote: string): string | undefined {
    const match = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(remote.trim());
    return match ? `${match[1]}/${match[2]}` : undefined;
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
