import { randomUUID } from 'node:crypto';
import type { ProviderMessage } from '@tencildev/protocol';
import {
    decodedSize,
    type ProtocolAdapter,
    type ThreadTracker,
    type TrackerUpdate,
} from './adapter.ts';

/**
 * Orchestration V1, spoken by every released T3 Code build (≤ 0.0.45). A
 * `thread.turn.start` with `bootstrap.createThread` creates the thread and
 * starts its first turn atomically; images ride inline as data URLs.
 */
export const v1: ProtocolAdapter = {
    version: 1,

    async createProject(socket, input) {
        await socket.request('orchestration.dispatchCommand', {
            type: 'project.create',
            commandId: randomUUID(),
            projectId: input.projectId,
            title: input.title,
            workspaceRoot: input.workspaceRoot,
            createdAt: now(),
        });
    },

    async startThread(socket, input) {
        const createdAt = now();
        await socket.request('orchestration.dispatchCommand', {
            type: 'thread.turn.start',
            commandId: randomUUID(),
            threadId: input.threadId,
            message: {
                messageId: randomUUID(),
                role: 'user',
                text: input.text,
                attachments: uploads(input.attachments),
            },
            modelSelection: input.modelSelection,
            titleSeed: input.title,
            runtimeMode: input.runtimeMode,
            interactionMode: input.interactionMode,
            bootstrap: {
                createThread: {
                    projectId: input.projectId,
                    title: input.title,
                    modelSelection: input.modelSelection,
                    runtimeMode: input.runtimeMode,
                    interactionMode: input.interactionMode,
                    // Work in the checkout the dev server is serving, so edits hot-reload.
                    branch: null,
                    worktreePath: null,
                    createdAt,
                },
            },
            createdAt,
        });
    },

    async sendMessage(socket, input) {
        await socket.request('orchestration.dispatchCommand', {
            type: 'thread.turn.start',
            commandId: randomUUID(),
            threadId: input.threadId,
            message: {
                messageId: randomUUID(),
                role: 'user',
                text: input.text,
                attachments: uploads(input.attachments),
            },
            runtimeMode: input.runtimeMode,
            interactionMode: input.interactionMode,
            createdAt: now(),
        });
    },

    async interrupt(socket, threadId, turnId) {
        await socket.request('orchestration.dispatchCommand', {
            type: 'thread.turn.interrupt',
            commandId: randomUUID(),
            threadId,
            turnId,
            createdAt: now(),
        });
    },

    createTracker: () => new V1ThreadTracker(),
};

function uploads(attachments: Parameters<ProtocolAdapter['startThread']>[1]['attachments']) {
    return attachments.map(attachment => ({
        type: 'image',
        name: attachment.name,
        mimeType: attachment.mimeType,
        // Verified server-side against the decoded payload.
        sizeBytes: decodedSize(attachment.dataUrl),
        dataUrl: attachment.dataUrl,
    }));
}

function now(): string {
    return new Date().toISOString();
}

/* --------------------------------- tracker --------------------------------- */

interface WireMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    text: string;
    streaming: boolean;
    createdAt: string;
}

interface WireSession {
    status: 'idle' | 'starting' | 'running' | 'ready' | 'interrupted' | 'stopped' | 'error';
    activeTurnId: string | null;
    lastError: string | null;
}

interface WireLatestTurn {
    turnId: string;
    state: 'running' | 'interrupted' | 'completed' | 'error';
}

type WireItem =
    | { kind: 'synchronized' }
    | {
          kind: 'snapshot';
          snapshot: {
              thread: {
                  messages?: WireMessage[];
                  session?: WireSession | null;
                  latestTurn?: WireLatestTurn | null;
              };
          };
      }
    | { kind: 'event'; event: { type: string; payload: Record<string, unknown> } };

export class V1ThreadTracker implements ThreadTracker {
    #messages = new Map<string, ProviderMessage>();
    #session: WireSession | null = null;
    #latestTurn: WireLatestTurn | null = null;
    /** A turn was requested but the session hasn't reported it running yet. */
    #pendingStart = false;
    #lastStatusKey = '';

    apply(raw: unknown): TrackerUpdate {
        const item = raw as WireItem;
        const changed: ProviderMessage[] = [];
        let gone = false;

        if (item.kind === 'snapshot') {
            const { thread } = item.snapshot;
            this.#session = thread.session ?? null;
            this.#latestTurn = thread.latestTurn ?? null;
            for (const message of thread.messages ?? []) this.#replace(message, changed);
        } else if (item.kind === 'event') {
            const { type, payload } = item.event;
            switch (type) {
                case 'thread.message-sent':
                    this.#messageSent(
                        payload as unknown as WireMessage & { messageId: string },
                        changed,
                    );
                    break;
                case 'thread.session-set': {
                    const session = payload.session as WireSession;
                    this.#session = session;
                    if (
                        session.status === 'running' ||
                        session.status === 'starting' ||
                        session.status === 'error'
                    ) {
                        this.#pendingStart = false;
                    }
                    break;
                }
                case 'thread.turn-start-requested':
                    this.#pendingStart = true;
                    break;
                case 'thread.deleted':
                    gone = true;
                    break;
            }
        }

        const update: TrackerUpdate = { messages: changed };
        if (gone) update.gone = true;
        const status = this.status();
        const key = `${status.status}:${status.detail ?? ''}`;
        if (key !== this.#lastStatusKey) {
            this.#lastStatusKey = key;
            update.status = status;
        }
        return update;
    }

    status(): ReturnType<ThreadTracker['status']> {
        if (this.#pendingStart) return { status: 'working' };
        switch (this.#session?.status) {
            case 'starting':
            case 'running':
                return { status: 'working' };
            case 'error':
                return {
                    status: 'error',
                    detail: this.#session.lastError ?? 'Agent session failed',
                };
            case 'interrupted':
                return { status: 'idle', detail: 'Stopped' };
        }
        if (this.#latestTurn?.state === 'running') return { status: 'working' };
        if (this.#latestTurn?.state === 'error') return { status: 'error', detail: 'Turn failed' };
        return { status: 'idle' };
    }

    activeTurnId(): string | undefined {
        return (
            this.#session?.activeTurnId ??
            (this.#latestTurn?.state === 'running' ? this.#latestTurn.turnId : undefined)
        );
    }

    /** Mirrors the server projector: streaming events carry deltas, the final one the full text. */
    #messageSent(payload: WireMessage & { messageId: string }, changed: ProviderMessage[]): void {
        if (payload.role === 'system') return;
        const existing = this.#messages.get(payload.messageId);
        const text = existing
            ? payload.streaming
                ? existing.text + payload.text
                : payload.text.length > 0
                  ? payload.text
                  : existing.text
            : payload.text;
        this.#set(
            {
                id: payload.messageId,
                role: payload.role,
                text,
                streaming: payload.streaming,
                createdAt: existing?.createdAt ?? payload.createdAt,
            },
            changed,
        );
    }

    #replace(message: WireMessage, changed: ProviderMessage[]): void {
        if (message.role === 'system') return;
        this.#set(
            {
                id: message.id,
                role: message.role,
                text: message.text,
                streaming: message.streaming,
                createdAt: message.createdAt,
            },
            changed,
        );
    }

    #set(next: ProviderMessage, changed: ProviderMessage[]): void {
        const previous = this.#messages.get(next.id);
        if (previous && previous.text === next.text && previous.streaming === next.streaming)
            return;
        this.#messages.set(next.id, next);
        const index = changed.findIndex(message => message.id === next.id);
        if (index === -1) changed.push(next);
        else changed[index] = next;
    }
}
