import type { ServerMessage, Viewer } from '@tencildev/protocol';
import { FakeAgentProvider } from '@tencildev/testing';
import { describe, expect, it } from 'vitest';
import { Bridge, type BridgeClient, mergeMessage } from './bridge.ts';
import { ProjectProviders } from './project-providers.ts';
import { stripContext } from './prompt.ts';
import { MemoryThreadStore } from './thread-store.ts';

const context = {
    tagName: 'h1',
    selector: 'h1',
    html: '<h1>Hi</h1>',
    components: [],
    rect: { x: 0, y: 0, width: 10, height: 10 },
    viewport: { width: 100, height: 100, dpr: 1 },
};
const anchor = { selector: 'h1', offsetX: 0.5, offsetY: 0.5 };
const screenshot = {
    name: 'element.png',
    mimeType: 'image/png' as const,
    dataUrl: 'data:image/png;base64,aGk=',
};

const ada: Viewer = {
    name: 'Ada',
    login: 'ada',
    avatarUrl: 'https://x.dev/ada.png',
    access: 'write',
};
const bob: Viewer = { name: 'Bob', access: 'write' };
const members = [{ handle: 'bob', name: 'Bob' }];

function setup(comments = true) {
    const provider = new FakeAgentProvider();
    const store = new MemoryThreadStore();
    const bridge = new Bridge({
        providers: ProjectProviders.of(provider),
        store,
        project: { name: 'x', root: '/x' },
        version: '0',
        comments,
    });
    const received: ServerMessage[] = [];
    const client = (viewer?: Viewer): BridgeClient => {
        const connection: BridgeClient = { send: message => received.push(message), viewer };
        bridge.connect(connection);
        return connection;
    };
    return { provider, store, bridge, client, received };
}

async function pin(bridge: Bridge, client: BridgeClient, prompt: string, extra = {}) {
    await bridge.handle(client, {
        type: 'thread.create',
        id: 'pin1',
        pageUrl: 'http://localhost:3000/',
        prompt,
        anchor,
        context,
        ...extra,
    });
}

describe('comments', () => {
    it('sends comments and the members in ready', async () => {
        const { bridge, received } = setup();
        const connection: BridgeClient = { send: m => received.push(m), viewer: ada, members };
        bridge.connect(connection);
        await bridge.handle(connection, { type: 'hello', protocol: 1, pageUrl: 'https://x.dev/' });
        expect(received.find(m => m.type === 'ready')).toMatchObject({ comments: true, members });
    });

    it('leaves ready as it was when comments are off', async () => {
        const { bridge, client, received } = setup(false);
        await bridge.handle(client(), { type: 'hello', protocol: 1, pageUrl: 'https://x.dev/' });
        const ready = received.find(m => m.type === 'ready');
        expect(ready).not.toHaveProperty('comments');
        expect(ready).not.toHaveProperty('members');
    });

    it('starts a discussion without the agent', async () => {
        const { bridge, client, provider, store, received } = setup();
        await pin(bridge, client(ada), 'Should this be red, @bob?', { attachments: [screenshot] });
        expect(provider.created).toHaveLength(0);
        const thread = store.get('pin1')!;
        expect(thread).toMatchObject({
            status: 'discussion',
            pageUrl: 'http://localhost:3000/',
            anchor,
            provider: { id: 'fake' },
        });
        expect(thread.provider.threadId).toBeUndefined();
        expect(thread.messages).toEqual([
            expect.objectContaining({
                role: 'comment',
                text: 'Should this be red, @bob?',
                author: { name: 'Ada', login: 'ada', avatarUrl: 'https://x.dev/ada.png' },
            }),
        ]);
        expect(received.some(m => m.type === 'thread.upsert')).toBe(true);
    });

    it('keeps the discussion going in comments', async () => {
        const { bridge, client, provider, store } = setup();
        await pin(bridge, client(ada), 'Should this be red?');
        await bridge.handle(client(bob), { type: 'thread.reply', threadId: 'pin1', text: 'Yes' });
        expect(provider.created).toHaveLength(0);
        expect(provider.sent).toHaveLength(0);
        const thread = store.get('pin1')!;
        expect(thread.status).toBe('discussion');
        expect(thread.messages.map(m => [m.role, m.author?.name, m.text])).toEqual([
            ['comment', 'Ada', 'Should this be red?'],
            ['comment', 'Bob', 'Yes'],
        ]);
    });

    it('hands a discussion to the agent with what the team said', async () => {
        const { bridge, client, provider, store } = setup();
        await pin(bridge, client(ada), 'Should this be red?', { attachments: [screenshot] });
        await bridge.handle(client(bob), {
            type: 'thread.reply',
            threadId: 'pin1',
            text: 'Brand red,\nnot orange',
        });
        await bridge.handle(client(ada), {
            type: 'thread.reply',
            threadId: 'pin1',
            text: '@tencil make it brand red',
        });
        expect(provider.created).toHaveLength(1);
        const { text, attachments } = provider.created[0]!;
        expect(stripContext(text)).toBe('@tencil make it brand red');
        expect(text).toContain(
            'Your team discussed this element:\nAda: Should this be red?\nBob: Brand red,\n  not orange\n',
        );
        expect(text).toContain('- Element: `<h1>Hi</h1>`');
        expect(text).toContain('- A screenshot of the element is attached.');
        expect(attachments).toEqual([screenshot]);

        const thread = store.get('pin1')!;
        expect(thread.status).toBe('working');
        expect(thread.provider.threadId).toBe('fake-1');
        expect(thread.messages.at(-1)).toMatchObject({
            role: 'user',
            text: '@tencil make it brand red',
            author: { name: 'Ada', login: 'ada' },
        });
        expect(provider.sinks.has('fake-1')).toBe(true);
    });

    it('marks a failed handoff and can hand it over again', async () => {
        const { bridge, client, provider, store } = setup();
        await pin(bridge, client(ada), 'Too small');
        provider.failCreate = true;
        await bridge.handle(client(ada), {
            type: 'thread.reply',
            threadId: 'pin1',
            text: '@tencil',
        });
        expect(store.get('pin1')).toMatchObject({ status: 'error', statusDetail: 'Agent offline' });
        provider.failCreate = false;
        await bridge.handle(client(ada), {
            type: 'thread.reply',
            threadId: 'pin1',
            text: '@tencil try again',
        });
        expect(store.get('pin1')?.provider.threadId).toBe('fake-1');
    });

    it('creates an agent thread right away when the first comment tags it', async () => {
        const { bridge, client, provider, store } = setup();
        await pin(bridge, client(ada), '@tencil make it red');
        expect(provider.created).toHaveLength(1);
        expect(store.get('pin1')).toMatchObject({ status: 'working' });
        expect(store.get('pin1')?.messages[0]).toMatchObject({
            role: 'user',
            author: { name: 'Ada' },
        });
    });

    it('comments on a pin the agent works on without telling it', async () => {
        const { bridge, client, provider, store } = setup();
        await pin(bridge, client(ada), '@tencil make it red');
        store.upsert({ ...store.get('pin1')!, status: 'idle' });
        await bridge.handle(client(bob), {
            type: 'thread.reply',
            threadId: 'pin1',
            text: 'Looks good',
        });
        expect(provider.sent).toHaveLength(0);
        expect(store.get('pin1')?.status).toBe('idle');
        expect(store.get('pin1')?.messages.at(-1)).toMatchObject({ role: 'comment' });
    });

    it('tells the agent what the team said since its last turn', async () => {
        const { bridge, client, provider, store } = setup();
        await pin(bridge, client(ada), '@tencil make it red');
        const sink = provider.sinks.get('fake-1')!;
        sink.message({
            id: 'a1',
            role: 'assistant',
            text: 'Done',
            streaming: false,
            createdAt: new Date().toISOString(),
        });
        sink.status('idle');
        await bridge.handle(client(bob), {
            type: 'thread.reply',
            threadId: 'pin1',
            text: 'Darker?',
        });
        await bridge.handle(client(ada), {
            type: 'thread.reply',
            threadId: 'pin1',
            text: '@tencil a bit darker',
        });
        expect(provider.sent).toHaveLength(1);
        const { text, providerThreadId } = provider.sent[0]!;
        expect(providerThreadId).toBe('fake-1');
        expect(stripContext(text)).toBe('@tencil a bit darker');
        expect(text).toContain('Since your last turn the team said:\nBob: Darker?');
        expect(store.get('pin1')?.messages.at(-1)).toMatchObject({
            role: 'user',
            author: { name: 'Ada' },
        });

        await bridge.handle(client(ada), {
            type: 'thread.reply',
            threadId: 'pin1',
            text: '@tencil and bolder',
        });
        expect(provider.sent[1]?.text).toBe('@tencil and bolder');
    });

    it('lets a read-only viewer comment but not tag the agent', async () => {
        const { bridge, client, provider, store, received } = setup();
        const reader = client({ name: 'Rita', access: 'read' });
        await pin(bridge, reader, 'Typo here');
        expect(store.get('pin1')?.status).toBe('discussion');
        await bridge.handle(reader, {
            type: 'thread.reply',
            threadId: 'pin1',
            text: '@tencil fix',
        });
        expect(provider.created).toHaveLength(0);
        expect(received.at(-1)).toMatchObject({
            type: 'error',
            threadId: 'pin1',
            message: 'Only people with write access to the repository can hand work to the agent',
        });
        expect(store.get('pin1')?.messages).toHaveLength(1);
    });

    it('queues drafts as before, with their author', async () => {
        const { bridge, client, provider, store } = setup();
        await pin(bridge, client(ada), 'Later', { draft: true });
        expect(provider.created).toHaveLength(0);
        expect(store.get('pin1')).toMatchObject({
            status: 'draft',
            messages: [{ role: 'user', author: { name: 'Ada' } }],
        });
    });
});

describe('authors without comments', () => {
    it('sets the author on messages and keeps it when the provider copy arrives', async () => {
        const { bridge, client, provider, store } = setup(false);
        await pin(bridge, client(ada), 'Make it red');
        expect(provider.created).toHaveLength(1);
        const sink = provider.sinks.get('fake-1')!;
        sink.message({
            id: 'u1',
            role: 'user',
            text: provider.created[0]!.text,
            streaming: false,
            createdAt: new Date().toISOString(),
        });
        expect(store.get('pin1')?.messages).toEqual([
            expect.objectContaining({ id: 'u1', author: expect.objectContaining({ name: 'Ada' }) }),
        ]);
        // A later snapshot of the same message keeps it too.
        sink.message({
            id: 'u1',
            role: 'user',
            text: 'Make it red',
            streaming: false,
            createdAt: new Date().toISOString(),
        });
        expect(store.get('pin1')?.messages[0]?.author?.name).toBe('Ada');
    });

    it('replies to the agent as before, even when they tag it', async () => {
        const { bridge, client, provider } = setup(false);
        await pin(bridge, client(ada), 'Make it red');
        await bridge.handle(client(ada), { type: 'thread.reply', threadId: 'pin1', text: 'Nice' });
        expect(provider.sent[0]?.text).toBe('Nice');
    });

    it('leaves messages without a viewer authorless', () => {
        const thread = mergeMessage(
            {
                id: 't',
                title: 't',
                status: 'working',
                resolved: false,
                messages: [],
                provider: { id: 'fake' },
                createdAt: '',
                updatedAt: '',
            },
            { id: 'a', role: 'assistant', text: 'Hi', streaming: false, createdAt: '' },
        );
        expect(thread.messages[0]).not.toHaveProperty('author');
    });
});
