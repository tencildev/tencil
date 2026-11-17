import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FilePreferences } from './preferences.ts';

const dir = () => mkdtempSync(join(tmpdir(), 'tencil-preferences-'));

describe('FilePreferences', () => {
    it('starts empty', async () => {
        expect(await new FilePreferences(join(dir(), 'preferences.json')).load()).toEqual({});
    });

    it('merges changes and keeps them for the next daemon', async () => {
        const path = join(dir(), 'preferences.json');
        await new FilePreferences(path).update({ theme: 'light' });
        const shortcuts = {
            comment: { code: 'KeyK', key: 'K', alt: false, ctrl: false, meta: false, shift: true },
            ruler: null,
            hidePins: null,
            hideDock: { code: 'KeyT', key: 'T', alt: true, ctrl: false, meta: false, shift: false },
            measure: 'Shift' as const,
        };
        await new FilePreferences(path).update({ shortcuts });

        expect(await new FilePreferences(path).load()).toEqual({ theme: 'light', shortcuts });
        expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ version: 1 });
    });

    it('treats a broken file as none', async () => {
        const path = join(dir(), 'preferences.json');
        writeFileSync(path, '{ not json');
        expect(await new FilePreferences(path).load()).toEqual({});
        writeFileSync(path, JSON.stringify({ version: 1, theme: 'sepia' }));
        expect(await new FilePreferences(path).load()).toEqual({});
    });
});
