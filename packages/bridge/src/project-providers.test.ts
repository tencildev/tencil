import { FakeAgentProvider } from '@tencildev/testing';
import { describe, expect, it } from 'vitest';
import {
    ProjectProviders,
    type ProjectSettingsStore,
    type SavedProjectSettings,
} from './project-providers.ts';

const CHOICES = [
    { id: 't3code', label: 'T3 Code' },
    { id: 'claude-code', label: 'Claude Code' },
];

/** Settings kept in a variable, shared by every `ProjectProviders` given the same store. */
function memorySettings(): ProjectSettingsStore & { saved?: SavedProjectSettings } {
    return {
        async load() {
            return this.saved;
        },
        async save(settings) {
            this.saved = structuredClone(settings);
        },
    };
}

function setup(settings = memorySettings()) {
    const created: string[] = [];
    const providers = new ProjectProviders({
        choices: CHOICES,
        fallback: 't3code',
        create: id => {
            created.push(id);
            return new FakeAgentProvider({ id });
        },
        settings,
    });
    return { providers, created, settings };
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
        const first = providers.get('claude-code') as FakeAgentProvider;
        expect(providers.get('claude-code')).toBe(first);
        expect(first.started).toBe(1);
        expect(created).toEqual(['claude-code']);
    });

    it("saves the project's choice and tells listeners", async () => {
        const { providers, settings } = setup();
        let changes = 0;
        providers.onDefaultChange(() => changes++);
        await providers.setDefault('claude-code');
        expect(providers.defaultId).toBe('claude-code');
        expect(changes).toBe(1);

        const reloaded = setup(settings).providers;
        await reloaded.load();
        expect(reloaded.defaultId).toBe('claude-code');
    });

    it('rejects providers that are not a choice', async () => {
        const { providers } = setup();
        await expect(providers.setDefault('nope')).rejects.toThrow('Unknown provider');
        expect(providers.has('nope')).toBe(false);
        expect(providers.has('claude-code')).toBe(true);
    });

    it('saves a model per provider and keeps it across loads', async () => {
        const { providers, settings } = setup();
        let changes = 0;
        providers.onSettingsChange(() => changes++);
        await providers.setModel('t3code', 'claudeAgent/claude-opus-5-5');
        expect(changes).toBe(1);

        const reloaded = setup(settings).providers;
        await reloaded.load();
        expect(reloaded.modelFor('t3code')).toBe('claudeAgent/claude-opus-5-5');
        expect(reloaded.modelFor('claude-code')).toBeUndefined();

        await reloaded.setModel('t3code', null);
        expect(reloaded.modelFor('t3code')).toBeUndefined();
    });

    it('keeps settings in memory without a store', async () => {
        const providers = ProjectProviders.of([
            new FakeAgentProvider({ id: 't3code' }),
            new FakeAgentProvider({ id: 'claude-code' }),
        ]);
        expect(providers.defaultId).toBe('t3code');
        expect(providers.choices.map(choice => choice.id)).toEqual(['t3code', 'claude-code']);
        await providers.setDefault('claude-code');
        await providers.setBatch(false);
        expect(providers.default().id).toBe('claude-code');
        expect(providers.batch).toBe(false);
    });
});
