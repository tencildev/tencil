import { describe, expect, it } from 'vitest';
import { DEFAULT_SHORTCUTS, formatShortcut, holding, matches, shortcutFrom } from './shortcuts.ts';

const keys = (key: string, code: string, modifiers: Partial<Record<string, boolean>> = {}) => ({
    key,
    code,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...modifiers,
});

describe('shortcutFrom', () => {
    it('names a letter by what the layout prints', () => {
        // The A key on AZERTY sits where QWERTY has Q.
        expect(shortcutFrom(keys('a', 'KeyQ'))).toMatchObject({ code: 'KeyQ', key: 'A' });
    });

    it('names a letter by position when ⌥ changes what it prints', () => {
        expect(shortcutFrom(keys('®', 'KeyR', { altKey: true }))).toMatchObject({
            code: 'KeyR',
            key: 'R',
            alt: true,
        });
    });

    it('waits while only a modifier is down', () => {
        expect(shortcutFrom(keys('Shift', 'ShiftLeft', { shiftKey: true }))).toBeNull();
    });

    it.each([
        keys('Escape', 'Escape'),
        keys('Tab', 'Tab'),
        keys('Enter', 'Enter'),
        keys('c', 'KeyC', { metaKey: true }),
        keys('w', 'KeyW', { ctrlKey: true }),
    ])('refuses $key with modifiers that break the browser or typing', event => {
        expect(shortcutFrom(event)).toHaveProperty('error');
    });

    it('accepts ⌘ with a letter the browser leaves alone', () => {
        expect(shortcutFrom(keys('k', 'KeyK', { metaKey: true }))).toMatchObject({ meta: true });
    });
});

describe('matches', () => {
    it('matches on position and the exact modifiers', () => {
        const comment = DEFAULT_SHORTCUTS.comment;
        expect(matches(comment, keys('c', 'KeyC'))).toBe(true);
        expect(matches(comment, keys('C', 'KeyC', { shiftKey: true }))).toBe(false);
        expect(matches(DEFAULT_SHORTCUTS.hideDock, keys('†', 'KeyT', { altKey: true }))).toBe(true);
        expect(matches(null, keys('c', 'KeyC'))).toBe(false);
    });

    it('reads the held measure key off any event', () => {
        expect(holding('Shift', keys('', '', { shiftKey: true }))).toBe(true);
        expect(holding('Alt', keys('', '', { shiftKey: true }))).toBe(false);
        expect(holding(null, keys('', '', { altKey: true }))).toBe(false);
    });
});

describe('formatShortcut', () => {
    const shortcut = { code: 'KeyK', key: 'K', alt: true, ctrl: true, meta: false, shift: true };

    it('uses symbols on a Mac', () => {
        expect(formatShortcut(shortcut, true)).toBe('⌃⌥⇧K');
    });

    it('spells modifiers out elsewhere', () => {
        expect(formatShortcut(shortcut, false)).toBe('Ctrl+Alt+Shift+K');
    });
});
