import { mkdtempSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { projectStorePath, ThreadStore } from './thread-store.ts';

const thread = {
    id: 't1',
    title: 'Pin',
    status: 'idle',
    resolved: false,
    messages: [],
    provider: { id: 't3code', threadId: 'p1' },
    createdAt: '2026-10-08T10:00:00.000Z',
    updatedAt: '2026-10-08T10:00:00.000Z',
};

describe('ThreadStore', () => {
    it('keeps one file per project outside the repo', () => {
        const a = projectStorePath('/Users/me/Code/eyes', '/data');
        const b = projectStorePath('/Users/me/Work/eyes', '/data');
        expect(a.startsWith(join('/data', 'projects', 'eyes-'))).toBe(true);
        expect(a.split(sep).at(-1)).toMatch(/^eyes-[0-9a-f]{10}\.json$/);
        expect(a).not.toBe(b);
    });

    it('persists pins across restarts', async () => {
        const dataDir = mkdtempSync(join(tmpdir(), 'tencil-data-'));
        const store = new ThreadStore('/projects/acme', dataDir);
        await store.load();
        store.upsert(thread as never);
        await store.flush();

        const saved = JSON.parse(await readFile(store.path, 'utf8'));
        expect(saved).toMatchObject({ root: resolve('/projects/acme'), threads: [{ id: 't1' }] });

        const reloaded = new ThreadStore('/projects/acme', dataDir);
        await reloaded.load();
        expect(reloaded.get('t1')?.title).toBe('Pin');
    });
});
