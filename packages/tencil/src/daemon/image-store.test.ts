import { mkdtempSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileImageStore, projectImagesPath } from './image-store.ts';

const PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const ID = 'a'.repeat(32);

describe('FileImageStore', () => {
    it('keeps images next to the pins, one file each', () => {
        const path = projectImagesPath('/Users/me/Code/eyes', '/data');
        expect(path).toMatch(/[\\/]projects[\\/]eyes-[0-9a-f]{10}\.images$/);
    });

    it('saves images as files and reads them back after a restart', async () => {
        const dir = join(mkdtempSync(join(tmpdir(), 'tencil-images-')), 'acme.images');
        const store = new FileImageStore(dir);
        store.put(ID, PNG);
        await store.flush();
        expect(readdirSync(dir)).toEqual([`${ID}.png`]);
        if (process.platform !== 'win32') {
            expect(statSync(join(dir, `${ID}.png`)).mode & 0o777).toBe(0o600);
        }

        const restarted = new FileImageStore(dir);
        expect(await restarted.get(ID)).toBe(PNG);
        restarted.delete(ID);
        await restarted.flush();
        expect(readdirSync(dir)).toEqual([]);
        expect(await restarted.get(ID)).toBeUndefined();
    });

    it("ignores ids that aren't hashes and types the overlay doesn't show", async () => {
        const dir = mkdtempSync(join(tmpdir(), 'tencil-images-'));
        const store = new FileImageStore(dir);
        store.put('../../etc/passwd', PNG);
        store.put(ID, 'data:image/svg+xml;base64,PHN2Zz4=');
        await store.flush();
        expect(readdirSync(dir)).toEqual([]);
        expect(await store.get('../thread')).toBeUndefined();
    });
});
