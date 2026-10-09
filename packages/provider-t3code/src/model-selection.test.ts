import { describe, expect, it } from 'vitest';
import {
    type ModelSources,
    modelOptions,
    pickedSelection,
    resolveModelSelection,
    type WireServerProvider,
} from './model-selection.ts';

const codex: WireServerProvider = {
    instanceId: 'codex',
    driver: 'codex',
    displayName: 'Codex',
    enabled: true,
    installed: true,
    status: 'ready',
    models: [{ slug: 'gpt-6-astra', name: 'GPT-6 Astra', isDefault: true }],
};
const claude: WireServerProvider = {
    instanceId: 'claudeAgent',
    driver: 'claudeAgent',
    displayName: 'Claude',
    enabled: true,
    installed: true,
    status: 'ready',
    models: [
        { slug: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
        { slug: 'claude-fable-5-1', name: 'Claude Fable 5.1', isDefault: true },
    ],
};
const cursor: WireServerProvider = {
    instanceId: 'cursor',
    driver: 'cursor',
    enabled: false,
    installed: false,
    status: 'disabled',
    models: [],
};

const sources = (overrides: Partial<ModelSources> = {}): ModelSources => ({
    providers: [codex, claude, cursor],
    projectId: 'p1',
    recent: [],
    ...overrides,
});

describe('resolveModelSelection', () => {
    it("uses the project's own default once settings are folded", () => {
        expect(
            resolveModelSelection(
                sources({
                    settings: {
                        projectSettingsFolded: true,
                        projectSettingsOverrides: {
                            p1: {
                                defaultModelSelection: {
                                    instanceId: 'claudeAgent',
                                    model: 'claude-opus-5-5',
                                },
                            },
                        },
                        defaultModelSelection: { instanceId: 'codex', model: 'gpt-6-astra' },
                    },
                    // Stale once folded.
                    projectDefault: { instanceId: 'codex', model: 'gpt-6-astra' },
                }),
            ),
        ).toEqual({ instanceId: 'claudeAgent', model: 'claude-opus-5-5' });
    });

    it('uses the project record before settings are folded', () => {
        expect(
            resolveModelSelection(
                sources({
                    settings: { projectSettingsFolded: false },
                    projectDefault: { instanceId: 'claudeAgent', model: 'claude-opus-5-5' },
                }),
            ),
        ).toEqual({ instanceId: 'claudeAgent', model: 'claude-opus-5-5' });
    });

    it("falls back to the environment's default", () => {
        expect(
            resolveModelSelection(
                sources({
                    settings: {
                        projectSettingsFolded: true,
                        defaultModelSelection: {
                            instanceId: 'claudeAgent',
                            model: 'claude-fable-5-1',
                            options: [{ id: 'effort', value: 'high' }],
                        },
                    },
                }),
            ),
        ).toEqual({
            instanceId: 'claudeAgent',
            model: 'claude-fable-5-1',
            options: [{ id: 'effort', value: 'high' }],
        });
    });

    it('reuses the model of the newest thread when nothing is set', () => {
        expect(
            resolveModelSelection(
                sources({
                    settings: { projectSettingsFolded: true, defaultModelSelection: null },
                    recent: [
                        { instanceId: 'claudeAgent', model: 'claude-opus-5-5' },
                        { instanceId: 'codex', model: 'gpt-6-astra' },
                    ],
                }),
            ),
        ).toEqual({ instanceId: 'claudeAgent', model: 'claude-opus-5-5' });
    });

    it('skips defaults whose agent is turned off', () => {
        expect(
            resolveModelSelection(
                sources({
                    settings: { defaultModelSelection: { instanceId: 'cursor', model: 'auto' } },
                    recent: [{ instanceId: 'claudeAgent', model: 'claude-opus-5-5' }],
                }),
            ),
        ).toEqual({ instanceId: 'claudeAgent', model: 'claude-opus-5-5' });
    });

    it("ends with the first ready agent's default model", () => {
        expect(resolveModelSelection(sources())).toEqual({
            instanceId: 'codex',
            model: 'gpt-6-astra',
        });
        expect(resolveModelSelection(sources({ providers: [cursor] }))).toBeUndefined();
    });
});

describe('modelOptions', () => {
    it('lists the models of agents that can start threads', () => {
        expect(modelOptions([codex, claude, cursor])).toEqual([
            { id: 'codex/gpt-6-astra', label: 'GPT-6 Astra', group: 'Codex', agent: 'codex' },
            {
                id: 'claudeAgent/claude-opus-5-5',
                label: 'Claude Opus 5.5',
                group: 'Claude',
                agent: 'claudeAgent',
            },
            {
                id: 'claudeAgent/claude-fable-5-1',
                label: 'Claude Fable 5.1',
                group: 'Claude',
                agent: 'claudeAgent',
            },
        ]);
    });
});

describe('pickedSelection', () => {
    it('parses a picked model, keeping slashes in its slug', () => {
        const openrouter = { ...codex, instanceId: 'opencode', driver: 'opencode' };
        expect(pickedSelection([openrouter], 'opencode/anthropic/claude')).toEqual({
            instanceId: 'opencode',
            model: 'anthropic/claude',
        });
    });

    it('drops picks whose agent is gone or malformed', () => {
        expect(pickedSelection([codex, cursor], 'cursor/auto')).toBeUndefined();
        expect(pickedSelection([codex], 'gpt-6-astra')).toBeUndefined();
        expect(pickedSelection([codex], undefined)).toBeUndefined();
    });
});
