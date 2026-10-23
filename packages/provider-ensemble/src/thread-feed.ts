import { setTimeout as sleep } from 'node:timers/promises';
import type { ProviderMessage, ThreadSink, ThreadStep } from '@tencildev/protocol';
import {
    type EnsembleClient,
    type EnsembleEvent,
    EnsembleHttpError,
    type EnsembleMessage,
    type EnsembleStatus,
    type EnsembleStep,
    EnsembleUnauthorizedError,
    errorMessage,
} from './api.ts';

interface Chat {
    messages: Map<string, ProviderMessage>;
    steps: Map<string, ThreadStep>;
    status?: EnsembleStatus;
}

export interface ThreadFeedOptions {
    /** Called when Ensemble refuses the token; the feed stops until `follow` is called again. */
    onUnauthorized: () => void;
    log?: (message: string) => void;
    timeouts?: { reconnectMinMs?: number; reconnectMaxMs?: number; silenceMs?: number };
}

/**
 * One Ensemble thread's feed, shared by every pin in it. It keeps each chat's state,
 * so a watcher that starts late gets it replayed, and resumes from the last event
 * after a drop.
 */
export class ThreadFeed {
    readonly #chats = new Map<string, Chat>();
    readonly #watchers = new Map<string, Set<ThreadSink>>();
    #cursor?: string;
    #following?: AbortController;
    #archived = false;

    constructor(
        readonly threadId: string,
        readonly options: ThreadFeedOptions,
    ) {}

    get watched(): boolean {
        return this.#watchers.size > 0;
    }

    /** Replay the chat's state to `sink`, then send it live updates. Call `follow` to go live. */
    watch(chatId: string, sink: ThreadSink): () => void {
        if (this.#archived) {
            sink.gone();
            return () => {};
        }
        const watchers = this.#watchers.get(chatId) ?? new Set();
        this.#watchers.set(chatId, watchers);
        watchers.add(sink);
        const chat = this.#chats.get(chatId);
        if (chat) replay(chat, sink);
        return () => {
            watchers.delete(sink);
            if (!watchers.size) this.#watchers.delete(chatId);
            if (!this.watched) this.stop();
        };
    }

    /** Follow the feed while anyone watches; does nothing when it already does. */
    follow(client: EnsembleClient): void {
        if (this.#following || this.#archived || !this.watched) return;
        const following = new AbortController();
        this.#following = following;
        void this.#follow(client, following.signal).finally(() => {
            if (this.#following === following) this.#following = undefined;
        });
    }

    stop(): void {
        this.#following?.abort();
        this.#following = undefined;
    }

    async #follow(client: EnsembleClient, signal: AbortSignal): Promise<void> {
        const minMs = this.options.timeouts?.reconnectMinMs ?? 1_000;
        const maxMs = this.options.timeouts?.reconnectMaxMs ?? 30_000;
        let delayMs = minMs;
        while (!signal.aborted) {
            try {
                const events = client.feed(this.threadId, {
                    after: this.#cursor,
                    signal,
                    silenceMs: this.options.timeouts?.silenceMs,
                });
                for await (const { id, event } of events) {
                    this.#apply(event);
                    if (id !== undefined) this.#cursor = id;
                    delayMs = minMs;
                }
            } catch (error) {
                if (signal.aborted) return;
                if (error instanceof EnsembleUnauthorizedError)
                    return this.options.onUnauthorized();
                if (error instanceof EnsembleHttpError && error.status === 404) {
                    return this.#apply({ type: 'archived', threadId: this.threadId });
                }
                this.options.log?.(`Reconnecting to Ensemble's feed: ${errorMessage(error)}`);
            }
            await sleep(delayMs, undefined, { signal, ref: false }).catch(() => {});
            delayMs = Math.min(delayMs * 2, maxMs);
        }
    }

    #apply(event: EnsembleEvent): void {
        switch (event.type) {
            case 'archived':
                this.#archived = true;
                this.stop();
                for (const sinks of this.#watchers.values()) for (const sink of sinks) sink.gone();
                return;
            case 'chat':
                this.#upsertMessages(event.chatId, event.messages);
                this.#replaceSteps(event.chatId, event.steps);
                this.#setStatus(event.chatId, event.status);
                return;
            case 'message':
                this.#upsertMessages(event.chatId, [event.message]);
                return;
            case 'steps':
                this.#replaceSteps(event.chatId, event.steps);
                return;
            case 'status':
                this.#setStatus(event.chatId, event.status);
                return;
        }
    }

    #upsertMessages(chatId: string, messages: EnsembleMessage[]): void {
        const chat = this.#chat(chatId);
        for (const message of messages) {
            // Ensemble has no timestamps; a message is as old as when Tencil first saw it.
            const createdAt = chat.messages.get(message.id)?.createdAt ?? new Date().toISOString();
            const next = { ...message, createdAt };
            chat.messages.set(message.id, next);
            for (const sink of this.#sinks(chatId)) sink.message(next);
        }
    }

    /** Ensemble sends the turn's whole list of steps each time. */
    #replaceSteps(chatId: string, steps: EnsembleStep[]): void {
        const chat = this.#chat(chatId);
        const previous = chat.steps;
        chat.steps = new Map();
        const now = new Date().toISOString();
        for (const step of steps) {
            const before = previous.get(step.id);
            const next: ThreadStep = {
                ...step,
                startedAt: before?.startedAt ?? now,
                ...(step.status === 'running' ? {} : { endedAt: before?.endedAt ?? now }),
            };
            chat.steps.set(step.id, next);
            for (const sink of this.#sinks(chatId)) sink.step?.(next);
        }
    }

    #setStatus(chatId: string, status: EnsembleStatus): void {
        this.#chat(chatId).status = status;
        for (const sink of this.#sinks(chatId)) sink.status(status);
    }

    #chat(chatId: string): Chat {
        let chat = this.#chats.get(chatId);
        if (!chat) {
            chat = { messages: new Map(), steps: new Map() };
            this.#chats.set(chatId, chat);
        }
        return chat;
    }

    #sinks(chatId: string): Iterable<ThreadSink> {
        return this.#watchers.get(chatId) ?? [];
    }
}

function replay(chat: Chat, sink: ThreadSink): void {
    for (const message of chat.messages.values()) sink.message(message);
    for (const step of chat.steps.values()) sink.step?.(step);
    if (chat.status) sink.status(chat.status);
}
