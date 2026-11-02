import { computed, effect, signal } from '@preact/signals';
import { preferences, send } from './connection.ts';

/** A key combination, matched by key position (`code`) so it works on any layout. */
export interface Shortcut {
    code: string;
    /** What the layout prints for it, for labels: `C`, `/`, `Q` on AZERTY's A key. */
    key: string;
    alt: boolean;
    ctrl: boolean;
    meta: boolean;
    shift: boolean;
}

/** Measuring is held, not pressed: one modifier. */
export type Modifier = 'Alt' | 'Control' | 'Meta' | 'Shift';

export type PressAction = 'comment' | 'ruler' | 'hidePins' | 'hideDock';

export interface Shortcuts {
    comment: Shortcut | null;
    ruler: Shortcut | null;
    hidePins: Shortcut | null;
    /** Never cleared: it's the only way back to a hidden dock. */
    hideDock: Shortcut;
    measure: Modifier | null;
}

/** The subset of a `KeyboardEvent` (or `MouseEvent`, for modifiers) we read. */
export interface KeyState {
    key?: string;
    code?: string;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
}

const STORAGE_KEY = 'tencil:shortcuts';
const MODIFIERS: Modifier[] = ['Alt', 'Control', 'Meta', 'Shift'];
/** Copy, paste, cut, select all, undo, reload, address bar, new and close tab. */
const BROWSER_KEYS = new Set([
    'KeyC',
    'KeyV',
    'KeyX',
    'KeyA',
    'KeyZ',
    'KeyR',
    'KeyL',
    'KeyT',
    'KeyW',
]);

const press = (code: string, key: string, modifiers: Partial<Shortcut> = {}): Shortcut => ({
    code,
    key,
    alt: false,
    ctrl: false,
    meta: false,
    shift: false,
    ...modifiers,
});

export const DEFAULT_SHORTCUTS: Shortcuts = {
    comment: press('KeyC', 'C'),
    ruler: press('KeyR', 'R'),
    // New, so off until someone picks a key: bare letters clash with pages.
    hidePins: null,
    hideDock: press('KeyT', 'T', { alt: true }),
    measure: 'Alt',
};

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * The configured shortcuts. Saved by the daemon for every project on this
 * machine; the browser keeps a copy for the first frame and Tencil Cloud.
 */
export const shortcuts = signal<Shortcuts>(readShortcuts());
/** A shortcut is being recorded: the page's shortcuts are off so the keys reach the recorder. */
export const recording = signal(false);

export function setShortcuts(next: Shortcuts): void {
    apply(next);
    send({ type: 'preferences.update', preferences: { shortcuts: next } });
}

export function resetShortcuts(): void {
    setShortcuts(DEFAULT_SHORTCUTS);
}

// The daemon's shortcuts win. Without any yet, this browser's become the machine's.
effect(() => {
    const saved = preferences.value;
    if (!saved) return;
    if (saved.shortcuts) {
        if (!sameShortcuts(saved.shortcuts, shortcuts.peek())) apply(saved.shortcuts);
    } else if (storedShortcuts() !== null) {
        send({ type: 'preferences.update', preferences: { shortcuts: shortcuts.peek() } });
    }
});

function apply(next: Shortcuts): void {
    shortcuts.value = next;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
        // Storage can be blocked; the shortcuts just won't persist.
    }
}

function storedShortcuts(): string | null {
    try {
        return localStorage.getItem(STORAGE_KEY);
    } catch {
        return null;
    }
}

export function matches(shortcut: Shortcut | null, event: KeyState): boolean {
    return (
        shortcut !== null &&
        event.code === shortcut.code &&
        event.altKey === shortcut.alt &&
        event.ctrlKey === shortcut.ctrl &&
        event.metaKey === shortcut.meta &&
        event.shiftKey === shortcut.shift
    );
}

/** The measure modifier is held in this event. */
export function holding(modifier: Modifier | null, event: KeyState): boolean {
    switch (modifier) {
        case 'Alt':
            return event.altKey;
        case 'Control':
            return event.ctrlKey;
        case 'Meta':
            return event.metaKey;
        case 'Shift':
            return event.shiftKey;
        default:
            return false;
    }
}

export function isModifier(key: string | undefined): key is Modifier {
    return MODIFIERS.includes(key as Modifier);
}

/** `⌥⇧C` on a Mac, `Alt+Shift+C` elsewhere. */
export function formatShortcut(shortcut: Shortcut, mac = isMac): string {
    if (mac) {
        return `${shortcut.ctrl ? '⌃' : ''}${shortcut.alt ? '⌥' : ''}${shortcut.shift ? '⇧' : ''}${shortcut.meta ? '⌘' : ''}${shortcut.key}`;
    }
    const parts = [
        shortcut.ctrl && 'Ctrl',
        shortcut.alt && 'Alt',
        shortcut.shift && 'Shift',
        shortcut.meta && 'Win',
        shortcut.key,
    ];
    return parts.filter(Boolean).join('+');
}

export function formatModifier(modifier: Modifier, mac = isMac): string {
    if (mac) {
        return { Alt: '⌥ Option', Control: '⌃ Control', Meta: '⌘ Command', Shift: '⇧ Shift' }[
            modifier
        ];
    }
    return { Alt: 'Alt', Control: 'Ctrl', Meta: 'Win', Shift: 'Shift' }[modifier];
}

/** Labels for hints and tooltips; `null` when the shortcut is cleared. */
export const labels = computed(() => {
    const current = shortcuts.value;
    const label = (shortcut: Shortcut | null) => (shortcut ? formatShortcut(shortcut) : null);
    return {
        comment: label(current.comment),
        ruler: label(current.ruler),
        hidePins: label(current.hidePins),
        hideDock: formatShortcut(current.hideDock),
        measure: current.measure ? formatModifier(current.measure) : null,
    };
});

/**
 * A pressed combination as a shortcut, or why it can't be one. Modifier-only
 * presses return `null`: the recorder waits for the rest.
 */
export function shortcutFrom(event: KeyState): Shortcut | { error: string } | null {
    const { key = '', code = '' } = event;
    if (isModifier(key)) return null;
    if (key === 'Escape' || key === 'Tab' || key === 'Enter') {
        return { error: `${key} is kept for leaving fields and dialogs.` };
    }
    if ((event.ctrlKey || event.metaKey) && BROWSER_KEYS.has(code)) {
        return { error: 'The browser or the page already uses that one.' };
    }
    return {
        code,
        key: printable(key, code, event.altKey),
        alt: event.altKey,
        ctrl: event.ctrlKey,
        meta: event.metaKey,
        shift: event.shiftKey,
    };
}

/** ⌥ on a Mac turns R into ®: name letters and digits by position then, by the layout otherwise. */
function printable(key: string, code: string, alt: boolean): string {
    if (key.length === 1 && key !== ' ' && !alt) return key.toUpperCase();
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    if (code === 'Space') return 'Space';
    return key.length === 1 ? key.toUpperCase() : key;
}

export function sameShortcut(a: Shortcut | null, b: Shortcut | null): boolean {
    return (
        a !== null &&
        b !== null &&
        a.code === b.code &&
        a.alt === b.alt &&
        a.ctrl === b.ctrl &&
        a.meta === b.meta &&
        a.shift === b.shift
    );
}

export function sameShortcuts(a: Shortcuts, b: Shortcuts): boolean {
    const same = (x: Shortcut | null, y: Shortcut | null) =>
        x === y || (sameShortcut(x, y) && x?.key === y?.key);
    return (
        a.measure === b.measure &&
        same(a.comment, b.comment) &&
        same(a.ruler, b.ruler) &&
        same(a.hidePins, b.hidePins) &&
        same(a.hideDock, b.hideDock)
    );
}

function readShortcuts(): Shortcuts {
    try {
        const stored = JSON.parse(
            localStorage.getItem(STORAGE_KEY) ?? 'null',
        ) as Partial<Shortcuts> | null;
        if (!stored || typeof stored !== 'object') return DEFAULT_SHORTCUTS;
        const valid = (value: unknown): value is Shortcut | null =>
            value === null ||
            (typeof value === 'object' &&
                typeof (value as Shortcut).code === 'string' &&
                typeof (value as Shortcut).key === 'string');
        return {
            comment: valid(stored.comment) ? stored.comment : DEFAULT_SHORTCUTS.comment,
            ruler: valid(stored.ruler) ? stored.ruler : DEFAULT_SHORTCUTS.ruler,
            hidePins: valid(stored.hidePins) ? stored.hidePins : DEFAULT_SHORTCUTS.hidePins,
            hideDock:
                stored.hideDock && valid(stored.hideDock)
                    ? stored.hideDock
                    : DEFAULT_SHORTCUTS.hideDock,
            measure:
                stored.measure === null || isModifier(stored.measure ?? undefined)
                    ? (stored.measure ?? null)
                    : DEFAULT_SHORTCUTS.measure,
        };
    } catch {
        return DEFAULT_SHORTCUTS;
    }
}
