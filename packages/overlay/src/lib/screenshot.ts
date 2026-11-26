import type { ImageAttachment } from '@tencildev/protocol';
import { domToCanvas, domToJpeg } from 'modern-screenshot';
import type { Box } from './measure.ts';

const MAX_EDGE = 1600;
const PADDING = 24;

/**
 * Renders the element (plus a little surrounding context) to a JPEG. This is
 * a DOM re-render, not a pixel grab, so cross-origin images may come out
 * blank; it's a visual hint for the agent, the source context is the truth.
 */
export async function captureElement(
    element: Element,
    host: Element,
): Promise<ImageAttachment | null> {
    // Screenshot the parent when the element is tiny so the agent sees surroundings.
    const rect = element.getBoundingClientRect();
    const target =
        rect.width * rect.height < 120 * 40 && element.parentElement
            ? element.parentElement
            : element;
    const targetRect = target.getBoundingClientRect();
    const scale = Math.min(
        window.devicePixelRatio || 1,
        MAX_EDGE / Math.max(targetRect.width + PADDING * 2, targetRect.height + PADDING * 2, 1),
    );
    try {
        const dataUrl = await domToJpeg(target, {
            scale,
            quality: 0.85,
            backgroundColor: resolveBackground(target),
            filter: node => node !== host,
            timeout: 4000,
        });
        if (!dataUrl.startsWith('data:image/jpeg')) return null;
        return { name: 'tencil-element.jpg', mimeType: 'image/jpeg', dataUrl };
    } catch (error) {
        console.warn('[tencil] screenshot failed', error);
        return null;
    }
}

/** Canvas pixels we're willing to render the holding element at, to then crop the area out of. */
const MAX_RENDER_PIXELS = 24_000_000;
const MAX_CANVAS_EDGE = 16_000;
const AREA_PADDING = 12;
/** The smallest picture of an area, in CSS pixels, so a tiny box still shows something. */
const MIN_AREA_SHOT = { width: 240, height: 120 };

/** The box plus padding, widened around its center to at least `min`. */
function grow(box: Box, padding: number, min: { width: number; height: number }): Box {
    const width = Math.max(box.right - box.left + padding * 2, min.width);
    const height = Math.max(box.bottom - box.top + padding * 2, min.height);
    const x = (box.left + box.right) / 2;
    const y = (box.top + box.bottom) / 2;
    return {
        left: x - width / 2,
        top: y - height / 2,
        right: x + width / 2,
        bottom: y + height / 2,
    };
}

function tooSmall(rect: DOMRect): boolean {
    return rect.width < MIN_AREA_SHOT.width || rect.height < MIN_AREA_SHOT.height;
}

/**
 * A dragged area: renders the element holding it (the DOM can't be rendered
 * in part), then crops to the box plus a little around it.
 */
export async function captureArea(
    element: Element,
    area: Box,
    host: Element,
): Promise<ImageAttachment | null> {
    // A small box gets some surroundings, from a parent big enough to show them.
    const wanted = grow(area, AREA_PADDING, MIN_AREA_SHOT);
    let target = element;
    while (
        target.parentElement &&
        target.parentElement !== document.documentElement &&
        tooSmall(target.getBoundingClientRect())
    ) {
        target = target.parentElement;
    }
    const rect = target.getBoundingClientRect();
    // The box can reach past the page into empty window (a short page in a tall
    // window): keep that part, painted as background, instead of cutting it off.
    const frame = {
        left: Math.max(Math.min(rect.left, 0), wanted.left),
        top: Math.max(Math.min(rect.top, 0), wanted.top),
        right: Math.min(Math.max(rect.right, window.innerWidth), wanted.right),
        bottom: Math.min(Math.max(rect.bottom, window.innerHeight), wanted.bottom),
    };
    const crop = {
        left: Math.max(rect.left, frame.left),
        top: Math.max(rect.top, frame.top),
        right: Math.min(rect.right, frame.right),
        bottom: Math.min(rect.bottom, frame.bottom),
    };
    const width = crop.right - crop.left;
    const height = crop.bottom - crop.top;
    if (width < 1 || height < 1) return null;
    const frameWidth = frame.right - frame.left;
    const frameHeight = frame.bottom - frame.top;
    const scale = Math.min(
        window.devicePixelRatio || 1,
        MAX_EDGE / Math.max(frameWidth, frameHeight),
        Math.sqrt(MAX_RENDER_PIXELS / Math.max(1, rect.width * rect.height)),
        MAX_CANVAS_EDGE / Math.max(rect.width, rect.height, 1),
    );
    try {
        const background = resolveBackground(target);
        const canvas = await domToCanvas(target, {
            scale,
            backgroundColor: background,
            filter: node => node !== host,
            timeout: 8000,
        });
        // The canvas can round differently than `scale`; measure from it.
        const ratio = canvas.width / Math.max(1, rect.width);
        const out = document.createElement('canvas');
        out.width = Math.max(1, Math.round(frameWidth * ratio));
        out.height = Math.max(1, Math.round(frameHeight * ratio));
        const context = out.getContext('2d');
        if (!context) return null;
        context.fillStyle = background;
        context.fillRect(0, 0, out.width, out.height);
        context.drawImage(
            canvas,
            (crop.left - rect.left) * ratio,
            (crop.top - rect.top) * ratio,
            width * ratio,
            height * ratio,
            (crop.left - frame.left) * ratio,
            (crop.top - frame.top) * ratio,
            width * ratio,
            height * ratio,
        );
        const dataUrl = out.toDataURL('image/jpeg', 0.85);
        if (!dataUrl.startsWith('data:image/jpeg')) return null;
        return { name: 'tencil-area.jpg', mimeType: 'image/jpeg', dataUrl };
    } catch (error) {
        console.warn('[tencil] area screenshot failed', error);
        return null;
    }
}

/** Transparent elements render on black otherwise; walk up to the first painted ancestor. */
function resolveBackground(element: Element): string {
    let node: Element | null = element;
    while (node) {
        const color = getComputedStyle(node).backgroundColor;
        if (color && color !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(color)) return color;
        node = node.parentElement;
    }
    return '#ffffff';
}
