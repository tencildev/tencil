import type { SDKMessage, SessionMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import { messagesFromTranscript, TurnTracker } from './transcript.ts';

const base = { session_id: 's', uuid: 'u', parent_tool_use_id: null };
const stream = (event: unknown, parent: string | null = null) =>
    ({ type: 'stream_event', ...base, parent_tool_use_id: parent, event }) as SDKMessage;
const assistant = (id: string, content: unknown[], parent: string | null = null) =>
    ({
        type: 'assistant',
        ...base,
        parent_tool_use_id: parent,
        message: { id, content },
    }) as SDKMessage;
const result = (fields: Record<string, unknown>) =>
    ({ type: 'result', ...base, ...fields }) as unknown as SDKMessage;

describe('TurnTracker', () => {
    it('builds one message per API message from text blocks around tool calls', () => {
        const tracker = new TurnTracker();
        tracker.apply(stream({ type: 'message_start', message: { id: 'm1' } }));
        tracker.apply(
            stream({ type: 'content_block_start', content_block: { type: 'text', text: '' } }),
        );
        const partial = tracker.apply(
            stream({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Look' } }),
        );
        expect(partial.messages).toEqual([
            expect.objectContaining({ id: 'm1', text: 'Look', streaming: true }),
        ]);

        tracker.apply(assistant('m1', [{ type: 'text', text: 'Looking.' }]));
        const tool = tracker.apply(
            assistant('m1', [{ type: 'tool_use', id: 't', name: 'Read', input: {} }]),
        );
        expect(tool.messages.at(-1)?.text).toBe('Looking.');

        const next = tracker.apply(stream({ type: 'message_start', message: { id: 'm2' } }));
        expect(next.messages).toEqual([expect.objectContaining({ id: 'm1', streaming: false })]);
        tracker.apply(assistant('m2', [{ type: 'text', text: 'Fixed.' }]));

        const end = tracker.apply(
            result({ subtype: 'success', is_error: false, result: 'Fixed.' }),
        );
        expect(end).toMatchObject({ turnEnded: true, status: { status: 'idle' } });
        expect(end.messages).toEqual([
            expect.objectContaining({ id: 'm2', text: 'Fixed.', streaming: false }),
        ]);
    });

    it('skips subagent output', () => {
        const tracker = new TurnTracker();
        const update = tracker.apply(
            assistant('sub', [{ type: 'text', text: 'inner' }], 'toolu_1'),
        );
        expect(update.messages).toEqual([]);
    });

    it('reports failed turns with their errors', () => {
        const tracker = new TurnTracker();
        expect(
            tracker.apply(result({ subtype: 'error_max_turns', is_error: true, errors: [] }))
                .status,
        ).toEqual({ status: 'error', detail: 'error max turns' });
        expect(
            tracker.apply(result({ subtype: 'success', is_error: true, result: 'API Error: 529' }))
                .status,
        ).toEqual({ status: 'error', detail: 'API Error: 529' });
    });

    it('stays working while queued messages follow', () => {
        const tracker = new TurnTracker();
        const update = tracker.apply(
            result({ subtype: 'success', is_error: false, result: '', queued_turn_count: 1 }),
        );
        expect(update.status).toEqual({ status: 'working' });
    });

    it('flags a missing login', () => {
        const tracker = new TurnTracker();
        const update = tracker.apply({
            ...assistant('m', [{ type: 'text', text: 'Not logged in' }]),
            error: 'authentication_failed',
        } as SDKMessage);
        expect(update.unauthorized).toMatch(/log in/);
    });

    it("doesn't let the idle signal hide an error", () => {
        const tracker = new TurnTracker();
        tracker.apply(
            result({ subtype: 'error_during_execution', is_error: true, errors: ['boom'] }),
        );
        const idle = tracker.apply({
            type: 'system',
            subtype: 'session_state_changed',
            state: 'idle',
            ...base,
        } as SDKMessage);
        expect(idle.status).toBeUndefined();
        expect(tracker.status()).toEqual({ status: 'error', detail: 'boom' });
    });
});

describe('messagesFromTranscript', () => {
    const entry = (fields: Record<string, unknown>) =>
        ({ ...base, parent_agent_id: null, ...fields }) as unknown as SessionMessage;

    it('keeps typed messages and joins assistant blocks by message id', () => {
        const messages = messagesFromTranscript([
            entry({
                type: 'user',
                uuid: 'u1',
                timestamp: '2026-01-01T00:00:00.000Z',
                message: {
                    role: 'user',
                    content: [{ type: 'image' }, { type: 'text', text: 'Fix it' }],
                },
            }),
            entry({
                type: 'assistant',
                uuid: 'a1',
                timestamp: '2026-01-01T00:00:01.000Z',
                message: { id: 'm1', content: [{ type: 'thinking', thinking: '' }] },
            }),
            entry({
                type: 'assistant',
                uuid: 'a2',
                timestamp: '2026-01-01T00:00:02.000Z',
                message: { id: 'm1', content: [{ type: 'text', text: 'On it.' }] },
            }),
            entry({
                type: 'assistant',
                uuid: 'a3',
                message: { id: 'm1', content: [{ type: 'tool_use', id: 't1' }] },
            }),
            entry({
                type: 'user',
                uuid: 'u2',
                message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1' }] },
            }),
            entry({
                type: 'assistant',
                uuid: 'a4',
                message: { id: 'm1', content: [{ type: 'text', text: 'Done.' }] },
            }),
            entry({
                type: 'assistant',
                uuid: 'a5',
                parent_tool_use_id: 't1',
                message: { id: 'sub', content: [{ type: 'text', text: 'subagent' }] },
            }),
        ]);
        expect(messages).toEqual([
            {
                id: 'u1',
                role: 'user',
                text: 'Fix it',
                streaming: false,
                createdAt: '2026-01-01T00:00:00.000Z',
            },
            {
                id: 'm1',
                role: 'assistant',
                text: 'On it.\n\nDone.',
                streaming: false,
                createdAt: '2026-01-01T00:00:02.000Z',
            },
        ]);
    });
});
