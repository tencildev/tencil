import { mkdtempSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { savedProvider, saveProvider } from './agents.ts';
import { FileGlobalContext } from './global-context.ts';

const tempDir = () => mkdtempSync(join(tmpdir(), 'tencil-'));
const saved = async (dir: string) =>
    JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8')) as Record<string, unknown>;

describe('FileGlobalContext', () => {
    it('starts empty without a file', async () => {
        const store = new FileGlobalContext(tempDir());
        await store.load();
        expect(store.get()).toBe('');
    });

    it('keeps the context across restarts, next to the machine agent', async () => {
        const dir = tempDir();
        await saveProvider('codex', dir);
        const store = new FileGlobalContext(dir);
        await store.load();
        await store.set('Run the /frontend-design skill first');
        expect(await saved(dir)).toEqual({
            version: 1,
            provider: 'codex',
            context: 'Run the /frontend-design skill first',
        });

        const reloaded = new FileGlobalContext(dir);
        await reloaded.load();
        expect(reloaded.get()).toBe('Run the /frontend-design skill first');

        // Choosing the agent again in setup keeps it.
        await saveProvider('claude-code', dir);
        expect(await saved(dir)).toMatchObject({ context: 'Run the /frontend-design skill first' });
        expect(await savedProvider(dir)).toBe('claude-code');
    });

    it('drops the setting when cleared', async () => {
        const dir = tempDir();
        const store = new FileGlobalContext(dir);
        await store.load();
        await store.set('Hi');
        await store.set('');
        expect(await saved(dir)).toEqual({ version: 1 });
    });

    it('tells listeners about each change', async () => {
        const store = new FileGlobalContext(tempDir());
        await store.load();
        const seen: string[] = [];
        store.onChange(() => seen.push(store.get()));
        await store.set('One');
        await store.set('One');
        await store.set('Two');
        expect(seen).toEqual(['One', 'Two']);
    });
});
