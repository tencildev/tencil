import { signal } from '@preact/signals';
import { type Dock, nearestDock } from './dock.ts';

export interface Box {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

/** Where Next.js's dev tools button is, or null on pages without one. */
export const nextIndicator = signal<Box | null>(null);

/** The gap kept between the toolbar and the Next.js button. */
const GAP = 8;
/** It moves (corner setting, drag) and grows (issue count) without events we can hook. */
const POLL_MS = 500;

/**
 * Follow Next.js's dev tools button (`<nextjs-portal>`, open shadow root) so
 * the toolbar can sit beside it instead of underneath when they share a corner.
 */
export function watchNextIndicator(): () => void {
    const measure = () => {
        const next = indicatorBox();
        const current = nextIndicator.value;
        if (!sameBox(next, current)) nextIndicator.value = next;
    };
    measure();
    const timer = setInterval(measure, POLL_MS);
    window.addEventListener('resize', measure, { passive: true });
    return () => {
        clearInterval(timer);
        window.removeEventListener('resize', measure);
    };
}

/** Inline offsets that move a toolbar in the button's corner to its inner side. */
export function besideIndicator(dock: Dock, box: Box | null): Record<string, string> {
    if (!box || dock.endsWith('center')) return {};
    const corner = nearestDock(
        (box.left + box.right) / 2,
        (box.top + box.bottom) / 2,
        window.innerWidth,
        window.innerHeight,
    );
    if (corner !== dock) return {};
    return dock.endsWith('left')
        ? { left: `${box.right + GAP}px` }
        : { right: `${window.innerWidth - box.left + GAP}px` };
}

function indicatorBox(): Box | null {
    for (const portal of document.querySelectorAll('nextjs-portal')) {
        const indicator = portal.shadowRoot?.getElementById('devtools-indicator');
        if (!indicator) continue;
        const rect = indicator.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    }
    return null;
}

function sameBox(a: Box | null, b: Box | null): boolean {
    if (!a || !b) return a === b;
    return (
        Math.round(a.left) === Math.round(b.left) &&
        Math.round(a.top) === Math.round(b.top) &&
        Math.round(a.right) === Math.round(b.right) &&
        Math.round(a.bottom) === Math.round(b.bottom)
    );
}
