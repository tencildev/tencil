import type { ChangeSpan, ServerMessage } from '@tencildev/protocol';
import { FakeAgentProvider, waitFor } from '@tencildev/testing';
import { describe, expect, it } from 'vitest';
import { Bridge, type BridgeClient } from './bridge.ts';
import type { ChangeTracker } from './change-tracker.ts';
import { ProjectProviders } from './project-providers.ts';
import { MemoryThreadStore } from './thread-store.ts';

const pin = (id: string, prompt = 'Make it green') => ({
    type: 'thread.create',
    id,
    pageUrl: 'http://localhost:3000/',
    prompt,
    anchor: { selector: 'button', offsetX: 0.5, offsetY: 0.5 },
    context: {
        tagName: 'button',
        selector: 'button',
        html: '<button>Choose Pro</button>',
        components: [{ name: 'PricingCard' }],
        rect: { x: 0, y: 0, width: 10, height: 10 },
        viewport: { width: 100, height: 100, dpr: 1 },
    },
});

/** The work tree is whatever `tree` says; every span changes `app.tsx`. */
class FakeChanges implements ChangeTracker {
    tree = 'tree-0';
    snapshots = 0;
    /** What HEAD points at; the agent moves it by committing. */
    sha = 'commit-0';
    readonly reverts: ChangeSpan[][] = [];
    failWith: string | undefined;

    async snapshot() {
        this.snapshots++;
        return this.tree;
    }

    async files(spans: ChangeSpan[]) {
        return spans.some(span => span.from !== span.to) ? ['src/app.tsx'] : [];
    }

    async head() {
        return this.sha;
    }

    async revert(spans: ChangeSpan[]) {
        if (this.failWith) throw new Error(this.failWith);
        this.reverts.push(spans);
    }
}

async function setup({ git = true, tracker = true } = {}) {
    const fake = new FakeAgentProvider();
    const changes = new FakeChanges();
    const store = new MemoryThreadStore();
    const bridge = new Bridge({
        providers: ProjectProviders.of(fake),
        store,
        project: { name: 'acme', root: '/x' },
        version: '0',
        ...(tracker && { changes }),
    });
    const received: ServerMessage[] = [];
    const client: BridgeClient = { send: message => received.push(message) };
    bridge.connect(client);
    if (git && tracker) await bridge.handle(client, { type: 'settings.update', git: true });
    /** One agent turn on a provider thread that leaves the work tree at `tree`. */
    const turn = async (providerThreadId: string, tree: string) => {
        fake.sinks.get(providerThreadId)?.status('working');
        changes.tree = tree;
        fake.sinks.get(providerThreadId)?.status('idle');
    };
    return { bridge, client, received, store, fake, changes, turn };
}

describe('Git actions', () => {
    it('is a project setting, off by default, only where the host can run Git', async () => {
        const local = await setup({ git: false });
        await local.bridge.handle(local.client, { type: 'hello', protocol: 1, pageUrl: 'x' });
        expect(local.received.at(-1)).toMatchObject({ type: 'ready', settings: { git: false } });
        await local.bridge.handle(local.client, { type: 'settings.update', git: true });
        expect(local.received.at(-1)).toMatchObject({ type: 'settings', settings: { git: true } });

        const cloud = await setup({ tracker: false });
        await cloud.bridge.handle(cloud.client, { type: 'hello', protocol: 1, pageUrl: 'x' });
        const ready = cloud.received.at(-1) as Extract<ServerMessage, { type: 'ready' }>;
        expect(ready.settings.git).toBeUndefined();
        await cloud.bridge.handle(cloud.client, { type: 'settings.update', git: true });
        expect(cloud.received.at(-1)).toMatchObject({
            type: 'error',
            message: "Git actions aren't available here",
        });
    });

    it("offers the files a pin's agent changed once its turn ends", async () => {
        const { bridge, client, store, turn } = await setup();
        await bridge.handle(client, pin('a'));
        await turn('fake-1', 'tree-1');

        await waitFor(() => store.get('a')?.change !== undefined);
        expect(store.get('a')?.change).toEqual({
            status: 'ready',
            files: ['src/app.tsx'],
            spans: [{ from: 'tree-0', to: 'tree-1' }],
        });
    });

    it("doesn't wait for the status a watch replays before the turn starts", async () => {
        const { bridge, client, store, fake, changes } = await setup();
        await bridge.handle(client, pin('a'));
        const sink = fake.sinks.get('fake-1')!;
        sink.status('idle');
        sink.status('working');
        changes.tree = 'tree-1';
        sink.status('idle');

        await waitFor(() => store.get('a')?.change !== undefined);
        expect(store.get('a')?.change?.spans).toEqual([{ from: 'tree-0', to: 'tree-1' }]);
    });

    it('leaves pins alone when their agent changed nothing, or Git actions are off', async () => {
        const quiet = await setup();
        await quiet.bridge.handle(quiet.client, pin('a'));
        await quiet.turn('fake-1', 'tree-0');
        await waitFor(() => quiet.changes.snapshots === 2);
        expect(quiet.store.get('a')?.change).toBeUndefined();

        const off = await setup({ git: false });
        await off.bridge.handle(off.client, pin('a'));
        await off.turn('fake-1', 'tree-1');
        expect(off.changes.snapshots).toBe(0);
        expect(off.store.get('a')?.change).toBeUndefined();
    });

    it('grows with follow-ups, leaving out other edits made between turns', async () => {
        const { bridge, client, store, changes, turn } = await setup();
        await bridge.handle(client, pin('a'));
        await turn('fake-1', 'tree-1');
        await waitFor(() => store.get('a')?.change !== undefined);

        // Straight on from the last turn: the same span grows.
        await bridge.handle(client, { type: 'thread.reply', threadId: 'a', text: 'Bigger' });
        await turn('fake-1', 'tree-2');
        await waitFor(() => store.get('a')?.change?.spans[0]?.to === 'tree-2');
        expect(store.get('a')?.change?.spans).toEqual([{ from: 'tree-0', to: 'tree-2' }]);

        // Someone else edited first: a span of its own.
        changes.tree = 'tree-3';
        await bridge.handle(client, { type: 'thread.reply', threadId: 'a', text: 'Rounder' });
        await turn('fake-1', 'tree-4');
        await waitFor(() => store.get('a')?.change?.spans.length === 2);
        expect(store.get('a')?.change?.spans).toEqual([
            { from: 'tree-0', to: 'tree-2' },
            { from: 'tree-3', to: 'tree-4' },
        ]);
    });

    it('marks changes whose agents worked at the same time', async () => {
        const { bridge, client, store, fake, changes } = await setup();
        await bridge.handle(client, pin('a'));
        await bridge.handle(client, pin('b', 'Make it blue'));
        fake.sinks.get('fake-1')?.status('working');
        fake.sinks.get('fake-2')?.status('working');
        changes.tree = 'tree-1';
        fake.sinks.get('fake-1')?.status('idle');
        fake.sinks.get('fake-2')?.status('idle');

        await waitFor(
            () => store.get('a')?.change !== undefined && store.get('b')?.change !== undefined,
        );
        expect(store.get('a')?.change?.shared).toBe(true);
        expect(store.get('b')?.change?.shared).toBe(true);
    });

    it('asks the agent to commit, and shows the commit once HEAD moves', async () => {
        const { bridge, client, store, fake, changes, turn } = await setup();
        await bridge.handle(client, pin('a'));
        await turn('fake-1', 'tree-1');
        await waitFor(() => store.get('a')?.change !== undefined);

        await bridge.handle(client, { type: 'thread.commit', threadId: 'a' });

        const asked = fake.sent.at(-1);
        expect(asked?.providerThreadId).toBe('fake-1');
        expect(asked?.text).toMatch(/^Commit these changes\n/);
        expect(asked?.text).toContain('`src/app.tsx`');
        expect(asked?.text).toContain("don't push");
        expect(store.get('a')?.messages.at(-1)?.text).toBe('Commit these changes');
        expect(store.get('a')?.change?.status).toBe('committing');

        // The agent commits; the work tree is as it was.
        const sink = fake.sinks.get('fake-1')!;
        sink.status('idle');
        sink.status('working');
        changes.sha = 'commit-1';
        sink.status('idle');
        await waitFor(() => store.get('a')?.change?.status === 'committed');
        expect(store.get('a')?.change).toMatchObject({
            commit: 'commit-1',
            files: ['src/app.tsx'],
        });

        // The next turn's edits are a change of their own.
        await bridge.handle(client, { type: 'thread.reply', threadId: 'a', text: 'Bigger' });
        await turn('fake-1', 'tree-2');
        await waitFor(() => store.get('a')?.change?.status === 'ready');
        expect(store.get('a')?.change?.spans).toEqual([{ from: 'tree-1', to: 'tree-2' }]);
    });

    it("says so when the agent didn't commit, and lets you ask again", async () => {
        const { bridge, client, store, fake, turn } = await setup();
        await bridge.handle(client, pin('a'));
        await turn('fake-1', 'tree-1');
        await waitFor(() => store.get('a')?.change !== undefined);

        await bridge.handle(client, { type: 'thread.commit', threadId: 'a' });
        await turn('fake-1', 'tree-1');
        await waitFor(() => store.get('a')?.change?.status === 'failed');
        expect(store.get('a')?.change?.detail).toBe("The agent didn't commit; its reply says why");

        await bridge.handle(client, { type: 'thread.commit', threadId: 'a' });
        expect(store.get('a')?.change?.status).toBe('committing');
        expect(
            fake.sent.filter(input => input.text.startsWith('Commit these changes')),
        ).toHaveLength(2);
    });

    it("doesn't ask while the agent is still working", async () => {
        const { bridge, client, store, fake, turn, received } = await setup();
        await bridge.handle(client, pin('a'));
        await turn('fake-1', 'tree-1');
        await waitFor(() => store.get('a')?.change !== undefined);
        await bridge.handle(client, { type: 'thread.reply', threadId: 'a', text: 'Bigger' });

        await bridge.handle(client, { type: 'thread.commit', threadId: 'a' });

        expect(received.at(-1)).toMatchObject({
            type: 'error',
            message: "The agent is still working; commit once it's done",
        });
        expect(store.get('a')?.change?.status).toBe('ready');
        expect(fake.sent.map(input => input.text)).toEqual(['Bigger']);
    });

    it('fails a commit or revert that a restart cut short', async () => {
        const fake = new FakeAgentProvider();
        const store = new MemoryThreadStore([
            {
                id: 'a',
                title: 'Pin',
                status: 'idle',
                resolved: false,
                messages: [],
                provider: { id: 'fake', threadId: 'fake-1' },
                change: { status: 'committing', files: ['src/app.tsx'], spans: [] },
                createdAt: '2026-11-09T10:00:00.000Z',
                updatedAt: '2026-11-09T10:00:00.000Z',
            },
        ]);
        new Bridge({
            providers: ProjectProviders.of(fake),
            store,
            project: { name: 'acme', root: '/x' },
            version: '0',
            changes: new FakeChanges(),
        });
        expect(store.get('a')?.change).toMatchObject({
            status: 'failed',
            detail: 'Tencil restarted before it finished',
        });
    });

    it('reverts the change, and reports a failure that can be tried again', async () => {
        const { bridge, client, store, fake, changes, turn } = await setup();
        await bridge.handle(client, pin('a'));
        await turn('fake-1', 'tree-1');
        await waitFor(() => store.get('a')?.change !== undefined);

        changes.failWith = 'The lines changed since';
        await bridge.handle(client, { type: 'thread.revert', threadId: 'a' });
        expect(store.get('a')?.change).toMatchObject({
            status: 'failed',
            detail: 'The lines changed since',
        });

        changes.failWith = undefined;
        await bridge.handle(client, { type: 'thread.revert', threadId: 'a' });
        expect(changes.reverts).toEqual([[{ from: 'tree-0', to: 'tree-1' }]]);
        expect(store.get('a')?.change).toEqual({
            status: 'reverted',
            files: ['src/app.tsx'],
            spans: [{ from: 'tree-0', to: 'tree-1' }],
        });

        await bridge.handle(client, { type: 'thread.commit', threadId: 'a' });
        expect(fake.sent).toEqual([]);
    });
});
