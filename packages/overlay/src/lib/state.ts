import { computed, signal } from '@preact/signals';
import type { Anchor, ElementContext } from '@tencil/protocol';
import { send, settings, threads } from './connection.ts';

export type Mode = 'idle' | 'picking';

export interface Draft {
    element: Element;
    anchor: Anchor;
    /** Component name or tag, available synchronously for the composer chip. */
    label: string;
    /** Source maps are fetched lazily, so the full context resolves later. */
    context: Promise<ElementContext>;
}

export const mode = signal<Mode>('idle');
export const hovered = signal<Element | null>(null);
export const draft = signal<Draft | null>(null);
export const openThreadId = signal<string | null>(null);
export const inboxOpen = signal(false);
export const settingsOpen = signal(false);
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
    draft.value = null;
    openThreadId.value = null;
    mode.value = 'picking';
}

export function stopPicking(): void {
    mode.value = 'idle';
    hovered.value = null;
}
