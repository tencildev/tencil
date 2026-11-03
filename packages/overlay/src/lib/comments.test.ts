import { describe, expect, it } from 'vitest';
import { initials, insertMention, mentionParts, mentionQuery, suggestionsFor } from './comments.ts';

const people = [
    { handle: 'ada', name: 'Ada Lovelace', avatarUrl: 'https://x.dev/ada.png' },
    { handle: 'grace', name: 'Grace Hopper' },
    { handle: 'bada', name: 'Bob Adams' },
];

describe('mentionQuery', () => {
    it('finds the @token the caret is in', () => {
        expect(mentionQuery('hi @ad', 6)).toEqual({ start: 3, query: 'ad' });
        expect(mentionQuery('@', 1)).toEqual({ start: 0, query: '' });
        expect(mentionQuery('(@gr', 4)).toEqual({ start: 1, query: 'gr' });
    });

    it('skips email addresses and text without an @', () => {
        expect(mentionQuery('ann@exa', 7)).toBeNull();
        expect(mentionQuery('hello', 5)).toBeNull();
        expect(mentionQuery('@ada and more', 13)).toBeNull();
    });
});

describe('suggestionsFor', () => {
    it('puts the agent first, then matching people, handles that start with it first', () => {
        expect(suggestionsFor('', people).map(s => s.handle)).toEqual([
            'tencil',
            'ada',
            'grace',
            'bada',
        ]);
        expect(suggestionsFor('ad', people).map(s => s.handle)).toEqual(['ada', 'bada']);
        expect(suggestionsFor('hop', people).map(s => s.handle)).toEqual(['grace']);
        expect(suggestionsFor('ten', people)).toEqual([
            { handle: 'tencil', name: 'Tencil', agent: true },
        ]);
    });
});

describe('insertMention', () => {
    it('replaces the token with the handle and a space', () => {
        expect(insertMention('hi @ad', 3, 6, 'ada')).toEqual({ text: 'hi @ada ', caret: 8 });
        expect(insertMention('@te please', 0, 3, 'tencil')).toEqual({
            text: '@tencil please',
            caret: 8,
        });
    });
});

describe('mentionParts', () => {
    it('marks known handles and the agent, keeping the rest as text', () => {
        expect(
            mentionParts('@Tencil ask @ada. or @nobody, mail a@ada.dev', new Set(['ada'])),
        ).toEqual([
            { text: '@Tencil', mention: 'agent' },
            { text: ' ask ' },
            { text: '@ada', mention: 'member' },
            { text: '. or @nobody, mail a@ada.dev' },
        ]);
    });
});

describe('initials', () => {
    it('takes the first and last word', () => {
        expect(initials('Ada Lovelace')).toBe('AL');
        expect(initials('grace')).toBe('G');
        expect(initials('Mary Ann Smith')).toBe('MS');
        expect(initials(' ')).toBe('?');
    });
});
