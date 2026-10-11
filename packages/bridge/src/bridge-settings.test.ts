import type { ServerMessage } from '@tencil/protocol';
import { FakeAgentProvider } from '@tencil/testing';
import { describe, expect, it } from 'vitest';
import { Bridge, type BridgeClient } from './bridge.ts';
import { ProjectProviders } from './project-providers.ts';
import { MemoryThreadStore } from './thread-store.ts';

const LABELS: Record<string, string> = { t3code: 'T3 Code', 'claude-code': 'Claude Code' };

const pin = (id: string) => ({
    type: 'thread.create',
    id,
    pageUrl: 'http://localhost:3000/',
    prompt: 'Make it blue',
    anchor: { selector: 'h1', offsetX: 0.5, offsetY: 0.5 },
    context: {
        tagName: 'h1',
        selector: 'h1',
        html: '<h1>Hi</h1>',
        components: [],
        rect: { x: 0, y: 0, width: 10, height: 10 },
        viewport: { width: 100, height: 100, dpr: 1 },
    },
});

function setup() {
    const fakes = new Map<string, FakeAgentProvider>();
    const providers = new ProjectProviders({
        choices: [
            { id: 't3code', label: 'T3 Code' },
            { id: 'claude-code', label: 'Claude Code' },
        ],
        fallback: 't3code',
        create: id => {
            const fake = new FakeAgentProvider({ id, label: LABELS[id] });
            fakes.set(id, fake);
            return fake;
        },
    });
    const store = new MemoryThreadStore();
    const bridge = new Bridge({
        providers,
        store,
        project: { name: 'acme', root: '/x' },
        version: '0',
    });
    const received: ServerMessage[] = [];
    const client: BridgeClient = { send: message => received.push(message) };
    bridge.connect(client);
    return { bridge, client, received, store, fakes };
}

describe('project settings', () => {
    it('reports the settings when a page connects', async () => {
        const { bridge, client, received } = setup();
        await bridge.handle(client, { type: 'hello', protocol: 1, pageUrl: 'http://x/' });
        expect(received.at(-1)).toMatchObject({
            type: 'ready',
            provider: { id: 't3code' },
            settings: {
                provider: 't3code',
                providers: [{ id: 't3code' }, { id: 'claude-code' }],
            },
        });
    });

    it('sends new pins to the chosen provider and keeps old pins on theirs', async () => {
        const { bridge, client, received, store, fakes } = setup();
        await bridge.handle(client, pin('old'));
        expect(store.get('old')?.provider).toMatchObject({ id: 't3code', threadId: 't3code-1' });

        await bridge.handle(client, { type: 'settings.update', provider: 'claude-code' });
        expect(received).toContainEqual({
            type: 'settings',
            settings: expect.objectContaining({ provider: 'claude-code' }),
        });
        expect(received.at(-1)).toMatchObject({
            type: 'provider.status',
            provider: { id: 'claude-code' },
        });

        await bridge.handle(client, pin('new'));
        expect(store.get('new')?.provider).toMatchObject({
            id: 'claude-code',
            threadId: 'claude-code-1',
        });

        // A follow-up on the old pin still goes to T3 Code, and its updates still arrive.
        await bridge.handle(client, { type: 'thread.reply', threadId: 'old', text: 'More' });
        expect(fakes.get('t3code')?.sent.map(m => m.text)).toEqual(['More']);
        expect(fakes.get('claude-code')?.sent).toEqual([]);
        fakes.get('t3code')?.sinks.get('t3code-1')?.status('idle');
        expect(store.get('old')?.status).toBe('idle');
    });

    it('lists the threads of the chosen provider', async () => {
        const { bridge, client, received } = setup();
        await bridge.handle(client, { type: 'settings.update', provider: 'claude-code' });
        await bridge.handle(client, { type: 'provider.threads' });
        expect(received.at(-1)).toMatchObject({
            type: 'provider.threads',
            project: { name: 'Claude Code' },
        });
    });

    it("starts new threads on the model picked for the project's provider", async () => {
        const { bridge, client, received, fakes } = setup();
        await bridge.handle(client, { type: 'provider.models' });
        expect(received.at(-1)).toEqual({
            type: 'provider.models',
            provider: 't3code',
            models: [{ id: 't3code/fast', label: 'Fast', group: 'T3 Code' }],
            defaultModel: 't3code/fast',
        });

        await bridge.handle(client, { type: 'model.select', model: 't3code/fast' });
        expect(received.at(-1)).toEqual({
            type: 'settings',
            settings: expect.objectContaining({ provider: 't3code', model: 't3code/fast' }),
        });
        await bridge.handle(client, pin('a'));
        expect(fakes.get('t3code')?.created.at(-1)?.model).toBe('t3code/fast');

        // The pick belongs to T3 Code; Claude Code starts on its own default.
        await bridge.handle(client, { type: 'settings.update', provider: 'claude-code' });
        expect(received.findLast(m => m.type === 'settings')).toEqual({
            type: 'settings',
            settings: expect.not.objectContaining({ model: expect.anything() }),
        });
        await bridge.handle(client, pin('b'));
        expect(fakes.get('claude-code')?.created.at(-1)?.model).toBeUndefined();

        await bridge.handle(client, { type: 'settings.update', provider: 't3code' });
        await bridge.handle(client, { type: 'model.select', model: null });
        await bridge.handle(client, pin('c'));
        expect(fakes.get('t3code')?.created.at(-1)?.model).toBeUndefined();
    });

    it('turns batching on and off for the project', async () => {
        const { bridge, client, received } = setup();
        await bridge.handle(client, { type: 'hello', protocol: 1, pageUrl: 'http://x/' });
        // On by default.
        expect(received.at(-1)).toMatchObject({ settings: { batch: true } });
        await bridge.handle(client, { type: 'settings.update', batch: false });
        expect(received.at(-1)).toEqual({
            type: 'settings',
            settings: expect.objectContaining({ provider: 't3code', batch: false }),
        });
        await bridge.handle(client, { type: 'settings.update', batch: true });
        expect(received.at(-1)).toMatchObject({ settings: { batch: true } });
    });

    it('refuses an unknown provider', async () => {
        const { bridge, client, received } = setup();
        await bridge.handle(client, { type: 'settings.update', provider: 'nope' });
        expect(received.at(-1)).toMatchObject({
            type: 'error',
            message: 'Unknown provider "nope"',
        });
    });
});
