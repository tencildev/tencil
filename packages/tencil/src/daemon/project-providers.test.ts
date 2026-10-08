import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Provider } from '@tencil/protocol';
import { describe, expect, it } from 'vitest';
import { ProjectProviders } from './project-providers.ts';

const CHOICES = [
    { id: 't3code', label: 'T3 Code' },
    { id: 'claude-code', label: 'Claude Code' },
];

function fakeProvider(id: string): Provider & { started: number } {
    return {
        id,
        label: id,
        started: 0,
        async start() {
            this.started++;
        },
        info: () => ({ id, label: id, state: 'ready' }),
        onInfoChange: () => () => {},
        listThreads: async () => ({ project: { name: 'x' }, threads: [] }),
        threadUrl: () => undefined,
        createThread: async () => ({ providerThreadId: 'p' }),
        sendMessage: async () => {},
        interrupt: async () => {},
        watch: () => () => {},
        dispose: async () => {},
    };
}

function setup(settingsPath = join(mkdtempSync(join(tmpdir(), 'tencil-')), 'settings.json')) {
    const created: string[] = [];
    const providers = new ProjectProviders({
        choices: CHOICES,
        fallback: 't3code',
        create: id => {
            created.push(id);
            return fakeProvider(id);
        },
        settingsPath,
    });
    return { providers, created, settingsPath };
}

describe('ProjectProviders', () => {
    it("uses the daemon's provider until the project picks one", async () => {
        const { providers, created } = setup();
        await providers.load();
        expect(providers.defaultId).toBe('t3code');
        expect(created).toEqual([]);
        expect(providers.default().id).toBe('t3code');
        expect(created).toEqual(['t3code']);
    });

    it('creates and starts each provider once', () => {
        const { providers, created } = setup();
        const first = providers.get('claude-code') as ReturnType<typeof fakeProvider>;
        expect(providers.get('claude-code')).toBe(first);
        expect(first.started).toBe(1);
        expect(created).toEqual(['claude-code']);
    });

    it("saves the project's choice and tells listeners", async () => {
        const { providers, settingsPath } = setup();
        let changes = 0;
        providers.onDefaultChange(() => changes++);
        await providers.setDefault('claude-code');
        expect(providers.defaultId).toBe('claude-code');
        expect(changes).toBe(1);

        const reloaded = setup(settingsPath).providers;
        await reloaded.load();
        expect(reloaded.defaultId).toBe('claude-code');
    });

    it('rejects providers that are not a choice', async () => {
        const { providers } = setup();
        await expect(providers.setDefault('nope')).rejects.toThrow('Unknown provider');
        expect(providers.has('nope')).toBe(false);
        expect(providers.has('claude-code')).toBe(true);
    });
});
