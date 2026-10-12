import type { Anchor } from '@tencildev/protocol';

export interface Point {
    x: number;
    y: number;
}

const cache = new Map<string, WeakRef<Element>>();

/** Viewport position of an anchor, or null when its element is gone/hidden. */
export function resolveAnchor(anchor: Anchor, element?: Element): Point | null {
    const target = element ?? findElement(anchor.selector);
    if (!target?.isConnected) return null;
    const rect = target.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;
    return {
        x: rect.left + rect.width * anchor.offsetX,
        y: rect.top + rect.height * anchor.offsetY,
    };
}

/** Where a viewport point sits inside an element, as an anchor's 0..1 offsets. */
export function offsetsIn(element: Element, point: Point): Pick<Anchor, 'offsetX' | 'offsetY'> {
    const rect = element.getBoundingClientRect();
    const offset = (value: number, size: number) => (size > 0 ? clamp(value / size, 0, 1) : 0.5);
    return {
        offsetX: offset(point.x - rect.left, rect.width),
        offsetY: offset(point.y - rect.top, rect.height),
    };
}

function findElement(selector: string): Element | null {
    if (!selector) return null;
    const cached = cache.get(selector)?.deref();
    if (cached?.isConnected && cached.matches(selector)) return cached;
    try {
        const found = document.querySelector(selector);
        if (found) cache.set(selector, new WeakRef(found));
        return found;
    } catch {
        return null;
    }
}

/** Place a popover beside a point, flipping and clamping to stay on screen. */
export function popoverPosition(
    point: Point,
    size: { width: number; height: number },
    gap = 16,
): { left: number; top: number; origin: string } {
    const margin = 12;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    let left = point.x + gap;
    if (left + size.width > viewportWidth - margin) left = point.x - gap - size.width;
    left = clamp(left, margin, viewportWidth - size.width - margin);
    const top = clamp(point.y - 24, margin, viewportHeight - size.height - margin);
    // Grow out of the pin rather than the popover's center.
    const origin = `${clamp(point.x - left, 0, size.width)}px ${clamp(point.y - top, 0, size.height)}px`;
    return { left, top, origin };
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}
