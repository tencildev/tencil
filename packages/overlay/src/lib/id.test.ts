import { afterEach, describe, expect, it, vi } from 'vitest';
import { newId } from './id.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('newId', () => {
    it('makes v4 UUIDs without crypto.randomUUID (insecure contexts)', () => {
        vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
        const ids = new Set(Array.from({ length: 50 }, () => newId()));
        expect(ids.size).toBe(50);
        for (const id of ids) expect(id).toMatch(UUID);
    });

    it('uses crypto.randomUUID when the page has it', () => {
        expect(newId()).toMatch(UUID);
    });
});
