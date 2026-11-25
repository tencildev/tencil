import { useEffect, useState } from 'preact/hooks';
import { keepOnScreen } from './position.ts';

/** Pointer travel before pressing a header counts as a drag instead of a click. */
const DRAG_THRESHOLD = 4;

/** Presses on these start their own action, not a drag. */
const INTERACTIVE = 'button, a, input, textarea, select, [contenteditable]';

interface Moved {
    key: unknown;
    left: number;
    top: number;
}

/**
 * Let a popover be dragged by its header, away from its pin. The new spot holds
 * until the popover closes or shows something else (`key` changes); a double
 * click on the header puts it back beside the pin.
 */
export function usePopoverDrag(key: unknown) {
    const [moved, setMoved] = useState<Moved | null>(null);
    const [dragging, setDragging] = useState(false);
    // Closing forgets the spot, also when the same popover opens again.
    useEffect(() => {
        if (key == null) setMoved(null);
    }, [key]);
    const current = moved && moved.key === key ? moved : null;

    /** Where the popover goes: dragged somewhere (kept on screen), or `placed` beside its pin. */
    const place = <T extends { left: number; top: number }>(
        placed: T,
        size: { width: number; height: number },
    ): T => (current ? { ...placed, ...keepOnScreen(current, size) } : placed);

    const headerProps = (
        from: { left: number; top: number },
        size: { width: number; height: number },
    ) => ({
        onPointerDown: (event: PointerEvent) => {
            if (event.button !== 0) return;
            if ((event.target as Element).closest(INTERACTIVE)) return;
            // Keep the browser from selecting text or dragging an image along.
            event.preventDefault();
            const header = event.currentTarget as HTMLElement;
            try {
                header.setPointerCapture(event.pointerId);
            } catch {
                // Synthetic or already-released pointers can't be captured; dragging still works.
            }
            const startX = event.clientX;
            const startY = event.clientY;
            let started = false;

            const move = (moveEvent: PointerEvent) => {
                const dx = moveEvent.clientX - startX;
                const dy = moveEvent.clientY - startY;
                if (!started && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
                if (!started) setDragging(true);
                started = true;
                setMoved({
                    key,
                    ...keepOnScreen({ left: from.left + dx, top: from.top + dy }, size),
                });
            };
            const end = () => {
                header.removeEventListener('pointermove', move);
                header.removeEventListener('pointerup', end);
                header.removeEventListener('pointercancel', end);
                header.removeEventListener('lostpointercapture', end);
                setDragging(false);
            };
            header.addEventListener('pointermove', move);
            header.addEventListener('pointerup', end);
            header.addEventListener('pointercancel', end);
            header.addEventListener('lostpointercapture', end);
        },
        onDblClick: (event: MouseEvent) => {
            if ((event.target as Element).closest(INTERACTIVE)) return;
            setMoved(null);
        },
        title: current ? 'Double-click to put it back' : undefined,
    });

    return { place, headerProps, dragging };
}
