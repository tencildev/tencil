import { signal } from '@preact/signals';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { threads } from '../lib/connection.ts';
import { popoverPosition, resolveAnchor } from '../lib/position.ts';
import { layoutTick, openThreadId, pinDrag } from '../lib/state.ts';
import { Activity } from './activity.tsx';
import { pinNumbers } from './pins.tsx';

const WIDTH = 272;
/** Hover before the peek shows, so sweeping across the page doesn't flash it. */
const OPEN_DELAY_MS = 220;
/** Grace to travel from the pin into the peek. */
const CLOSE_DELAY_MS = 160;

const peekThreadId = signal<string | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;

/** Hovering a pin that's busy: show what its agent is doing, without opening it. */
export function peekPin(threadId: string): void {
    clearTimeout(timer);
    if (peekThreadId.value === threadId) return;
    timer = setTimeout(
        () => {
            peekThreadId.value = threadId;
        },
        peekThreadId.value ? 0 : OPEN_DELAY_MS,
    );
}

export function unpeekPin(): void {
    clearTimeout(timer);
    timer = setTimeout(() => {
        peekThreadId.value = null;
    }, CLOSE_DELAY_MS);
}

/** Whether a pin in this state has anything to peek at. */
export function peekable(status: string): boolean {
    return status === 'working' || status === 'starting' || status === 'waiting';
}

/**
 * A small card beside a busy pin: the live clock, Stop and the newest tool
 * calls. Clicking it opens the thread, where the same activity continues.
 */
export function PinPeek() {
    layoutTick.value;
    const id = peekThreadId.value;
    const thread = id ? threads.value.get(id) : undefined;
    const ref = useRef<HTMLDivElement>(null);
    const [height, setHeight] = useState(80);
    useLayoutEffect(() => {
        if (ref.current) setHeight(ref.current.offsetHeight);
    });
    if (
        !thread?.anchor ||
        openThreadId.value === thread.id ||
        pinDrag.value ||
        !peekable(thread.status)
    ) {
        return null;
    }
    const point = resolveAnchor(thread.anchor);
    if (!point) return null;
    const { left, top, origin } = popoverPosition(point, { width: WIDTH, height }, 40);
    return (
        <div
            ref={ref}
            key={thread.id}
            class="popover peek"
            style={{
                left: `${left}px`,
                top: `${top}px`,
                width: `${WIDTH}px`,
                transformOrigin: origin,
            }}
            onPointerEnter={() => clearTimeout(timer)}
            onPointerLeave={unpeekPin}
            onClick={() => {
                peekThreadId.value = null;
                openThreadId.value = thread.id;
            }}
        >
            <div class="peek-title">
                <span class="thread-number">#{pinNumbers.value.get(thread.id)}</span>
                <span class="peek-text">{thread.title}</span>
            </div>
            <Activity thread={thread} rows={3} />
        </div>
    );
}
