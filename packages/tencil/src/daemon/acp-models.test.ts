import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { waitFor } from '@tencildev/testing';
import { describe, expect, it } from 'vitest';
import { AcpModelStore, acpModelsPath } from './acp-models.ts';

const OPENCODE = {
    configId: 'model',
    choices: [
        { value: 'opencode/big-pickle', name: 'opencode/Big Pickle' },
        { value: 'openai/gpt-6.1-sol', name: 'openai/GPT-6.1 Sol', group: 'OpenAI' },
    ],
    defaultModel: 'opencode/big-pickle',
};

const path = () => acpModelsPath(mkdtempSync(join(tmpdir(), 'tencil-acp-models-')));

describe('AcpModelStore', () => {
    it("keeps each agent's models for the next start", async () => {
        const file = path();
        const store = new AcpModelStore(file);
        expect(await store.for('opencode').get()).toBeUndefined();

        store.for('opencode').set(OPENCODE);
        store.for('devin').set({ configId: 'model', choices: [{ value: 'opus', name: 'Opus' }] });
        await waitFor(() => readFileSync(file, 'utf8').includes('devin'), { message: 'saved' });

        const next = new AcpModelStore(file);
        expect(await next.for('opencode').get()).toEqual(OPENCODE);
        expect((await next.for('devin').get())?.choices).toEqual([{ value: 'opus', name: 'Opus' }]);
        expect(await next.for('goose').get()).toBeUndefined();
    });

    it("drops entries that don't read, and a file that isn't JSON", async () => {
        const file = path();
        writeFileSync(file, JSON.stringify({ opencode: OPENCODE, devin: { choices: 'none' } }));
        const store = new AcpModelStore(file);
        expect(await store.for('opencode').get()).toEqual(OPENCODE);
        expect(await store.for('devin').get()).toBeUndefined();

        writeFileSync(file, 'not json');
        expect(await new AcpModelStore(file).for('opencode').get()).toBeUndefined();
    });
});
