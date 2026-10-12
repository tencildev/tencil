import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
    CreateThreadInput,
    Provider,
    ProviderInfo,
    SendMessageInput,
    ServerMessage,
    ThreadSink,
} from '@tencildev/protocol';
import { describe, expect, it } from 'vitest';
import { Bridge, type BridgeClient } from './bridge.ts';
import { ProjectProviders } from './project-providers.ts';
import { stripContext } from './prompt.ts';
import { ThreadStore } from './thread-store.ts';

class FakeProvider implements Provider {
    readonly id = 'fake';
    readonly label = 'Fake';
    sent: SendMessageInput[] = [];
    created: CreateThreadInput[] = [];
    failCreate = false;
    sinks = new Map<string, ThreadSink>();
    watchCount = 0;

    async start() {}
    info(): ProviderInfo {
        return { id: this.id, label: this.label, state: 'ready' };
    }
    onInfoChange() {
        return () => {};
    }
    async listThreads() {
        return {
            project: { name: 'acme/app' },
            threads: [
                {
                    id: 'p1',
                    title: 'Existing work',
                    status: 'idle' as const,
                    updatedAt: '2026-10-07T10:00:00.000Z',
                },
            ],
        };
    }
    threadUrl(id: string) {
        return `fake://${id}`;
    }
    async createThread(input: CreateThreadInput) {
        if (this.failCreate) throw new Error('Agent offline');
        this.created.push(input);
        return { providerThreadId: 'new' };
    }
    async sendMessage(input: SendMessageInput) {
        this.sent.push(input);
    }
    async interrupt() {}
    watch(id: string, sink: ThreadSink) {
        this.watchCount++;
        this.sinks.set(id, sink);
        return () => this.sinks.delete(id);
    }
    async dispose() {}
}

const context = {
    tagName: 'h1',
    selector: 'h1',
    html: '<h1>Hi</h1>',
    components: [],
    rect: { x: 0, y: 0, width: 10, height: 10 },
    viewport: { width: 100, height: 100, dpr: 1 },
};

function setup() {
    const provider = new FakeProvider();
    const store = new ThreadStore('/projects/acme', mkdtempSync(join(tmpdir(), 'tencil-')));
    const bridge = new Bridge({
        providers: ProjectProviders.of(provider),
        store,
        project: { name: 'x', root: '/x' },
        version: '0',
    });
    const received: ServerMessage[] = [];
    const client: BridgeClient = { send: message => received.push(message) };
    bridge.connect(client);
    return { provider, store, bridge, client, received };
}

describe('existing provider threads', () => {
    it('lists provider threads', async () => {
        const { bridge, client, received } = setup();
        await bridge.handle(client, { type: 'provider.threads' });
        expect(received.at(-1)).toMatchObject({
            type: 'provider.threads',
            project: { name: 'acme/app' },
            threads: [{ id: 'p1' }],
        });
    });

    it('continues an existing thread from a pin with the element context', async () => {
        const { bridge, client, provider, store } = setup();
        await bridge.handle(client, {
            type: 'thread.create',
            id: 'pin1',
            pageUrl: 'http://localhost:3000/',
            prompt: 'Make it bigger',
            anchor: { selector: 'h1', offsetX: 0.5, offsetY: 0.5 },
            context,
            providerThreadId: 'p1',
        });
        expect(provider.sent[0]?.providerThreadId).toBe('p1');
        expect(provider.sent[0]?.text).toContain('<tencil-context>');
        expect(store.get('pin1')?.provider).toMatchObject({ threadId: 'p1', url: 'fake://p1' });
    });

    it('fans updates out to every pin bound to the same thread', async () => {
        const { bridge, client, provider, store } = setup();
        await bridge.handle(client, {
            type: 'thread.open',
            id: 'dock1',
            providerThreadId: 'p1',
            title: 'Existing work',
        });
        await bridge.handle(client, {
            type: 'thread.create',
            id: 'pin1',
            pageUrl: 'http://localhost:3000/',
            prompt: 'Tweak',
            anchor: { selector: 'h1', offsetX: 0.5, offsetY: 0.5 },
            context,
            providerThreadId: 'p1',
        });
        provider.sinks.get('p1')?.message({
            id: 'a1',
            role: 'assistant',
            text: 'Done',
            streaming: false,
            createdAt: '2026-10-07T10:00:05.000Z',
        });
        expect(store.get('dock1')?.messages.map(m => m.text)).toContain('Done');
        expect(store.get('pin1')?.messages.map(m => m.text)).toContain('Done');
        expect(store.get('dock1')?.anchor).toBeUndefined();
    });

    it('reuses the unpinned record when the same thread is opened twice', async () => {
        const { bridge, client, store } = setup();
        await bridge.handle(client, { type: 'thread.open', id: 'a', providerThreadId: 'p1' });
        await bridge.handle(client, { type: 'thread.open', id: 'b', providerThreadId: 'p1' });
        expect(store.get('b')).toBeUndefined();
    });

    it('queues comments and sends them together as one thread', async () => {
        const { bridge, client, store, provider } = setup();
        const PNG = 'data:image/png;base64,AAAA';
        const queue = (id: string, prompt: string, withShot = false) =>
            bridge.handle(client, {
                type: 'thread.create',
                id,
                pageUrl: 'http://localhost:3000/',
                prompt,
                anchor: { selector: 'h1', offsetX: 0.5, offsetY: 0.5 },
                context,
                attachments: withShot
                    ? [{ name: 'a.png', mimeType: 'image/png', dataUrl: PNG }]
                    : [],
                draft: true,
            });
        await queue('a', 'Make it red');
        await queue('b', 'Make it bigger', true);
        expect(store.get('a')?.status).toBe('draft');
        expect(provider.created).toEqual([]);

        await bridge.handle(client, { type: 'thread.edit', threadId: 'a', prompt: 'Make it blue' });
        expect(store.get('a')?.messages[0]?.text).toBe('Make it blue');

        await bridge.handle(client, {
            type: 'drafts.send',
            drafts: [
                { threadId: 'a', number: 3 },
                { threadId: 'b', number: 4 },
            ],
        });
        expect(provider.created).toHaveLength(1);
        const [batch] = provider.created;
        expect(stripContext(batch!.text)).toBe('#3 Make it blue\n\n#4 Make it bigger');
        expect(batch!.attachments).toHaveLength(1);
        expect(batch!.text).toContain('- Screenshot: attached image 1');
        for (const id of ['a', 'b']) {
            expect(store.get(id)).toMatchObject({
                status: 'working',
                provider: { id: 'fake', threadId: 'new' },
            });
        }
        // One subscription, shared: the agent's reply lands on both pins.
        provider.sinks.get('new')?.message({
            id: 'm1',
            role: 'assistant',
            text: 'Fixed #3 and #4',
            streaming: false,
            createdAt: '2026-10-09T10:00:00.000Z',
        });
        for (const id of ['a', 'b']) {
            expect(store.get(id)?.messages.map(m => m.text)).toContain('Fixed #3 and #4');
        }
    });

    it('keeps queued comments when the batch fails to send', async () => {
        const { bridge, client, store, provider } = setup();
        await bridge.handle(client, {
            type: 'thread.create',
            id: 'a',
            pageUrl: 'http://localhost:3000/',
            prompt: 'Make it red',
            anchor: { selector: 'h1', offsetX: 0.5, offsetY: 0.5 },
            context,
            draft: true,
        });
        provider.failCreate = true;
        await bridge.handle(client, {
            type: 'drafts.send',
            drafts: [{ threadId: 'a', number: 1 }],
        });
        expect(store.get('a')).toMatchObject({
            status: 'draft',
            statusDetail: 'Agent offline',
            messages: [expect.objectContaining({ text: 'Make it red' })],
        });
    });

    it('re-anchors a pin that was dragged', async () => {
        const { bridge, client, store } = setup();
        await bridge.handle(client, {
            type: 'thread.create',
            id: 'a',
            pageUrl: 'http://localhost:3000/',
            prompt: 'Make it red',
            anchor: { selector: 'h1', offsetX: 0.5, offsetY: 0.5 },
            context,
        });
        const anchor = { selector: 'main > p', offsetX: 0, offsetY: 1 };
        await bridge.handle(client, { type: 'thread.move', threadId: 'a', anchor });
        expect(store.get('a')?.anchor).toEqual(anchor);
    });

    it('stops watching once the last pin for a thread is deleted', async () => {
        const { bridge, client, provider } = setup();
        await bridge.handle(client, { type: 'thread.open', id: 'a', providerThreadId: 'p1' });
        await bridge.handle(client, { type: 'thread.delete', threadId: 'a' });
        expect(provider.sinks.has('p1')).toBe(false);
    });
});
