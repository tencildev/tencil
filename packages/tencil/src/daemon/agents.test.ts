import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { machineProvider, savedProvider, saveProvider } from './agents.ts';

const dataDir = () => mkdtempSync(join(tmpdir(), 'tencil-agents-'));

describe("the machine's agent", () => {
    it('is remembered once chosen', async () => {
        const dir = dataDir();
        expect(await savedProvider(dir)).toBeUndefined();
        await saveProvider('claude-code', dir);
        expect(await savedProvider(dir)).toBe('claude-code');
        expect(await machineProvider({ dataDir: dir })).toBe('claude-code');
    });

    it('ignores a broken or unknown settings file', async () => {
        const dir = dataDir();
        writeFileSync(join(dir, 'settings.json'), '{ nope');
        expect(await savedProvider(dir)).toBeUndefined();
        writeFileSync(join(dir, 'settings.json'), '{"version":1,"provider":"cursor"}');
        expect(await savedProvider(dir)).toBeUndefined();
    });
});
