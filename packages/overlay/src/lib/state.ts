import { computed, signal } from '@preact/signals';
import type { Anchor, ElementContext } from '@tencildev/protocol';
import { pinBlocked } from './cloud-auth.ts';
import { send, settings, threads } from './connection.ts';
import type { Point } from './position.ts';

export type Mode = 'idle' | 'picking';

export interface Draft {
    element: Element;
    anchor: Anchor;
    /** Component name or tag, available synchronously for the composer chip. */
    label: string;
    /** Source maps are fetched lazily, so the full context resolves later. */
    context: Promise<ElementContext>;
    /** Measured against with Alt: the pin's context gets the spacing to it. */
    measuredTo?: { element: Element; label: string; parent: boolean };
}

export const mode = signal<Mode>('idle');
export const hovered = signal<Element | null>(null);
/** Alt is held: hovering measures distances instead of showing the box model. */
export const measuring = signal(false);
/**
 * The ruler outside comment mode: Alt-click selects an element to measure
 * from, and `C` comments on it. `offsets` is where it was clicked, for the pin.
 */
export const rulerAnchor = signal<{
    element: Element;
    offsets: Pick<Anchor, 'offsetX' | 'offsetY'>;
} | null>(null);
export const draft = signal<Draft | null>(null);
export const openThreadId = signal<string | null>(null);
export const inboxOpen = signal(false);
export const settingsOpen = signal(false);
export type SettingsSection =
    | 'overview'
    | 'agent'
    | 'tools'
    | 'appearance'
    | 'shortcuts'
    | 'dock'
    | 'account'
    | 'about';
/** The settings page last looked at; settings reopen on it. */
export const settingsSection = signal<SettingsSection>('overview');
export const showResolved = signal(false);
export const hidden = signal(false);
/** The project allows batching: the comment box then offers a batch toggle. */
export const batchAvailable = computed(() => settings.value?.batch ?? false);
/** The comment box's batch toggle. Sticky across comments. */
export const batchToggle = signal(false);
/** New comments are queued as drafts and sent together (`sendQueued`). */
export const batchMode = computed(() => batchAvailable.value && batchToggle.value);

export function setBatchAvailable(on: boolean): void {
    const current = settings.value;
    if (!current || !send({ type: 'settings.update', batch: on })) return;
    // Flip right away; the daemon's settings broadcast confirms it.
    settings.value = { ...current, batch: on };
}

const RULER_KEY = 'tencil:ruler';
const DOCK_HIDDEN_KEY = 'tencil:dock-hidden';

/**
 * Tencil is hidden on this site: no toolbar, pins or panels, and no shortcuts
 * but the hide-the-dock one, which brings it back. Remembered per browser.
 */
export const dockHidden = signal(readSwitch(DOCK_HIDDEN_KEY));
/** When the dock was just hidden, to say briefly how to bring it back. */
export const dockHiddenAt = signal(0);

export function setDockHidden(on: boolean): void {
    dockHidden.value = on;
    dockHiddenAt.value = on ? Date.now() : 0;
    writeSwitch(DOCK_HIDDEN_KEY, on);
    if (!on) return;
    stopPicking();
    draft.value = null;
    rulerAnchor.value = null;
    openThreadId.value = null;
    inboxOpen.value = false;
    settingsOpen.value = false;
}

/** The project offers the ruler: the toolbar then has a ruler toggle. */
export const rulerAvailable = computed(() => {
    const current = settings.value;
    // A bridge from before the setting leaves it out: offer the ruler.
    return current !== null && current.ruler !== false;
});
/** The toolbar's ruler toggle. Remembered per browser, off until turned on. */
export const rulerToggle = signal(readSwitch(RULER_KEY));
/** Picking shows the box model, and Alt measures distances. */
export const rulerOn = computed(
    () => rulerAvailable.value && rulerToggle.value && !dockHidden.value,
);

export function setRulerAvailable(on: boolean): void {
    const current = settings.value;
    if (!current || !send({ type: 'settings.update', ruler: on })) return;
    settings.value = { ...current, ruler: on };
}

export function toggleRuler(): void {
    rulerToggle.value = !rulerToggle.value;
    rulerAnchor.value = null;
    writeSwitch(RULER_KEY, rulerToggle.value);
}

function readSwitch(key: string): boolean {
    try {
        return localStorage.getItem(key) === 'on';
    } catch {
        return false;
    }
}

function writeSwitch(key: string, on: boolean): void {
    try {
        localStorage.setItem(key, on ? 'on' : 'off');
    } catch {
        // Storage can be blocked; the choice just won't persist.
    }
}
/** A pin being dragged: where its tip is now, so its open thread can follow. */
export const pinDrag = signal<{ threadId: string; point: Point } | null>(null);

/** Bumped on scroll/resize/mutations so anchored UI re-measures. */
export const layoutTick = signal(0);

/** SPA-aware current page, compared without hash/query noise. */
export const currentPage = signal(pageKey(location.href));

export function pageKey(url: string): string {
    try {
        const parsed = new URL(url);
        return `${parsed.origin}${parsed.pathname.replace(/\/$/, '') || '/'}`;
    } catch {
        return url;
    }
}

export const sortedThreads = computed(() =>
    [...threads.value.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
);

export const pageThreads = computed(() =>
    sortedThreads.value
        .filter(
            thread =>
                thread.anchor && thread.pageUrl && pageKey(thread.pageUrl) === currentPage.value,
        )
        .filter(thread => showResolved.value || !thread.resolved)
        .reverse(),
);

export const unresolvedCount = computed(
    () => sortedThreads.value.filter(thread => !thread.resolved).length,
);

/** Queued comments, oldest first: the order they're numbered and sent in. */
export const queuedThreads = computed(() =>
    [...sortedThreads.value].reverse().filter(thread => thread.status === 'draft'),
);

export const activeCount = computed(
    () =>
        sortedThreads.value.filter(
            thread => thread.status === 'working' || thread.status === 'starting',
        ).length,
);

export function startPicking(): void {
    if (pinBlocked.value) return;
    draft.value = null;
    rulerAnchor.value = null;
    openThreadId.value = null;
    mode.value = 'picking';
}

export function stopPicking(): void {
    mode.value = 'idle';
    hovered.value = null;
}
