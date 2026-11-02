import type { BoxModel, Sides, Spacing } from '@tencildev/protocol';
import type { Point } from './position.ts';

/** A rectangle by its edges, in viewport CSS pixels. */
export interface Box {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

export type Side = 'top' | 'right' | 'bottom' | 'left';

export const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];

/** One measured distance, drawn as a line with its value. */
export interface Guide {
    /** The side of the measured element the distance is on. */
    side: Side;
    value: number;
    from: Point;
    to: Point;
    /** Dashed projection of the other element's edge, when the line misses that element. */
    extension?: { from: Point; to: Point };
}

export function boxOf(rect: { left: number; top: number; right: number; bottom: number }): Box {
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
}

/** Whole pixels, keeping one decimal for fractional layouts (`0.5`). */
export function roundPx(value: number): number {
    return Math.round(value * 10) / 10;
}

/**
 * The distances from `a` to `b`, Figma style. Apart on an axis: the gap
 * between them on that axis. Nested or overlapping: the distance between each
 * pair of matching edges.
 */
export function measureBetween(a: Box, b: Box): Guide[] {
    const apartX = b.right <= a.left || b.left >= a.right;
    const apartY = b.bottom <= a.top || b.top >= a.bottom;
    const x = overlapCenter(a.left, a.right, b.left, b.right);
    const y = overlapCenter(a.top, a.bottom, b.top, b.bottom);
    const guides: Guide[] = [];

    if (apartX || apartY) {
        if (b.bottom <= a.top) {
            guides.push(vertical('top', x, b.bottom, a.top, b));
        } else if (b.top >= a.bottom) {
            guides.push(vertical('bottom', x, a.bottom, b.top, b));
        }
        if (b.right <= a.left) {
            guides.push(horizontal('left', y, b.right, a.left, b));
        } else if (b.left >= a.right) {
            guides.push(horizontal('right', y, a.right, b.left, b));
        }
        return guides;
    }

    const edges: Array<[Side, number, number]> = [
        ['top', a.top, b.top],
        ['right', a.right, b.right],
        ['bottom', a.bottom, b.bottom],
        ['left', a.left, b.left],
    ];
    for (const [side, own, other] of edges) {
        const value = roundPx(Math.abs(own - other));
        if (value === 0) continue;
        const [start, end] = own < other ? [own, other] : [other, own];
        guides.push(
            side === 'top' || side === 'bottom'
                ? { side, value, from: { x, y: start }, to: { x, y: end } }
                : { side, value, from: { x: start, y }, to: { x: end, y } },
        );
    }
    return guides;
}

/** Guides as the spacing that goes into the pin's context. */
export function toSpacing(guides: Guide[], other: Omit<Spacing, Side>): Spacing {
    const spacing: Spacing = { ...other };
    for (const guide of guides) spacing[guide.side] = guide.value;
    return spacing;
}

function vertical(side: Side, x: number, start: number, end: number, other: Box): Guide {
    const guide: Guide = {
        side,
        value: roundPx(end - start),
        from: { x, y: start },
        to: { x, y: end },
    };
    if (x < other.left || x > other.right) {
        const edgeY = side === 'top' ? other.bottom : other.top;
        const edgeX = x < other.left ? other.left : other.right;
        guide.extension = { from: { x: edgeX, y: edgeY }, to: { x, y: edgeY } };
    }
    return guide;
}

function horizontal(side: Side, y: number, start: number, end: number, other: Box): Guide {
    const guide: Guide = {
        side,
        value: roundPx(end - start),
        from: { x: start, y },
        to: { x: end, y },
    };
    if (y < other.top || y > other.bottom) {
        const edgeX = side === 'left' ? other.right : other.left;
        const edgeY = y < other.top ? other.top : other.bottom;
        guide.extension = { from: { x: edgeX, y: edgeY }, to: { x: edgeX, y } };
    }
    return guide;
}

/** Middle of where two ranges overlap, or of the first range when they don't. */
function overlapCenter(start: number, end: number, otherStart: number, otherEnd: number): number {
    const from = Math.max(start, otherStart);
    const to = Math.min(end, otherEnd);
    return from <= to ? (from + to) / 2 : (start + end) / 2;
}

/* -------------------------------- box model -------------------------------- */

export function boxModel(element: Element): BoxModel {
    const style = getComputedStyle(element);
    const sides = (property: (side: Side) => string): Sides =>
        SIDES.map(side => roundPx(px(style.getPropertyValue(property(side))))) as Sides;
    const model: BoxModel = {
        margin: sides(side => `margin-${side}`),
        padding: sides(side => `padding-${side}`),
        border: sides(side => `border-${side}-width`),
    };
    if (/flex|grid/.test(style.display)) {
        const row = roundPx(px(style.rowGap));
        const column = roundPx(px(style.columnGap));
        if (row > 0 || column > 0) model.gap = { row, column };
    }
    return model;
}

/** The space between a flex or grid container's children, at most one per neighbour. */
export function gapBoxes(
    element: Element,
    gap: NonNullable<BoxModel['gap']>,
    content: Box,
): Array<Box & { axis: 'row' | 'column' }> {
    const children = [...element.children]
        .slice(0, 100)
        .map(child => child.getBoundingClientRect())
        .filter(rect => rect.width > 0 || rect.height > 0);
    const boxes: Array<Box & { axis: 'row' | 'column' }> = [];
    for (let index = 1; index < children.length; index++) {
        const previous = children[index - 1]!;
        const next = children[index]!;
        if (gap.column > 0 && next.left >= previous.right - 0.5 && next.top < previous.bottom) {
            boxes.push({
                axis: 'column',
                left: previous.right,
                right: next.left,
                top: Math.max(previous.top, next.top),
                bottom: Math.min(previous.bottom, next.bottom),
            });
        } else if (gap.row > 0 && next.top >= previous.bottom - 0.5) {
            boxes.push({
                axis: 'row',
                left: content.left,
                right: content.right,
                top: previous.bottom,
                bottom: next.top,
            });
        }
    }
    return boxes.filter(box => box.right - box.left > 0.5 && box.bottom - box.top > 0.5);
}

function px(value: string): number {
    const number = Number.parseFloat(value);
    return Number.isFinite(number) ? number : 0;
}

/* ------------------------------ utility classes ------------------------------ */

type Spaced = 'padding' | 'margin';

const SIDE_LETTER: Record<Side, string> = { top: 't', right: 'r', bottom: 'b', left: 'l' };
const SIDE_AXIS: Record<Side, string> = { top: 'y', right: 'x', bottom: 'y', left: 'x' };

/**
 * The Tailwind class that sets this value (`pt-4`, `gap-x-2`), when the element
 * has one without a variant and it really is what the browser computed.
 */
export function spacingClass(
    element: Element,
    property: Spaced | 'gap',
    side: Side | 'row' | 'column',
    value: number,
): string | undefined {
    const classes = new Set(element.classList);
    const candidates =
        property === 'gap'
            ? [`gap-${side === 'row' ? 'y' : 'x'}`, 'gap']
            : [
                  `${property[0]}${SIDE_LETTER[side as Side]}`,
                  `${property[0]}${SIDE_AXIS[side as Side]}`,
                  property[0]!,
              ];
    for (const prefix of candidates) {
        const found = [...classes].find(name => name.startsWith(`${prefix}-`));
        if (!found) continue;
        const size = utilitySize(found.slice(prefix.length + 1));
        return size !== undefined && Math.abs(size - value) < 0.5 ? found : undefined;
    }
    return undefined;
}

/** Tailwind's spacing scale: `4` is 1rem, `px` is 1px, `[18px]` is arbitrary. */
function utilitySize(token: string): number | undefined {
    if (token === 'px') return 1;
    const arbitrary = token.match(/^\[(-?[\d.]+)(px|rem)\]$/);
    if (arbitrary) return Number(arbitrary[1]) * (arbitrary[2] === 'rem' ? rootFontSize() : 1);
    if (/^\d+(?:\.\d+)?$/.test(token)) return Number(token) * 0.25 * rootFontSize();
    return undefined;
}

function rootFontSize(): number {
    return px(getComputedStyle(document.documentElement).fontSize) || 16;
}
