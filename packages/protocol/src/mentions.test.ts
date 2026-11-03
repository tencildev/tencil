import { describe, expect, it } from 'vitest';
import { AGENT_HANDLE, mentionsAgent, mentionsOf } from './mentions.ts';

describe('mentionsOf', () => {
    it('finds handles, lowercased, each once', () => {
        expect(mentionsOf('@Ann can you check this with @bob.smith? @ann')).toEqual([
            'ann',
            'bob.smith',
        ]);
    });

    it('skips email addresses and a lone @', () => {
        expect(mentionsOf('mail ann@example.com or @ about it')).toEqual([]);
    });

    it('trims trailing punctuation', () => {
        expect(mentionsOf('thanks @ann. and @bob-, (@carol_x)')).toEqual(['ann', 'bob', 'carol_x']);
    });

    it('needs a letter or digit first', () => {
        expect(mentionsOf('@-ann @.bob @_carol @9lives')).toEqual(['9lives']);
    });
});

describe('mentionsAgent', () => {
    it('is true for @tencil in any case, at any place', () => {
        expect(AGENT_HANDLE).toBe('tencil');
        expect(mentionsAgent('@tencil make it red')).toBe(true);
        expect(mentionsAgent('Agreed. @Tencil, go ahead.')).toBe(true);
        expect(mentionsAgent('line one\n@tencil')).toBe(true);
    });

    it('is false for other handles and lookalikes', () => {
        expect(mentionsAgent('ask @tencil-bot')).toBe(false);
        expect(mentionsAgent('team@tencil.dev')).toBe(false);
        expect(mentionsAgent('tencil, please')).toBe(false);
    });
});
