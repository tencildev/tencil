import type { SDKMessage, SessionMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ProviderMessage, ThreadStatus } from '@tencil/protocol';

export type RunStatus = { status: Exclude<ThreadStatus, 'starting'>; detail?: string };

export interface TrackerUpdate {
    messages: ProviderMessage[];
    status?: RunStatus;
    /** Claude Code isn't signed in; the detail says how to fix it. */
    unauthorized?: string;
    /** A turn finished (its `result` arrived). */
    turnEnded?: boolean;
}

interface Draft {
    id: string;
    createdAt: string;
    /** Finished text blocks of this API message. */
    blocks: string[];
    /** The text block still streaming in. */
    partial: string;
    streaming: boolean;
}

/**
 * Folds the live SDK message stream of one session into cumulative
 * `ProviderMessage`s. Assistant messages are keyed by their API message id,
 * the same id the transcript on disk carries, so a replay lines up with them.
 * Subagent output and tool results stay out: the overlay shows the conversation.
 */
export class TurnTracker {
    readonly #drafts = new Map<string, Draft>();
    #current: string | undefined;
    #status: RunStatus = { status: 'idle' };

    status(): RunStatus {
        return this.#status;
    }

    setStatus(status: RunStatus): void {
        this.#status = status;
    }

    apply(message: SDKMessage, now = new Date().toISOString()): TrackerUpdate {
        const update: TrackerUpdate = { messages: [] };
        switch (message.type) {
            case 'stream_event': {
                if (message.parent_tool_use_id) break;
                const { event } = message;
                if (event.type === 'message_start') {
                    this.#begin(event.message.id, now, update);
                } else if (event.type === 'content_block_start') {
                    const draft = this.#currentDraft();
                    if (draft && event.content_block.type === 'text') {
                        draft.partial = event.content_block.text;
                    }
                } else if (
                    event.type === 'content_block_delta' &&
                    event.delta.type === 'text_delta'
                ) {
                    const draft = this.#currentDraft();
                    if (draft) {
                        draft.partial += event.delta.text;
                        update.messages.push(toMessage(draft));
                    }
                }
                break;
            }
            case 'assistant': {
                if (message.parent_tool_use_id) break;
                const draft = this.#begin(message.message.id, now, update);
                for (const block of message.message.content) {
                    if (block.type !== 'text') continue;
                    draft.blocks.push(block.text);
                    draft.partial = '';
                }
                if (textOf(draft)) update.messages.push(toMessage(draft));
                if (message.error === 'authentication_failed') {
                    update.unauthorized = 'Claude Code is not signed in. Run `claude` and log in.';
                }
                break;
            }
            case 'result': {
                this.#finish(update);
                update.turnEnded = true;
                if (message.subtype === 'success' && !message.is_error) {
                    update.status =
                        (message.queued_turn_count ?? 0) > 0
                            ? { status: 'working' }
                            : { status: 'idle' };
                } else {
                    const detail =
                        message.subtype === 'success'
                            ? message.result
                            : message.errors.join('; ') || message.subtype.replaceAll('_', ' ');
                    update.status = { status: 'error', detail: detail || undefined };
                }
                break;
            }
            case 'system': {
                if (message.subtype === 'session_state_changed') {
                    if (message.state === 'running') update.status = { status: 'working' };
                    else if (message.state === 'requires_action') {
                        update.status = {
                            status: 'waiting',
                            detail: 'Claude Code is waiting for approval',
                        };
                    } else if (this.#status.status !== 'error') {
                        update.status = { status: 'idle' };
                    }
                } else if (message.subtype === 'api_retry') {
                    update.status = {
                        status: 'working',
                        detail: `Retrying (${message.attempt}/${message.max_retries}): ${message.error}`,
                    };
                }
                break;
            }
        }
        if (update.status) this.#status = update.status;
        return update;
    }

    /** Mark everything still streaming as done, e.g. after an interrupt. */
    finish(): ProviderMessage[] {
        const update: TrackerUpdate = { messages: [] };
        this.#finish(update);
        return update.messages;
    }

    #begin(id: string, now: string, update: TrackerUpdate): Draft {
        if (this.#current && this.#current !== id) {
            const previous = this.#drafts.get(this.#current);
            if (previous?.streaming) {
                previous.streaming = false;
                if (textOf(previous)) update.messages.push(toMessage(previous));
            }
        }
        this.#current = id;
        let draft = this.#drafts.get(id);
        if (!draft) {
            draft = { id, createdAt: now, blocks: [], partial: '', streaming: true };
            this.#drafts.set(id, draft);
        }
        return draft;
    }

    #currentDraft(): Draft | undefined {
        return this.#current ? this.#drafts.get(this.#current) : undefined;
    }

    #finish(update: TrackerUpdate): void {
        for (const draft of this.#drafts.values()) {
            if (!draft.streaming) continue;
            draft.streaming = false;
            if (draft.partial) {
                draft.blocks.push(draft.partial);
                draft.partial = '';
            }
            if (textOf(draft)) update.messages.push(toMessage(draft));
        }
        this.#drafts.clear();
        this.#current = undefined;
    }
}

/** A session's conversation as stored by Claude Code, in the shape the overlay shows. */
export function messagesFromTranscript(
    entries: SessionMessage[],
    fallbackTime = new Date().toISOString(),
): ProviderMessage[] {
    const messages: ProviderMessage[] = [];
    const assistants = new Map<string, ProviderMessage>();
    for (const entry of entries) {
        if (entry.parent_tool_use_id) continue;
        // Transcript lines carry their time; the type doesn't list it.
        const createdAt = (entry as { timestamp?: string }).timestamp ?? fallbackTime;
        const body = entry.message as { id?: string; content?: unknown } | undefined;
        if (entry.type === 'user') {
            const text = userText(body?.content);
            if (text)
                messages.push({ id: entry.uuid, role: 'user', text, streaming: false, createdAt });
        } else if (entry.type === 'assistant') {
            const text = blockText(body?.content);
            if (!text) continue;
            const id = body?.id ?? entry.uuid;
            const existing = assistants.get(id);
            if (existing) {
                existing.text = `${existing.text}\n\n${text}`;
            } else {
                const message: ProviderMessage = {
                    id,
                    role: 'assistant',
                    text,
                    streaming: false,
                    createdAt,
                };
                assistants.set(id, message);
                messages.push(message);
            }
        }
    }
    return messages;
}

/** Text the user typed; tool results ride on user messages too and are skipped. */
function userText(content: unknown): string {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    if (content.some(block => block?.type === 'tool_result')) return '';
    return blockText(content);
}

function blockText(content: unknown): string {
    if (!Array.isArray(content)) return '';
    return content
        .filter(block => block?.type === 'text' && typeof block.text === 'string')
        .map(block => block.text as string)
        .filter(text => text.trim())
        .join('\n\n');
}

function textOf(draft: Draft): string {
    return [...draft.blocks, draft.partial].filter(text => text.trim()).join('\n\n');
}

function toMessage(draft: Draft): ProviderMessage {
    return {
        id: draft.id,
        role: 'assistant',
        text: textOf(draft),
        streaming: draft.streaming,
        createdAt: draft.createdAt,
    };
}
