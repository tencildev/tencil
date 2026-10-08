import type { ImageAttachment } from '@fixhere/protocol';
import { domToJpeg } from 'modern-screenshot';

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
        return { name: 'fixhere-element.jpg', mimeType: 'image/jpeg', dataUrl };
    } catch (error) {
        console.warn('[fixhere] screenshot failed', error);
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
