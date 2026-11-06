import type { ProviderMessage, ThreadStatus, ThreadStep } from '@tencildev/protocol';
import type { CodexTurn, ThreadItem, ThreadItemEntry, TurnError } from './protocol.ts';
import { finishedDetail, itemLabel, itemStatus, reasoningLabel } from './tool-steps.ts';

export type RunStatus = { status: Exclude<ThreadStatus, 'starting' | 'draft'>; detail?: string };

export interface TrackerUpdate {
    messages: ProviderMessage[];
    steps: ThreadStep[];
    status?: RunStatus;
    /** Codex isn't signed in; the detail says how to fix it. */
    unauthorized?: string;
    /** A turn finished. */
    turnEnded?: boolean;
}

export const NOT_SIGNED_IN = 'Codex is not signed in. Run `codex login`.';

const iso = (ms: number) => new Date(ms).toISOString();

/**
 * Folds the notifications of one thread into cumulative `ProviderMessage`s and
 * `ThreadStep`s. Messages are keyed by the item id Codex also keeps in its
 * history (a user message by the id Tencil sent it with), so a replay lines up.
 */
export class TurnTracker {
    readonly #drafts = new Map<string, ProviderMessage>();
    readonly #steps = new Map<string, ThreadStep>();
    /** What reasoning items have summarised so far. */
    readonly #summaries = new Map<string, string>();
    #turnId: string | undefined;
    #status: RunStatus = { status: 'idle' };

    status(): RunStatus {
        return this.#status;
    }

    setStatus(status: RunStatus): void {
        this.#status = status;
    }

    /** The turn in progress, which `turn/interrupt` needs. */
    activeTurn(): string | undefined {
        return this.#turnId;
    }

    /** `turn/start` answered: the turn it started, unless its notifications got here first. */
    noteTurn(turnId: string): void {
        if (this.#status.status === 'working') this.#turnId ??= turnId;
    }

    /** The current turn's steps, for a sink that starts watching midway. */
    steps(): ThreadStep[] {
        return [...this.#steps.values()];
    }

    apply(method: string, params: unknown, now = new Date().toISOString()): TrackerUpdate {
        const update: TrackerUpdate = { messages: [], steps: [] };
        switch (method) {
            case 'turn/started': {
                const { turn } = params as { turn: CodexTurn };
                this.#turnId = turn.id;
                this.#steps.clear();
                this.#summaries.clear();
                update.status = { status: 'working' };
                break;
            }
            case 'item/started': {
                const { item, startedAtMs } = params as { item: ThreadItem; startedAtMs?: number };
                this.#itemStarted(item, startedAtMs ? iso(startedAtMs) : now, update);
                break;
            }
            case 'item/agentMessage/delta': {
                const { itemId, delta } = params as { itemId: string; delta: string };
                const draft = this.#drafts.get(itemId);
                if (draft) {
                    draft.text += delta;
                    update.messages.push({ ...draft });
                }
                break;
            }
            case 'item/reasoning/summaryTextDelta': {
                const { itemId, delta } = params as { itemId: string; delta: string };
                const summary = (this.#summaries.get(itemId) ?? '') + delta;
                this.#summaries.set(itemId, summary);
                this.#reasoning(itemId, summary, now, update);
                break;
            }
            case 'item/completed': {
                const { item, completedAtMs } = params as {
                    item: ThreadItem;
                    completedAtMs?: number;
                };
                this.#itemCompleted(item, completedAtMs ? iso(completedAtMs) : now, update);
                break;
            }
            case 'error': {
                const { error, willRetry } = params as { error: TurnError; willRetry?: boolean };
                if (willRetry) {
                    update.status = { status: 'working', detail: `Retrying: ${error.message}` };
                }
                if (isUnauthorized(error)) update.unauthorized = NOT_SIGNED_IN;
                break;
            }
            case 'turn/completed': {
                const { turn } = params as { turn: CodexTurn };
                this.#finish(now, update);
                update.turnEnded = true;
                update.status =
                    turn.status === 'failed'
                        ? { status: 'error', detail: turn.error?.message }
                        : { status: 'idle' };
                if (turn.error && isUnauthorized(turn.error)) update.unauthorized = NOT_SIGNED_IN;
                break;
            }
        }
        if (update.status) this.#status = update.status;
        return update;
    }

    /** Close whatever is still open: Codex stopped before finishing the turn. */
    finish(now = new Date().toISOString()): TrackerUpdate {
        const update: TrackerUpdate = { messages: [], steps: [] };
        this.#finish(now, update);
        return update;
    }

    #itemStarted(item: ThreadItem, startedAt: string, update: TrackerUpdate): void {
        if (item.type === 'agentMessage') {
            this.#drafts.set(item.id, {
                id: item.id,
                role: 'assistant',
                text: item.text,
                streaming: true,
                createdAt: startedAt,
            });
            return;
        }
        const label = itemLabel(item);
        if (!label) return;
        const step: ThreadStep = {
            id: item.id,
            label: label.running,
            status: 'running',
            ...(label.detail ? { detail: label.detail } : {}),
            startedAt,
        };
        this.#steps.set(item.id, step);
        update.steps.push(step);
    }

    #itemCompleted(item: ThreadItem, endedAt: string, update: TrackerUpdate): void {
        if (item.type === 'agentMessage') {
            const draft = this.#drafts.get(item.id);
            this.#drafts.delete(item.id);
            if (item.text.trim()) {
                update.messages.push({
                    id: item.id,
                    role: 'assistant',
                    text: item.text,
                    streaming: false,
                    createdAt: draft?.createdAt ?? endedAt,
                });
            }
            return;
        }
        if (item.type === 'reasoning') {
            // Some models stream the summary, others only have it here, many have none.
            const summary = this.#summaries.get(item.id) ?? item.summary?.join('\n\n') ?? '';
            this.#summaries.delete(item.id);
            this.#reasoning(item.id, summary, endedAt, update, endedAt);
            return;
        }
        const label = itemLabel(item);
        if (!label) return;
        const status = itemStatus(item);
        const detail = finishedDetail(item, label);
        const step: ThreadStep = {
            id: item.id,
            // A failed call keeps what it tried; the overlay marks it failed.
            label: status === 'failed' ? label.running : label.done,
            status,
            ...(detail ? { detail } : {}),
            startedAt: this.#steps.get(item.id)?.startedAt ?? endedAt,
            endedAt,
        };
        this.#steps.set(item.id, step);
        update.steps.push(step);
    }

    #reasoning(
        id: string,
        summary: string,
        now: string,
        update: TrackerUpdate,
        endedAt?: string,
    ): void {
        const label = reasoningLabel(summary);
        if (!label) return;
        const step: ThreadStep = {
            id,
            label: endedAt ? label.done : label.running,
            status: endedAt ? 'done' : 'running',
            ...(label.detail ? { detail: label.detail } : {}),
            startedAt: this.#steps.get(id)?.startedAt ?? now,
            ...(endedAt ? { endedAt } : {}),
        };
        this.#steps.set(id, step);
        update.steps.push(step);
    }

    #finish(now: string, update: TrackerUpdate): void {
        for (const draft of this.#drafts.values()) {
            if (draft.text.trim()) update.messages.push({ ...draft, streaming: false });
        }
        this.#drafts.clear();
        for (const step of this.#steps.values()) {
            if (step.status !== 'running') continue;
            const skipped: ThreadStep = { ...step, status: 'skipped', endedAt: now };
            this.#steps.set(step.id, skipped);
            update.steps.push(skipped);
        }
        this.#summaries.clear();
        this.#turnId = undefined;
    }
}

function isUnauthorized(error: TurnError): boolean {
    const info = error.codexErrorInfo;
    if (info === 'unauthorized') return true;
    if (typeof info !== 'object' || info === null) return false;
    return Object.values(info).some(
        value => (value as { httpStatusCode?: number } | null)?.httpStatusCode === 401,
    );
}

/** A thread's conversation as Codex stored it, in the shape the overlay shows. */
export function messagesFromHistory(
    entries: ThreadItemEntry[],
    fallbackTime = new Date().toISOString(),
): ProviderMessage[] {
    const messages: ProviderMessage[] = [];
    // An item without a time is at least as old as the one after the last that had it.
    let createdAt = fallbackTime;
    for (const { item, startedAtMs } of entries) {
        if (startedAtMs) createdAt = iso(startedAtMs);
        if (item.type === 'userMessage') {
            const text = item.content
                .flatMap(part => (part.type === 'text' && part.text ? [part.text] : []))
                .join('\n\n');
            if (text.trim()) {
                messages.push({
                    id: item.clientId ?? item.id,
                    role: 'user',
                    text,
                    streaming: false,
                    createdAt,
                });
            }
        } else if (item.type === 'agentMessage' && item.text.trim()) {
            messages.push({
                id: item.id,
                role: 'assistant',
                text: item.text,
                streaming: false,
                createdAt,
            });
        }
    }
    return messages;
}
