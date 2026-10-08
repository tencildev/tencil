import { randomUUID } from 'node:crypto';

/** A user message as the Agent SDK receives it on its input stream. */
interface InputMessage {
    message: { role: 'user'; content: string | Array<{ type: string; text?: string }> };
    uuid?: string;
}

export interface FakeSession {
    id: string;
    dir: string;
    title?: string;
    entries: Array<Record<string, unknown>>;
    updatedAt: number;
}

export interface FakeQueryRecord {
    options: Record<string, unknown>;
    closed: boolean;
    interrupts: number;
}

/**
 * Stands in for `@anthropic-ai/claude-agent-sdk`: each user message gets a
 * scripted, streamed reply, and sessions are kept in memory the way Claude
 * Code keeps transcripts on disk.
 */
export class FakeAgentSdk {
    readonly sessions = new Map<string, FakeSession>();
    readonly queries: FakeQueryRecord[] = [];
    reply: (text: string) => string = text => `Done: ${text}`;
    /** Pause every turn after its first chunk until `release()` (or an interrupt). */
    holdTurns = false;
    /** Make the next turn's process die mid-turn. */
    crashNextTurn = false;
    #gates = new Set<() => void>();

    release(): void {
        for (const open of this.#gates) open();
        this.#gates.clear();
    }

    query = ({
        prompt,
        options,
    }: {
        prompt: AsyncIterable<InputMessage>;
        options: Record<string, unknown>;
    }) => {
        const record: FakeQueryRecord = { options, closed: false, interrupts: 0 };
        this.queries.push(record);
        const id = (options.sessionId ?? options.resume) as string;
        if (options.resume && !this.sessions.has(id)) {
            throw new Error(`No conversation found with session ID: ${id}`);
        }
        const session = this.sessions.get(id) ?? {
            id,
            dir: options.cwd as string,
            title: options.title as string | undefined,
            entries: [],
            updatedAt: Date.now(),
        };
        this.sessions.set(id, session);
        let interrupt: (() => void) | undefined;
        const generator = this.#run(session, prompt, record, open => {
            interrupt = open;
        });
        return Object.assign(generator, {
            interrupt: async () => {
                record.interrupts++;
                interrupt?.();
            },
            close: () => {
                record.closed = true;
                void generator.return(undefined);
            },
        });
    };

    listSessions = async ({ dir }: { dir?: string } = {}) =>
        [...this.sessions.values()]
            .filter(session => !dir || session.dir === dir)
            .map(session => this.#info(session));

    getSessionInfo = async (id: string) => {
        const session = this.sessions.get(id);
        return session ? this.#info(session) : undefined;
    };

    getSessionMessages = async (id: string) => this.sessions.get(id)?.entries ?? [];

    #info(session: FakeSession) {
        const first = session.entries[0] as { message?: { content?: unknown } } | undefined;
        return {
            sessionId: session.id,
            summary: session.title ?? String(first?.message?.content ?? ''),
            customTitle: session.title,
            lastModified: session.updatedAt,
            cwd: session.dir,
            gitBranch: 'main',
        };
    }

    async *#run(
        session: FakeSession,
        prompt: AsyncIterable<InputMessage>,
        record: FakeQueryRecord,
        onInterrupt: (open: () => void) => void,
    ): AsyncGenerator<Record<string, unknown>, void> {
        const base = { session_id: session.id, parent_tool_use_id: null };
        for await (const input of prompt) {
            if (record.closed) return;
            const text = textOf(input.message.content);
            session.entries.push({
                type: 'user',
                uuid: input.uuid ?? randomUUID(),
                session_id: session.id,
                message: input.message,
                parent_tool_use_id: null,
                timestamp: new Date().toISOString(),
            });
            session.updatedAt = Date.now();

            yield { type: 'system', subtype: 'init', ...base, uuid: randomUUID() };
            yield { type: 'system', subtype: 'session_state_changed', state: 'running', ...base };
            const messageId = `msg_${randomUUID()}`;
            const reply = this.reply(text);
            const half = Math.ceil(reply.length / 2);
            yield {
                type: 'stream_event',
                ...base,
                event: { type: 'message_start', message: { id: messageId } },
            };
            yield {
                type: 'stream_event',
                ...base,
                event: {
                    type: 'content_block_start',
                    index: 0,
                    content_block: { type: 'text', text: '' },
                },
            };
            yield {
                type: 'stream_event',
                ...base,
                event: {
                    type: 'content_block_delta',
                    index: 0,
                    delta: { type: 'text_delta', text: reply.slice(0, half) },
                },
            };

            if (this.crashNextTurn) {
                this.crashNextTurn = false;
                throw new Error('Claude Code process exited with code 1');
            }
            let interrupted = false;
            if (this.holdTurns) {
                await new Promise<void>(open => {
                    this.#gates.add(open);
                    onInterrupt(() => {
                        interrupted = true;
                        open();
                    });
                });
            }
            if (record.closed) return;

            const sent = interrupted ? reply.slice(0, half) : reply;
            if (!interrupted) {
                yield {
                    type: 'stream_event',
                    ...base,
                    event: {
                        type: 'content_block_delta',
                        index: 0,
                        delta: { type: 'text_delta', text: reply.slice(half) },
                    },
                };
            }
            const assistant = {
                type: 'assistant',
                ...base,
                uuid: randomUUID(),
                message: {
                    id: messageId,
                    role: 'assistant',
                    content: [{ type: 'text', text: sent }],
                },
                ...(interrupted ? { aborted: true } : {}),
            };
            session.entries.push({ ...assistant, timestamp: new Date().toISOString() });
            session.updatedAt = Date.now();
            yield assistant;
            yield interrupted
                ? {
                      type: 'result',
                      subtype: 'error_during_execution',
                      is_error: true,
                      errors: [],
                      ...base,
                  }
                : { type: 'result', subtype: 'success', is_error: false, result: sent, ...base };
            yield { type: 'system', subtype: 'session_state_changed', state: 'idle', ...base };
        }
    }
}

function textOf(content: InputMessage['message']['content']): string {
    if (typeof content === 'string') return content;
    return content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n\n');
}
