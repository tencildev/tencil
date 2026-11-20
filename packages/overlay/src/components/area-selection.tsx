import type { Box } from '../lib/measure.ts';
import { draft, layoutTick, marquee } from '../lib/state.ts';
import { boxStyle } from './highlight.tsx';

/** The box being dragged while picking, then again while its comment is open. */
export function AreaSelection() {
    layoutTick.value;
    const dragging = marquee.value;
    if (dragging) return <div class="area-box" style={boxStyle(dragging)} />;
    const pending = draft.value;
    if (!pending?.area || !pending.element.isConnected) return null;
    const area = areaBox(pending.element, pending.area.offset);
    return <div class="area-box" style={boxStyle(area)} />;
}

/** The dragged box now, from where it sat relative to its element. */
export function areaBox(element: Element, offset: Box): Box {
    const rect = element.getBoundingClientRect();
    return {
        left: rect.left + offset.left,
        top: rect.top + offset.top,
        right: rect.left + offset.right,
        bottom: rect.top + offset.bottom,
    };
}
