import { describe, expect, it } from 'vitest';
import { modelSetting } from './models.ts';

const select = (fields: Record<string, unknown>) => ({
    name: 'Model',
    type: 'select',
    currentValue: 'b',
    options: [
        { value: 'a', name: 'Model A' },
        { value: 'b', name: 'Model B' },
    ],
    ...fields,
});

describe('modelSetting', () => {
    it('reads the select in the model category, with the model the session is on', () => {
        const mode = select({ id: 'mode', category: 'mode' });
        expect(modelSetting([mode, select({ id: 'llm', category: 'model' })])).toEqual({
            models: {
                configId: 'llm',
                choices: [
                    { value: 'a', name: 'Model A' },
                    { value: 'b', name: 'Model B' },
                ],
            },
            current: 'b',
        });
    });

    it('falls back on a select called model, for agents that leave out the category', () => {
        expect(modelSetting([select({ id: 'model' })])?.models.configId).toBe('model');
    });

    it('names the group of each model in a grouped list', () => {
        const grouped = select({
            id: 'model',
            options: [{ group: 'fast', name: 'Fast', options: [{ value: 'a', name: '' }] }],
        });
        expect(modelSetting([grouped])?.models.choices).toEqual([
            { value: 'a', name: 'a', group: 'Fast' },
        ]);
    });

    it('groups a flat list of provider/model names by provider', () => {
        const named = select({
            id: 'model',
            options: [
                { value: 'opencode/big-pickle', name: 'OpenCode/Big Pickle' },
                { value: 'openai/gpt-6.1-sol', name: 'OpenAI/GPT-6.1 Sol' },
            ],
        });
        expect(modelSetting([named])?.models.choices).toEqual([
            { value: 'opencode/big-pickle', name: 'Big Pickle', group: 'OpenCode' },
            { value: 'openai/gpt-6.1-sol', name: 'GPT-6.1 Sol', group: 'OpenAI' },
        ]);
        // Unless some name isn't one.
        const mixed = select({
            id: 'model',
            options: [
                { value: 'a', name: 'OpenAI/GPT-6.1 Sol' },
                { value: 'b', name: 'Auto' },
            ],
        });
        expect(modelSetting([mixed])?.models.choices.map(choice => choice.group)).toEqual([
            undefined,
            undefined,
        ]);
    });

    it('finds none without settings, a model select or any models in it', () => {
        expect(modelSetting(undefined)).toBeUndefined();
        expect(modelSetting([select({ id: 'mode', category: 'mode' })])).toBeUndefined();
        expect(
            modelSetting([{ id: 'model', type: 'boolean', name: 'Model', currentValue: true }]),
        ).toBeUndefined();
        expect(modelSetting([select({ id: 'model', options: [] })])).toBeUndefined();
    });
});
