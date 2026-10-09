import { computed } from '@preact/signals';
import type { Thread } from '@tencil/protocol';
import { send, upsertLocal } from '../lib/connection.ts';
import { buildSelector } from '../lib/element-context.ts';
import { getHost } from '../lib/overlay-host.ts';
import { offsetsIn, type Point, resolveAnchor } from '../lib/position.ts';
import {
    draft,
    hidden,
    layoutTick,
    openThreadId,
    pageThreads,
    pinDrag,
    queuedThreads,
    sortedThreads,
} from '../lib/state.ts';

/** Stable pin numbers: oldest pin is #1, across all pages. */
export const pinNumbers = computed(() => {
    const numbers = new Map<string, number>();
    const ordered = [...sortedThreads.value].reverse().filter(thread => thread.anchor);
    for (const [index, thread] of ordered.entries()) numbers.set(thread.id, index + 1);
    return numbers;
});

/** Send every queued comment to the agent as one thread, numbered like their pins. */
export function sendQueued(): void {
    const drafts = queuedThreads.value.flatMap(thread => {
        const number = pinNumbers.value.get(thread.id);
        return number ? [{ threadId: thread.id, number }] : [];
    });
    if (drafts.length === 0) return;
    if (!send({ type: 'drafts.send', drafts })) return;
    // The shared conversation opens on the first comment's pin.
    openThreadId.value = drafts[0]?.threadId ?? null;
}

export function Pins() {
    if (hidden.value) return null;
    const pending = draft.value;
    return (
        <>
            {pageThreads.value.map(thread => (
                <Pin key={thread.id} thread={thread} />
            ))}
            {pending && <DraftPin />}
        </>
    );
}

function Pin({ thread }: { thread: Thread }) {
    // Each pin subscribes itself: signals skip re-rendering children whose props didn't change.
    layoutTick.value;
    if (!thread.anchor) return null;
    const drag = pinDrag.value;
    const dragging = drag?.threadId === thread.id;
    const point = dragging ? drag.point : resolveAnchor(thread.anchor);
    if (!point) return null;
    const open = openThreadId.value === thread.id;
    return (
        <button
            type="button"
            class={`pin pin-${pinVariant(thread)}${open ? ' pin-open' : ''}${dragging ? ' pin-dragging' : ''}`}
            style={{ transform: `translate(${point.x}px, ${point.y}px)` }}
            title={thread.title}
            onPointerDown={event => startPinDrag(event, thread, point)}
            onClick={() => {
                if (draggedPin === thread.id) {
                    draggedPin = null;
                    return;
                }
                draft.value = null;
                openThreadId.value = open ? null : thread.id;
            }}
        >
            <span class="pin-body">{pinNumbers.value.get(thread.id) ?? '•'}</span>
        </button>
    );
}

/** Pointer travel before pressing a pin counts as a drag instead of a click. */
const DRAG_THRESHOLD = 4;
/** The pin whose drag just ended, so the click that follows doesn't toggle it. */
let draggedPin: string | null = null;

/**
 * Drag a pin by its body: the tip keeps its distance to the pointer, and on
 * release the pin re-anchors to the page element under its tip.
 */
function startPinDrag(event: PointerEvent, thread: Thread, tip: Point): void {
    if (event.button !== 0) return;
    // Otherwise the browser may start its own drag of a link or image under the pin
    // and cancel this pointer halfway. The click still fires.
    event.preventDefault();
    const pin = event.currentTarget as HTMLElement;
    try {
        pin.setPointerCapture(event.pointerId);
    } catch {
        // Synthetic or already-released pointers can't be captured; dragging still works.
    }
    draggedPin = null;
    const startX = event.clientX;
    const startY = event.clientY;

    const move = (moveEvent: PointerEvent) => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        if (!pinDrag.value && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        pinDrag.value = { threadId: thread.id, point: { x: tip.x + dx, y: tip.y + dy } };
    };

    const end = (endEvent: PointerEvent) => {
        pin.removeEventListener('pointermove', move);
        pin.removeEventListener('pointerup', end);
        pin.removeEventListener('pointercancel', end);
        pin.removeEventListener('lostpointercapture', end);
        window.removeEventListener('dragstart', preventNativeDrag, true);
        const drop = pinDrag.value;
        if (!drop) return;
        pinDrag.value = null;
        draggedPin = thread.id;
        if (endEvent.type === 'pointerup') movePin(thread, drop.point);
    };

    pin.addEventListener('pointermove', move);
    pin.addEventListener('pointerup', end);
    pin.addEventListener('pointercancel', end);
    // A lost pointer (window switch, stolen capture) cancels the drag; the pin stays put.
    pin.addEventListener('lostpointercapture', end);
    window.addEventListener('dragstart', preventNativeDrag, true);
}

function preventNativeDrag(event: DragEvent): void {
    event.preventDefault();
}

function movePin(thread: Thread, point: Point): void {
    const element = pageElementAt(point);
    if (!element) return;
    const anchor = { selector: buildSelector(element), ...offsetsIn(element, point) };
    if (send({ type: 'thread.move', threadId: thread.id, anchor })) {
        upsertLocal({ ...thread, anchor });
    }
}

/** The page element at a point, looking through the overlay (and the pin itself). */
function pageElementAt(point: Point): Element | null {
    const host = getHost();
    return (
        document
            .elementsFromPoint(point.x, point.y)
            .find(element => element !== host && element !== document.documentElement) ?? null
    );
}

function DraftPin() {
    layoutTick.value;
    const pending = draft.value!;
    const point = resolveAnchor(pending.anchor, pending.element);
    if (!point) return null;
    return (
        <div
            class="pin pin-draft pin-open"
            style={{ transform: `translate(${point.x}px, ${point.y}px)` }}
        >
            <span class="pin-body">+</span>
        </div>
    );
}

export function pinVariant(thread: Thread): string {
    if (thread.resolved) return 'resolved';
    switch (thread.status) {
        case 'draft':
            return 'queued';
        case 'starting':
        case 'working':
            return 'working';
        case 'waiting':
            return 'waiting';
        case 'error':
            return 'error';
        default:
            return 'done';
    }
}
