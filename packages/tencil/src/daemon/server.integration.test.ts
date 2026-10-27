import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerMessage, Thread } from '@tencildev/protocol';
import { EnsembleCredentialStore, ensembleRoot } from '@tencildev/provider-ensemble';
import { CredentialStore } from '@tencildev/provider-t3code';
import { FakeEnsembleServer, FakeRegistry, FakeT3Server, waitFor } from '@tencildev/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { cliIn } from '../service/autostart.ts';
import type { Installer, UpdatePlan } from '../service/self-update.ts';
import { VERSION } from '../version.ts';
import { type Daemon, type DaemonOptions, startDaemon } from './server.ts';

const FAST = { httpMs: 300, rpcMs: 2_000, retryMinMs: 20, retryMaxMs: 100 };
const CONTEXT = {
    tagName: 'button',
    selector: 'main > button',
    html: '<button class="cta">Buy</button>',
    text: 'Buy',
    components: [{ name: 'Pricing', source: { file: 'src/Pricing.tsx', line: 12 } }],
    rect: { x: 0, y: 0, width: 100, height: 40 },
    viewport: { width: 1280, height: 800, dpr: 2 },
};
const ANCHOR = { selector: 'main > button', offsetX: 0.5, offsetY: 0.5 };

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
    while (cleanup.length) await cleanup.pop()?.();
});

const tmp = (prefix: string) => realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));

/**
 * One daemon, one fake T3 Code with two projects. Pages on port 3001 belong
 * to project A, 3002 to project B; anything else is unknown.
 */
async function setup(
    options: {
        protocol?: 1 | 2;
        paired?: boolean;
        chunkDelayMs?: number;
    } & Partial<DaemonOptions> = {},
) {
    const projectA = tmp('tencil-a-');
    const projectB = tmp('tencil-b-');
    const t3 = await FakeT3Server.start({
        protocol: options.protocol ?? 1,
        ...(options.chunkDelayMs && { chunkDelayMs: options.chunkDelayMs }),
        projects: [
            { id: 'proj-a', title: 'alpha', workspaceRoot: projectA },
            { id: 'proj-b', title: 'beta', workspaceRoot: projectB },
        ],
    });
    const credentials = new CredentialStore(join(tmp('tencil-creds-'), 'credentials.json'));
    if (options.paired !== false) {
        await credentials.set(t3.url, {
            token: t3.token,
            scope: 'orchestration:read orchestration:operate',
            expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        });
    }
    const byPort: Record<string, string> = { '3001': projectA, '3002': projectB };
    const daemon = await startDaemon({
        port: 0,
        dataDir: tmp('tencil-data-'),
        t3: {
            url: t3.url,
            credentials,
            timeouts: FAST,
            autoPair: false,
            createPairingCode: async () => t3.issuePairingCode(),
        },
        // Keep this machine's Ensemble app out of these tests.
        ensemble: { url: 'http://127.0.0.1:1' },
        resolveProject: async pageUrl => byPort[new URL(pageUrl).port],
        // No registry requests unless a test brings its own.
        updates: { check: false },
        ...options,
    });
    cleanup.push(async () => {
        await daemon.close();
        await t3.close();
    });
    return { t3, daemon, projectA, projectB };
}

/** Stand-in for the overlay on a given page. */
async function connectPage(
    daemon: Daemon,
    pageUrl: string,
    origin = new URL(pageUrl).origin,
    via: { url?: string; host?: string } = {},
) {
    const ws = new WebSocket(`${(via.url ?? daemon.url).replace('http', 'ws')}/ws`, {
        origin,
        headers: via.host ? { host: via.host } : {},
    });
    const received: ServerMessage[] = [];
    ws.on('message', data => received.push(JSON.parse(String(data)) as ServerMessage));
    await new Promise<void>((resolve, reject) => {
        ws.once('open', () => resolve());
        ws.once('error', reject);
    });
    cleanup.push(() => ws.close());
    const send = (message: unknown) => ws.send(JSON.stringify(message));
    const latest = (id: string): Thread | undefined =>
        received
            .filter(
                (m): m is Extract<ServerMessage, { type: 'thread.upsert' }> =>
                    m.type === 'thread.upsert',
            )
            .map(m => m.thread)
            .filter(t => t.id === id)
            .at(-1);
    send({ type: 'hello', protocol: 1, pageUrl });
    return { received, send, latest };
}

const ready = (received: ServerMessage[]) =>
    waitFor(
        () =>
            received.some(
                m =>
                    (m.type === 'ready' || m.type === 'provider.status') &&
                    m.provider.state === 'ready',
            ),
        { message: 'provider ready' },
    );

const pin = (id: string, prompt: string, pageUrl: string) => ({
    type: 'thread.create',
    id,
    pageUrl,
    prompt,
    anchor: ANCHOR,
    context: CONTEXT,
});

function httpGet(url: string, headers: Record<string, string> = {}) {
    return httpRequest(url, { headers });
}

function httpRequest(
    url: string,
    options: { method?: string; headers?: Record<string, string>; body?: string } = {},
) {
    return new Promise<{ status: number; body: string; headers: Record<string, unknown> }>(
        (resolve, reject) => {
            const req = request(url, { method: options.method, headers: options.headers }, res => {
                let body = '';
                res.on('data', chunk => {
                    body += chunk;
                });
                res.on('end', () =>
                    resolve({ status: res.statusCode ?? 0, body, headers: res.headers }),
                );
            });
            req.on('error', reject);
            req.end(options.body);
        },
    );
}

/** The approval form, posted the way a browser would from the daemon's own page. */
const postAllow = (daemon: Daemon, origin: string, from = daemon.url) =>
    httpRequest(`${daemon.url}/allow`, {
        method: 'POST',
        headers: {
            origin: from,
            'content-type': 'application/x-www-form-urlencoded',
            'sec-fetch-site': from === daemon.url ? 'same-origin' : 'cross-site',
        },
        body: new URLSearchParams({ origin }).toString(),
    });

describe.each([1, 2] as const)('daemon end to end, protocol v%i', protocol => {
    it('pins an element and streams the reply, with the element context sent to the agent', async () => {
        const { t3, daemon } = await setup({ protocol });
        const page = await connectPage(daemon, 'http://localhost:3001/pricing');
        await ready(page.received);

        page.send(pin('pin-1', 'Make the button green', 'http://localhost:3001/pricing'));
        const done = await waitFor(() => {
            const thread = page.latest('pin-1');
            return thread?.status === 'idle' && thread.messages.some(m => m.role === 'assistant')
                ? thread
                : undefined;
        });

        const sent = [...t3.threads.values()][0];
        expect(sent?.projectId).toBe('proj-a');
        expect(sent?.messages[0]?.text).toContain('<tencil-context>');
        expect(sent?.messages[0]?.text).toContain('Pricing (src/Pricing.tsx:12)');
        expect(done.messages.find(m => m.role === 'user')?.text).toBe('Make the button green');
        expect(done.messages.find(m => m.role === 'assistant')?.text).toBe(
            'Done: Make the button green',
        );
    });

    it('serves two projects at once, each with its own pins', async () => {
        const { t3, daemon, projectA, projectB } = await setup({ protocol });
        const a = await connectPage(daemon, 'http://localhost:3001/');
        const b = await connectPage(daemon, 'http://localhost:3002/');
        await ready(a.received);
        await ready(b.received);

        a.send(pin('a-1', 'Fix A', 'http://localhost:3001/'));
        b.send(pin('b-1', 'Fix B', 'http://localhost:3002/'));
        await waitFor(() => a.latest('a-1')?.status === 'idle');
        await waitFor(() => b.latest('b-1')?.status === 'idle');

        expect(a.latest('b-1')).toBeUndefined();
        expect(b.latest('a-1')).toBeUndefined();
        expect([...t3.threads.values()].map(t => t.projectId).sort()).toEqual(['proj-a', 'proj-b']);

        const health = JSON.parse((await httpGet(`${daemon.url}/health`)).body);
        expect(health.projects.map((p: { root: string }) => p.root).sort()).toEqual(
            [projectA, projectB].sort(),
        );
    });
});

describe('unknown pages', () => {
    it('asks which project a page belongs to and remembers the answer', async () => {
        const { daemon, projectB } = await setup({
            // Only remembered picks resolve; the OS lookup finds nothing.
            resolveProject: undefined,
            exec: async () => '',
        });
        const first = await connectPage(daemon, 'http://localhost:9999/');
        const unknown = await waitFor(() =>
            first.received.find(
                (m): m is Extract<ServerMessage, { type: 'project.unknown' }> =>
                    m.type === 'project.unknown',
            ),
        );
        expect(unknown.choices.map(c => c.title).sort()).toEqual(['alpha', 'beta']);

        first.send({ type: 'project.select', root: projectB });
        await waitFor(() =>
            first.received.find(m => m.type === 'ready' && m.project.root === projectB),
        );

        const again = await connectPage(daemon, 'http://localhost:9999/other');
        await waitFor(() =>
            again.received.find(m => m.type === 'ready' && m.project.root === projectB),
        );
        expect(again.received.some(m => m.type === 'project.unknown')).toBe(false);
    });
});

describe('pairing from the overlay', () => {
    it('pairs when the overlay asks', async () => {
        const { daemon } = await setup({ paired: false });
        const page = await connectPage(daemon, 'http://localhost:3001/');
        await waitFor(() =>
            page.received.some(
                m =>
                    (m.type === 'provider.status' || m.type === 'ready') &&
                    m.provider.state === 'unauthorized',
            ),
        );
        page.send({ type: 'provider.pair' });
        await ready(page.received);
    });
});

describe('security', () => {
    it('tells pages from other origins where to get allowed, and nothing else', async () => {
        const { daemon } = await setup();
        const page = await connectPage(daemon, 'http://localhost:3001/', 'https://site.example');
        await waitFor(() => page.received.length > 0);
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(page.received).toEqual([
            {
                type: 'origin.blocked',
                origin: 'https://site.example',
                approveUrl: `http://localhost:${daemon.port}/allow?origin=https%3A%2F%2Fsite.example`,
            },
        ]);
    });

    it('refuses an upgrade without a real origin', async () => {
        const { daemon } = await setup();
        await expect(connectPage(daemon, 'http://localhost:3001/', 'null')).rejects.toThrow(/403/);
    });

    it('lets a site in once it is allowed from the daemon page, and remembers it', async () => {
        const dataDir = tmp('tencil-data-');
        const { daemon } = await setup({ dataDir });
        const site = 'https://site.example';

        const confirm = await httpGet(`${daemon.url}/allow?origin=${encodeURIComponent(site)}`);
        expect(confirm.status).toBe(200);
        expect(confirm.body).toContain('Let https://site.example use Tencil?');
        expect(confirm.headers['x-frame-options']).toBe('DENY');
        expect(confirm.headers['content-security-policy']).toContain("frame-ancestors 'none'");

        expect((await postAllow(daemon, site)).status).toBe(200);
        const page = await connectPage(daemon, 'http://localhost:3001/', site);
        await ready(page.received);

        // Another daemon on the same data folder (a restart) still knows it.
        const { daemon: restarted } = await setup({ dataDir });
        await ready((await connectPage(restarted, 'http://localhost:3001/', site)).received);
    });

    it("won't let a site approve itself", async () => {
        const { daemon } = await setup();
        const site = 'https://site.example';
        expect((await postAllow(daemon, site, site)).status).toBe(403);
        const forged = await httpRequest(`${daemon.url}/allow`, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ origin: site }).toString(),
        });
        expect(forged.status).toBe(403);
        expect((await postAllow(daemon, '*')).status).toBe(400);
        const page = await connectPage(daemon, 'http://localhost:3001/', site);
        await waitFor(() => page.received[0]?.type === 'origin.blocked');
    });

    it('rejects requests addressed to another host name (DNS rebinding)', async () => {
        const { daemon } = await setup();
        expect((await httpGet(`${daemon.url}/health`)).status).toBe(200);
        expect((await httpGet(`${daemon.url}/health`, { host: 'evil.example' })).status).toBe(403);
    });

    it('lets an allowed remote page in through an extra listen address', async () => {
        const { daemon } = await setup({
            listen: ['::1'],
            allowedOrigins: ['http://devbox:3001'],
        });
        const remote = `http://[::1]:${daemon.port}`;
        const host = `devbox:${daemon.port}`;
        expect((await httpGet(`${remote}/health`, { host })).status).toBe(200);
        expect((await httpGet(`${remote}/health`, { host: 'evil.example' })).status).toBe(403);

        const page = await connectPage(daemon, 'http://devbox:3001/', undefined, {
            url: remote,
            host,
        });
        await ready(page.received);
        const other = await connectPage(daemon, 'http://devbox:3002/', undefined, {
            url: remote,
            host,
        });
        await waitFor(() => other.received[0]?.type === 'origin.blocked');
    });

    it('serves the overlay script', async () => {
        const { daemon } = await setup();
        const script = await httpGet(daemon.scriptUrl);
        expect(script.status).toBe(200);
        expect(script.body.length).toBeGreaterThan(1000);
    });
});

describe('updates', () => {
    /** Writes a package that says it's the version asked for, like a quick `npm install`. */
    const fakeInstall: Installer = async (spec, dir) => {
        mkdirSync(join(dir, 'node_modules', 'tencil', 'dist'), { recursive: true });
        writeFileSync(
            join(dir, 'node_modules', 'tencil', 'package.json'),
            JSON.stringify({ version: spec.replace('tencil@', '') }),
        );
        writeFileSync(cliIn(dir), '');
    };

    const updates = (received: ServerMessage[]) =>
        received.flatMap(m =>
            m.type === 'update' ? [m.update] : m.type === 'ready' && m.update ? [m.update] : [],
        );

    async function withRegistry(latest = '999.0.0') {
        const registry = await FakeRegistry.start({ latest });
        cleanup.push(() => registry.close());
        return registry;
    }

    it('tells pages about a newer version, in ready and when a later check finds one', async () => {
        const registry = await withRegistry(VERSION);
        const { daemon } = await setup({
            updates: { check: true, registry: registry.url },
        });
        await waitFor(() => registry.requests.length === 1);
        const page = await connectPage(daemon, 'http://localhost:3001/');
        const ready = await waitFor(() => page.received.find(m => m.type === 'ready'));
        expect(ready).toMatchObject({ version: VERSION, update: { state: 'idle' } });
        expect(updates(page.received)[0]?.latest).toBeUndefined();

        registry.latest = '999.0.0';
        // The daemon checks on start and then daily; run the next check now.
        await daemon.checkForUpdates();
        await waitFor(() =>
            page.received.some(m => m.type === 'update' && m.update.latest === '999.0.0'),
        );
    });

    it('asks no registry with TENCIL_NO_UPDATE_CHECK set', async () => {
        const registry = await withRegistry();
        vi.stubEnv('TENCIL_NO_UPDATE_CHECK', '1');
        cleanup.push(() => void vi.unstubAllEnvs());
        const { daemon } = await setup({ updates: { registry: registry.url } });
        const page = await connectPage(daemon, 'http://localhost:3001/');
        await waitFor(() => page.received.some(m => m.type === 'ready'));
        expect(registry.requests).toEqual([]);
    });

    it('installs the new version and hands over to the restart helper', async () => {
        const registry = await withRegistry();
        const plans: UpdatePlan[] = [];
        const { daemon } = await setup({
            cli: '/runtime/tencil/dist/cli.mjs',
            flags: ['--listen', '100.64.0.1'],
            updates: {
                check: true,
                registry: registry.url,
                install: fakeInstall,
                handOff: plan => plans.push(plan),
            },
        });
        const page = await connectPage(daemon, 'http://localhost:3001/');
        await waitFor(() => updates(page.received).some(update => update.latest === '999.0.0'));
        page.send({ type: 'update.start' });
        await waitFor(() => plans.length === 1);
        // The states are sent just before the hand-off; they can still be on the way.
        await waitFor(() => updates(page.received).some(update => update.state === 'restarting'));
        expect(updates(page.received).map(update => update.state)).toEqual(
            expect.arrayContaining(['installing', 'restarting']),
        );
        expect(plans[0]).toMatchObject({
            version: '999.0.0',
            port: daemon.port,
            flags: ['--listen', '100.64.0.1'],
            previousCli: '/runtime/tencil/dist/cli.mjs',
        });
    });

    it('waits for running threads before restarting', async () => {
        const registry = await withRegistry();
        const plans: UpdatePlan[] = [];
        const { daemon } = await setup({
            chunkDelayMs: 150,
            cli: '/runtime/tencil/dist/cli.mjs',
            updates: {
                check: true,
                registry: registry.url,
                install: fakeInstall,
                handOff: plan => plans.push(plan),
                idlePollMs: 20,
            },
        });
        const page = await connectPage(daemon, 'http://localhost:3001/');
        await ready(page.received);
        await waitFor(() => updates(page.received).some(update => update.latest));
        page.send(
            pin('busy', 'Rewrite the whole pricing section please', 'http://localhost:3001/'),
        );
        await waitFor(() => page.latest('busy')?.status === 'working');

        page.send({ type: 'update.start' });
        await waitFor(() =>
            updates(page.received).some(u => u.state === 'waiting' && u.running === 1),
        );
        expect(plans).toEqual([]);
        await waitFor(() => page.latest('busy')?.status === 'idle', { timeoutMs: 10_000 });
        await waitFor(() => plans.length === 1);
    });

    it('reports a failed install and keeps running', async () => {
        const registry = await withRegistry();
        const { daemon } = await setup({
            cli: '/runtime/tencil/dist/cli.mjs',
            updates: {
                check: true,
                registry: registry.url,
                install: async () => {
                    throw new Error('npm install failed (1): E404 tencil@999.0.0');
                },
                handOff: () => {
                    throw new Error('should not restart');
                },
            },
        });
        const page = await connectPage(daemon, 'http://localhost:3001/');
        await waitFor(() => updates(page.received).some(update => update.latest));
        page.send({ type: 'update.start' });
        const failed = await waitFor(() =>
            updates(page.received).find(update => update.state === 'failed'),
        );
        expect(failed).toEqual({
            latest: '999.0.0',
            state: 'failed',
            error: 'npm install failed (1): E404 tencil@999.0.0',
        });
        expect((await httpGet(`${daemon.url}/health`)).status).toBe(200);
    });
});

describe('Ensemble', () => {
    it('sends pins on a page Ensemble serves for a thread to that thread', async () => {
        const ensemble = await FakeEnsembleServer.start();
        cleanup.push(() => ensemble.close());
        const credentials = new EnsembleCredentialStore(
            join(tmp('tencil-ensemble-'), 'credentials.json'),
        );
        const token = 'ens_test';
        ensemble.tokens.add(token);
        await credentials.set(ensemble.url, token);
        const thread = ensemble.addThread({ projectId: 'p1', title: 'Landing' });
        ensemble.ports.set(4174, thread.id);
        const { daemon } = await setup({
            ensemble: { url: ensemble.url, credentials },
            resolveProject: undefined,
            exec: async () => '',
        });
        const page = await connectPage(daemon, 'http://localhost:4174/');
        await ready(page.received);
        const hello = page.received.find(
            (m): m is Extract<ServerMessage, { type: 'ready' }> => m.type === 'ready',
        );
        expect(hello?.settings.provider).toBe('ensemble');

        page.send(pin('pin-1', 'Tighten the hero', 'http://localhost:4174/'));
        const done = await waitFor(
            () => {
                const latest = page.latest('pin-1');
                return latest?.messages.some(m => m.role === 'assistant') && latest;
            },
            { message: 'Ensemble reply on the pin' },
        );
        expect(done.provider).toMatchObject({
            id: 'ensemble',
            threadId: expect.stringMatching(new RegExp(`^${thread.id}/`)),
        });
        const health = JSON.parse((await httpGet(`${daemon.url}/health`)).body);
        expect(health.projects[0]?.root).toBe(ensembleRoot(thread.id));
        expect(ensemble.callsOf('POST', 'threads')).toEqual([]);
        expect(ensemble.callsOf('POST', `threads/${thread.id}/chats`)).toEqual([
            expect.objectContaining({ prompt: expect.stringContaining('Tighten the hero') }),
        ]);
    });
});
