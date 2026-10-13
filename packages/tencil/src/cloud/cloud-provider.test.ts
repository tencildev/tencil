import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
    ClientMessage,
    ProviderMessage,
    ServerMessage,
    Thread,
    ThreadSink,
} from '@tencildev/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import { githubRepo, TencilCloudProvider } from './cloud-provider.ts';
import { CloudCredentials } from './credentials.ts';

const context = {
    tagName: 'h1',
    selector: 'h1',
    html: '<h1>Hi</h1>',
    components: [],
    rect: { x: 0, y: 0, width: 10, height: 10 },
    viewport: { width: 100, height: 100, dpr: 1 },
};

/** A runner that accepts any hello and records what the daemon sends. */
async function fakeRunner() {
    const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise(resolve => server.on('listening', resolve));
    const received: ClientMessage[] = [];
    const sockets: Array<{ send: (message: ServerMessage) => void; origin?: string }> = [];
    server.on('connection', (socket, request) => {
        const entry = {
            send: (message: ServerMessage) => socket.send(JSON.stringify(message)),
            origin: request.headers.origin,
        };
        sockets.push(entry);
        socket.on('message', raw => {
            const message = JSON.parse(String(raw)) as ClientMessage;
            received.push(message);
            if (message.type === 'hello') {
                entry.send({
                    type: 'ready',
                    protocol: 1,
                    version: 'test',
                    project: { name: 'acme/shop', root: 'acme/shop' },
                    provider: { id: 'cloud', label: 'Tencil Cloud', state: 'ready' },
                    settings: { provider: 'cloud', providers: [], batch: false },
                    threads: [],
                });
            }
        });
    });
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return { url, received, sockets, close: () => new Promise(resolve => server.close(resolve)) };
}

function recordingSink() {
    const events: Array<[string, unknown]> = [];
    const sink: ThreadSink = {
        message: (message: ProviderMessage) => events.push(['message', message.text]),
        status: (status, detail) =>
            events.push(['status', detail ? `${status}: ${detail}` : status]),
        delivery: delivery => events.push(['delivery', delivery.status]),
        step: step => events.push(['step', `${step.label} ${step.status}`]),
        gone: () => events.push(['gone', null]),
    };
    return { sink, events };
}

describe('TencilCloudProvider', () => {
    let close: (() => Promise<unknown>) | undefined;
    afterEach(async () => {
        await close?.();
    });

    it("sends pins to the runner as this checkout's build and mirrors the run back", async () => {
        const runner = await fakeRunner();
        close = runner.close;
        const credentials = new CloudCredentials({
            path: join(mkdtempSync(join(tmpdir(), 'tencil-cloud-')), 'cloud.json'),
        });
        await credentials.save(runner.url, { access_token: 'cli-token', expires_in: 3600 });
        const fetchImpl = vi.fn(async (input: string | URL | Request) => {
            expect(String(input)).toBe(`${runner.url}/api/projects?repo=acme%2Fshop`);
            return Response.json({ data: [{ key: 'key-1', name: 'Shop', repo: 'acme/shop' }] });
        }) as unknown as typeof fetch;
        const provider = new TencilCloudProvider({
            projectRoot: '/work/shop',
            credentials,
            fetch: fetchImpl,
            checkout: async () => ({ repo: 'acme/shop', branch: 'main', sha: 'a'.repeat(40) }),
        });

        const created = await provider.createThread({
            title: 'Bigger',
            text: 'rendered prompt',
            attachments: [],
            pin: {
                prompt: 'Make it bigger',
                pageUrl: 'http://devbox:3000/',
                anchor: { selector: 'h1', offsetX: 0.5, offsetY: 0.5 },
                context,
            },
        });
        const { sink, events } = recordingSink();
        provider.watch(created.providerThreadId, sink);

        await vi.waitFor(() => expect(runner.received).toHaveLength(2));
        // No Origin: the runner tells the daemon from a browser by that.
        expect(runner.sockets[0]?.origin).toBeUndefined();
        expect(runner.received[0]).toMatchObject({
            type: 'hello',
            token: 'cli-token',
            build: { projectKey: 'key-1', repo: 'acme/shop', branch: 'main', sha: 'a'.repeat(40) },
        });
        // The raw pin, so the runner renders the element context into its prompt once.
        expect(runner.received[1]).toMatchObject({
            type: 'thread.create',
            id: created.providerThreadId,
            prompt: 'Make it bigger',
            context: { selector: 'h1' },
        });
        expect(provider.info()).toMatchObject({ state: 'ready', target: 'acme/shop · main' });

        const at = '2026-10-12T10:00:00.000Z';
        const thread: Thread = {
            id: created.providerThreadId,
            title: 'Make it bigger',
            status: 'working',
            resolved: false,
            messages: [
                { id: 'u1', role: 'user', text: 'Make it bigger', streaming: false, createdAt: at },
            ],
            provider: { id: 'cloud', threadId: 'remote' },
            steps: [
                {
                    id: 'sandbox',
                    label: 'Starting Tencil Sandbox',
                    status: 'running',
                    startedAt: at,
                },
            ],
            createdAt: at,
            updatedAt: at,
        };
        const runnerSocket = runner.sockets[0];
        runnerSocket?.send({ type: 'thread.upsert', thread });
        runnerSocket?.send({
            type: 'thread.upsert',
            thread: {
                ...thread,
                status: 'idle',
                steps: [{ ...thread.steps![0]!, status: 'done', endedAt: at }],
                delivery: {
                    status: 'pushed',
                    pullRequest: {
                        number: 7,
                        url: 'https://github.com/acme/shop/pull/7',
                        opened: true,
                    },
                },
            },
        });
        await vi.waitFor(() => expect(events.at(-1)).toEqual(['status', 'idle']));
        expect(events).toEqual([
            ['message', 'Make it bigger'],
            ['step', 'Starting Tencil Sandbox running'],
            ['status', 'working'],
            // The message didn't change, so it isn't reported again.
            ['step', 'Starting Tencil Sandbox done'],
            ['delivery', 'pushed'],
            ['status', 'idle'],
        ]);
        expect(provider.threadUrl(created.providerThreadId)).toBe(
            'https://github.com/acme/shop/pull/7',
        );
        await provider.dispose();
    });

    it('asks for `tencil login` when the machine is not signed in', async () => {
        const provider = new TencilCloudProvider({
            projectRoot: '/work/shop',
            credentials: new CloudCredentials({
                path: join(mkdtempSync(join(tmpdir(), 'tencil-cloud-')), 'cloud.json'),
            }),
            checkout: async () => ({ repo: 'acme/shop', branch: 'main', sha: 'a'.repeat(40) }),
        });
        await provider.start();
        expect(provider.info()).toMatchObject({
            state: 'unauthorized',
            detail: expect.stringContaining('npx tencil login'),
        });
        await expect(
            provider.createThread({ title: 'x', text: 'x', attachments: [] }),
        ).rejects.toThrow('Not signed in to Tencil Cloud');
        await provider.dispose();
    });

    it('reads the GitHub repository from a remote', () => {
        expect(githubRepo('git@github.com:acme/shop.git')).toBe('acme/shop');
        expect(githubRepo('https://github.com/acme/shop')).toBe('acme/shop');
        expect(githubRepo('https://github.com/acme/shop.git\n')).toBe('acme/shop');
        expect(githubRepo('https://gitlab.com/acme/shop.git')).toBeUndefined();
    });
});
