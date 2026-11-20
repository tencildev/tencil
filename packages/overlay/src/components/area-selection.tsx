import type { Box } from '../lib/measure.ts';
import { draft, layoutTick, marquee } from '../lib/state.ts';
import { boxStyle } from './highlight.tsx';

/**
 * The box being dragged while picking, then, while its comment is open, the
 * box again with the elements it caught outlined.
 */
export function AreaSelection() {
    layoutTick.value;
    const dragging = marquee.value;
    if (dragging) return <div class="area-box" style={boxStyle(dragging)} />;
    const pending = draft.value;
    if (!pending?.area || !pending.element.isConnected) return null;
    const area = areaBox(pending.element, pending.area.fractions);
    return (
        <>
            {pending.area.parts
                .filter(part => part.isConnected)
                .map((part, index) => (
                    <div key={`part-${index}`} class="area-part" style={boxStyle(boxOf(part))} />
                ))}
            <div class="area-box" style={boxStyle(area)} />
        </>
    );
}

/** The dragged box now, from where it sat inside its element. */
export function areaBox(element: Element, fractions: Box): Box {
    const rect = element.getBoundingClientRect();
    return {
        left: rect.left + rect.width * fractions.left,
        top: rect.top + rect.height * fractions.top,
        right: rect.left + rect.width * fractions.right,
        bottom: rect.top + rect.height * fractions.bottom,
    };
}

function boxOf(element: Element): Box {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
}
