import { computed } from '@preact/signals';
import type { Thread } from '@tencil/protocol';
import { send } from '../lib/connection.ts';
import { resolveAnchor } from '../lib/position.ts';
import {
    draft,
    hidden,
    layoutTick,
    openThreadId,
    pageThreads,
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
    layoutTick.value;
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
    if (!thread.anchor) return null;
    const point = resolveAnchor(thread.anchor);
    if (!point) return null;
    const open = openThreadId.value === thread.id;
    return (
        <button
            type="button"
            class={`pin pin-${pinVariant(thread)}${open ? ' pin-open' : ''}`}
            style={{ transform: `translate(${point.x}px, ${point.y}px)` }}
            title={thread.title}
            onClick={() => {
                draft.value = null;
                openThreadId.value = open ? null : thread.id;
            }}
        >
            <span class="pin-body">{pinNumbers.value.get(thread.id) ?? '•'}</span>
        </button>
    );
}

function DraftPin() {
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
