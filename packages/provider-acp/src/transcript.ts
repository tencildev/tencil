import { randomUUID } from 'node:crypto';
import type { ProviderMessage, ThreadStatus, ThreadStep } from '@tencildev/protocol';
import type { ContentBlock, SessionUpdate, StopReason, ToolCall } from './protocol.ts';
import { planLabel, thoughtLabel, toolLabel, toolStatus } from './tool-steps.ts';

export type RunStatus = { status: Exclude<ThreadStatus, 'starting' | 'draft'>; detail?: string };

export interface TranscriptUpdate {
    messages: ProviderMessage[];
    steps: ThreadStep[];
    status?: RunStatus;
}

type Part = 'user' | 'agent' | 'thought' | 'tool' | 'plan';

interface Snapshot {
    messages: Map<string, ProviderMessage>;
    turn: number;
    prefix: string;
}

/**
 * Folds one session's `session/update` notifications into cumulative
 * `ProviderMessage`s and `ThreadStep`s.
 *
 * ACP messages have no ids every agent sends, so a message is named after its
 * turn: the prompt that opens it and everything the agent says until the
 * next. `session/load` replays the conversation in the same order, so after a
 * restart the replay lines up with what the pin already shows.
 */
export class Transcript {
    /** The checkout, which steps name files relative to. */
    readonly #cwd: () => string;
    /** Set when the conversation's start is unknown here, so new ids can't clash with old ones. */
    #prefix = '';
    #turn = 0;
    #last: Part | undefined;
    /** The agent's id for the prompt being replayed, when it gives one. */
    #promptId: string | undefined;
    readonly #messages = new Map<string, ProviderMessage>();
    /** The current turn's steps, and the tool calls behind them. */
    readonly #steps = new Map<string, ThreadStep>();
    readonly #tools = new Map<string, ToolCall>();
    #thought: { id: string; text: string } | undefined;
    #thoughts = 0;
    #status: RunStatus = { status: 'idle' };
    #replay: Snapshot | undefined;

    constructor(cwd: () => string) {
        this.#cwd = cwd;
    }

    status(): RunStatus {
        return this.#status;
    }

    setStatus(status: RunStatus): void {
        this.#status = status;
    }

    messages(): ProviderMessage[] {
        return [...this.#messages.values()];
    }

    /** The current turn's steps, for a sink that starts watching midway. */
    steps(): ThreadStep[] {
        return [...this.#steps.values()];
    }

    /** The conversation went on somewhere this transcript didn't see, e.g. before a restart. */
    continueUnseen(): void {
        if (this.#turn === 0) this.#prefix = `${randomUUID().slice(0, 8)}-`;
    }

    /** Tencil sends a prompt: a new turn starts with it. */
    prompt(text: string, now = new Date().toISOString()): TranscriptUpdate {
        const update: TranscriptUpdate = { messages: [], steps: [] };
        this.#startTurn(now, update);
        const message: ProviderMessage = {
            id: this.#key('user'),
            role: 'user',
            text,
            streaming: false,
            createdAt: now,
        };
        this.#messages.set(message.id, message);
        update.messages.push(message);
        this.#last = 'user';
        this.#status = { status: 'working' };
        update.status = this.#status;
        return update;
    }

    apply(update: SessionUpdate, now = new Date().toISOString()): TranscriptUpdate {
        const result: TranscriptUpdate = { messages: [], steps: [] };
        switch (update.sessionUpdate) {
            case 'user_message_chunk': {
                // Live, that's the agent echoing the prompt Tencil already shows.
                if (!this.#replay) break;
                const chunk = update as { content: ContentBlock; messageId?: string | null };
                const messageId = chunk.messageId ?? undefined;
                // Prompts with no reply between them are told apart by their ids, if any.
                if (this.#last !== 'user' || (messageId && messageId !== this.#promptId)) {
                    this.#startTurn(now, result);
                    this.#last = 'user';
                }
                this.#promptId = messageId;
                const text = textOf(chunk.content);
                if (text) this.#append('user', text, now, result, false);
                break;
            }
            case 'agent_message_chunk': {
                const text = textOf((update as { content: ContentBlock }).content);
                if (!text) break;
                this.#closeThought(now, result);
                // Text after a tool call or a thought is a new paragraph of the same reply.
                const id = this.#key('agent');
                const existing = this.#messages.get(id);
                const gap =
                    existing?.text && this.#last !== 'agent' && !existing.text.endsWith('\n')
                        ? '\n\n'
                        : '';
                this.#append('agent', gap + text, now, result, !this.#replay);
                this.#last = 'agent';
                break;
            }
            case 'agent_thought_chunk': {
                const text = textOf((update as { content: ContentBlock }).content);
                if (!text) break;
                if (this.#last !== 'thought' || !this.#thought) {
                    this.#closeThought(now, result);
                    this.#thought = { id: this.#key(`thought-${++this.#thoughts}`), text: '' };
                }
                this.#thought.text += text;
                const label = thoughtLabel(this.#thought.text, false);
                if (label) {
                    this.#step(this.#thought.id, { ...label, status: 'running' }, now, result);
                }
                this.#last = 'thought';
                break;
            }
            case 'tool_call':
            case 'tool_call_update': {
                this.#closeThought(now, result);
                const { sessionUpdate: _, ...fields } = update as ToolCall & {
                    sessionUpdate: string;
                };
                const id = this.#key(`tool-${fields.toolCallId}`);
                const call: ToolCall = {
                    ...this.#tools.get(id),
                    ...defined(fields),
                    toolCallId: fields.toolCallId,
                };
                this.#tools.set(id, call);
                const status = toolStatus(call.status);
                this.#step(id, { ...toolLabel(call, this.#cwd()), status }, now, result);
                this.#last = 'tool';
                break;
            }
            case 'plan': {
                this.#closeThought(now, result);
                const { entries } = update as { entries: Parameters<typeof planLabel>[0] };
                if (entries.length) this.#step(this.#key('plan'), planLabel(entries), now, result);
                this.#last = 'plan';
                break;
            }
        }
        return result;
    }

    /** The turn ended, how its prompt's answer says. Closes whatever it left open. */
    finish(status: RunStatus, now = new Date().toISOString()): TranscriptUpdate {
        const update: TranscriptUpdate = { messages: [], steps: [] };
        this.#settle(now, update);
        this.#status = status;
        update.status = status;
        return update;
    }

    /** `session/load` replays the whole conversation: build it again from the start. */
    beginReplay(): void {
        this.#replay = {
            messages: new Map(this.#messages),
            turn: this.#turn,
            prefix: this.#prefix,
        };
        this.#messages.clear();
        this.#steps.clear();
        this.#tools.clear();
        this.#thought = undefined;
        this.#last = undefined;
        this.#promptId = undefined;
        this.#turn = 0;
        this.#prefix = '';
    }

    /**
     * The replay is complete. Messages keep the time they were first seen;
     * the rest get times in their order, since ACP doesn't say when they were sent.
     */
    endReplay(now = Date.now()): ProviderMessage[] {
        const before = this.#replay?.messages ?? new Map<string, ProviderMessage>();
        this.#replay = undefined;
        const messages = [...this.#messages.values()];
        const first = now - messages.length;
        messages.forEach((message, index) => {
            this.#messages.set(message.id, {
                ...message,
                streaming: false,
                createdAt:
                    before.get(message.id)?.createdAt ?? new Date(first + index).toISOString(),
            });
        });
        // Steps belong to the turn they ran in, long over.
        this.#steps.clear();
        this.#tools.clear();
        this.#thought = undefined;
        this.#status = { status: 'idle' };
        return this.messages();
    }

    /** The replay failed: keep the conversation as it was. */
    abortReplay(): void {
        const snapshot = this.#replay;
        if (!snapshot) return;
        this.#replay = undefined;
        this.#messages.clear();
        for (const [id, message] of snapshot.messages) this.#messages.set(id, message);
        this.#turn = snapshot.turn;
        this.#prefix = snapshot.prefix;
        this.#steps.clear();
        this.#tools.clear();
        this.#thought = undefined;
        this.#last = undefined;
    }

    #key(part: string): string {
        return `${this.#prefix}${this.#turn}:${part}`;
    }

    #startTurn(now: string, update: TranscriptUpdate): void {
        this.#settle(now, update);
        this.#turn += 1;
        this.#steps.clear();
        this.#tools.clear();
        this.#thoughts = 0;
        this.#last = undefined;
    }

    #append(
        role: 'user' | 'agent',
        text: string,
        now: string,
        update: TranscriptUpdate,
        streaming: boolean,
    ): void {
        const id = this.#key(role);
        const existing = this.#messages.get(id);
        const message: ProviderMessage = {
            id,
            role: role === 'user' ? 'user' : 'assistant',
            text: (existing?.text ?? '') + text,
            streaming,
            createdAt: existing?.createdAt ?? now,
        };
        this.#messages.set(id, message);
        update.messages.push(message);
    }

    #step(
        id: string,
        step: Pick<ThreadStep, 'label' | 'status' | 'detail'>,
        now: string,
        update: TranscriptUpdate,
    ): void {
        const started = this.#steps.get(id)?.startedAt ?? now;
        const next: ThreadStep = {
            id,
            label: step.label,
            status: step.status,
            ...(step.detail ? { detail: step.detail } : {}),
            startedAt: started,
            ...(step.status === 'running' ? {} : { endedAt: now }),
        };
        this.#steps.set(id, next);
        update.steps.push(next);
    }

    #closeThought(now: string, update: TranscriptUpdate): void {
        const thought = this.#thought;
        if (!thought) return;
        this.#thought = undefined;
        const label = thoughtLabel(thought.text, true);
        if (label && this.#steps.has(thought.id)) {
            this.#step(thought.id, { ...label, status: 'done' }, now, update);
        }
    }

    /** Close what's still open: a streaming reply, a thought, tool calls nobody finished. */
    #settle(now: string, update: TranscriptUpdate): void {
        this.#closeThought(now, update);
        for (const message of this.#messages.values()) {
            if (!message.streaming) continue;
            const done = { ...message, streaming: false };
            this.#messages.set(message.id, done);
            update.messages.push(done);
        }
        for (const step of this.#steps.values()) {
            if (step.status !== 'running') continue;
            const skipped: ThreadStep = { ...step, status: 'skipped', endedAt: now };
            this.#steps.set(step.id, skipped);
            update.steps.push(skipped);
        }
    }
}

/** How a turn that ended with `reason` leaves the pin. */
export function stopStatus(reason: StopReason | string | undefined, label: string): RunStatus {
    switch (reason) {
        case 'max_tokens':
            return {
                status: 'error',
                detail: `${label} reached its output limit before it finished`,
            };
        case 'max_turn_requests':
            return { status: 'error', detail: `${label} reached its limit of steps for one turn` };
        case 'refusal':
            return { status: 'error', detail: `${label} refused to go on` };
        default:
            return { status: 'idle' };
    }
}

function textOf(content: ContentBlock | undefined): string {
    if (content?.type !== 'text') return '';
    const text = (content as { text?: unknown }).text;
    return typeof text === 'string' ? text : '';
}

/** A `tool_call_update` only carries what changed; `null` and absent fields keep the old value. */
function defined<T extends object>(fields: T): Partial<T> {
    return Object.fromEntries(
        Object.entries(fields).filter(([, value]) => value !== undefined && value !== null),
    ) as Partial<T>;
}
