import type { Thread } from '@tencil/protocol';
import { describe, expect, it } from 'vitest';
import { MemoryThreadStore } from './thread-store.ts';

const thread = (id: string, createdAt: string, extra: Partial<Thread> = {}): Thread => ({
    id,
    title: 'Pin',
    status: 'idle',
    resolved: false,
    messages: [],
    provider: { id: 'fake', threadId: `p-${id}` },
    createdAt,
    updatedAt: createdAt,
    ...extra,
});

describe('MemoryThreadStore', () => {
    it('lists pins oldest first', () => {
        const store = new MemoryThreadStore();
        store.upsert(thread('b', '2026-10-08T10:00:01.000Z'));
        store.upsert(thread('a', '2026-10-08T10:00:00.000Z'));
        expect(store.list().map(t => t.id)).toEqual(['a', 'b']);
        expect(store.delete('a')).toBe(true);
        expect(store.delete('a')).toBe(false);
        expect(store.get('b')?.title).toBe('Pin');
    });

    it('fails pins whose provider thread was never created', () => {
        const store = new MemoryThreadStore([
            thread('a', '2026-10-08T10:00:00.000Z', { status: 'starting', provider: { id: 'x' } }),
            thread('b', '2026-10-08T10:00:01.000Z', { status: 'working' }),
        ]);
        expect(store.get('a')).toMatchObject({
            status: 'error',
            statusDetail: 'Bridge stopped before the thread was created',
        });
        expect(store.get('b')?.status).toBe('working');
    });
});
