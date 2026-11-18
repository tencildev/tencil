import { computed } from '@preact/signals';
import type { Thread } from '@tencildev/protocol';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { send, threads, upsertLocal } from '../lib/connection.ts';
import { buildSelector } from '../lib/element-context.ts';
import { getHost } from '../lib/overlay-host.ts';
import { offsetsIn, type Point, resolveAnchor } from '../lib/position.ts';
import {
    currentPage,
    draft,
    hidden,
    layoutTick,
    openThreadId,
    pageThreads,
    pinDrag,
    queuedThreads,
    sortedThreads,
} from '../lib/state.ts';
import { CheckIcon } from './icons.tsx';
import { peekable, peekPin, unpeekPin } from './pin-peek.tsx';

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
    const leaving = useLeavingPins();
    if (hidden.value) return null;
    const pending = draft.value;
    return (
        <>
            {pageThreads.value.map(thread => (
                <Pin key={thread.id} thread={thread} />
            ))}
            {leaving.map(pin => (
                <LeavingPin key={`leaving:${pin.thread.id}`} pin={pin} />
            ))}
            {pending && <DraftPin />}
        </>
    );
}

/** A pin on its way out: what it looked like on screen, and whether it was resolved. */
interface Leaving {
    thread: Thread;
    number: number | undefined;
    variant: string;
    resolved: boolean;
}

/** How long a leaving pin stays: the check (resolved only), then the dissolve. */
const LEAVE_MS = 1000;

/**
 * Pins that left this page while it stayed open (resolved, or deleted), kept on
 * screen until their exit animation has played. A pin that comes back (reopened,
 * or "Show resolved" switched on) drops out of the list straight away.
 */
function useLeavingPins(): Leaving[] {
    const visible = pageThreads.value;
    const page = currentPage.value;
    const shown = useRef({ page, pins: [] as Leaving[] });
    const [leaving, setLeaving] = useState<Leaving[]>([]);

    useLayoutEffect(() => {
        const previous = shown.current;
        shown.current = {
            page,
            pins: visible.map(thread => ({
                thread,
                number: pinNumbers.value.get(thread.id),
                variant: pinVariant(thread),
                resolved: false,
            })),
        };
        const ids = new Set(visible.map(thread => thread.id));
        const gone =
            previous.page === page
                ? previous.pins
                      .filter(pin => !ids.has(pin.thread.id))
                      .map(pin => ({
                          ...pin,
                          resolved: threads.value.get(pin.thread.id)?.resolved === true,
                      }))
                : [];
        setLeaving(current => {
            const stay = current.filter(
                pin => !ids.has(pin.thread.id) && !gone.some(g => g.thread.id === pin.thread.id),
            );
            return stay.length === current.length && gone.length === 0
                ? current
                : [...stay, ...gone];
        });
        for (const pin of gone) {
            setTimeout(() => setLeaving(current => current.filter(p => p !== pin)), LEAVE_MS);
        }
    }, [visible, page]);

    return leaving;
}

function LeavingPin({ pin }: { pin: Leaving }) {
    layoutTick.value;
    const point = pin.thread.anchor ? resolveAnchor(pin.thread.anchor) : null;
    if (!point) return null;
    return (
        <div
            class={`pin pin-${pin.variant} pin-leaving${pin.resolved ? ' pin-resolving' : ''}`}
            style={{ transform: `translate(${point.x}px, ${point.y}px)` }}
            aria-hidden="true"
        >
            <span class="pin-body">
                <span class="pin-glyph">{pin.number ?? '•'}</span>
                {pin.resolved && (
                    <>
                        <span class="pin-glyph pin-check">
                            <CheckIcon />
                        </span>
                        <span class="pin-shine" />
                    </>
                )}
            </span>
        </div>
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
            title={peekable(thread.status) ? undefined : thread.title}
            onPointerEnter={() => {
                if (peekable(thread.status)) peekPin(thread.id);
            }}
            onPointerLeave={unpeekPin}
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
        pinDrag.value = {
            threadId: thread.id,
            point: insidePage({ x: tip.x + dx, y: tip.y + dy }),
        };
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

/**
 * Keep a dragged tip over the page: past the window's edge or on its scrollbar
 * there's no element to anchor to, and the pin would jump back on release.
 */
function insidePage(point: Point): Point {
    const { clientWidth, clientHeight } = document.documentElement;
    return {
        x: Math.max(0, Math.min(point.x, clientWidth - 1)),
        y: Math.max(0, Math.min(point.y, clientHeight - 1)),
    };
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
            .find(element => element !== host && element !== document.documentElement) ??
        // Below a short page there's only <html>; the body is the closest anchor.
        document.body
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
    // Once the agent is done, a cloud pin follows its commit to the preview.
    const delivery = thread.delivery?.status;
    if (delivery && (thread.status === 'idle' || thread.status === 'error')) {
        // Not `pushed`: the change is done then, and a host that never reports a
        // deploy (or a repo without previews) would leave the pin spinning.
        if (delivery === 'queued' || delivery === 'deploying') return 'working';
        if (delivery === 'failed' || delivery === 'deploy-failed') return 'error';
        return 'done';
    }
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
