import { describe, expect, it } from 'vitest';
import type { SessionUpdate } from './protocol.ts';
import { stopStatus, Transcript } from './transcript.ts';

const text = (sessionUpdate: string, value: string) =>
    ({ sessionUpdate, content: { type: 'text', text: value } }) as SessionUpdate;
const agent = (value: string) => text('agent_message_chunk', value);
const user = (value: string) => text('user_message_chunk', value);
const tool = (toolCallId: string, extra: Record<string, unknown> = {}) =>
    ({
        sessionUpdate: 'tool_call',
        toolCallId,
        title: `Tool ${toolCallId}`,
        ...extra,
    }) as SessionUpdate;

/** Two turns as Tencil sees them live. */
function live(): Transcript {
    const transcript = new Transcript(() => '/repo');
    transcript.prompt('First');
    transcript.apply(agent('One'));
    transcript.apply(tool('a'));
    transcript.apply(agent('Two'));
    transcript.finish({ status: 'idle' });
    transcript.prompt('Second');
    transcript.apply(agent('Three'));
    transcript.finish({ status: 'idle' });
    return transcript;
}

describe('transcript', () => {
    it('makes one reply per turn, with text around tool calls as paragraphs', () => {
        expect(
            live()
                .messages()
                .map(m => [m.id, m.role, m.text, m.streaming]),
        ).toEqual([
            ['1:user', 'user', 'First', false],
            ['1:agent', 'assistant', 'One\n\nTwo', false],
            ['2:user', 'user', 'Second', false],
            ['2:agent', 'assistant', 'Three', false],
        ]);
    });

    it('rebuilds the same messages from a replay, keeping the times they were seen at', () => {
        const transcript = live();
        const before = transcript.messages();
        transcript.beginReplay();
        for (const update of [
            user('First'),
            agent('One'),
            tool('a'),
            agent('Two'),
            user('Second'),
            agent('Three'),
        ]) {
            transcript.apply(update);
        }
        expect(transcript.endReplay()).toEqual(before);
        expect(transcript.status()).toEqual({ status: 'idle' });
        expect(transcript.steps()).toEqual([]);
    });

    it('joins a prompt replayed in several chunks into one message', () => {
        const transcript = new Transcript(() => '/repo');
        transcript.beginReplay();
        transcript.apply({ sessionUpdate: 'user_message_chunk', content: { type: 'image' } });
        transcript.apply(user('Look '));
        transcript.apply(user('here'));
        transcript.apply(agent('Seen'));
        expect(transcript.endReplay(10_000).map(m => [m.id, m.text, m.createdAt])).toEqual([
            ['1:user', 'Look here', new Date(9_998).toISOString()],
            ['1:agent', 'Seen', new Date(9_999).toISOString()],
        ]);
    });

    it('tells prompts without a reply between them apart by their message ids', () => {
        const transcript = new Transcript(() => '/repo');
        transcript.beginReplay();
        transcript.apply({ ...user('One'), messageId: 'a' } as SessionUpdate);
        transcript.apply({ ...user(' more'), messageId: 'a' } as SessionUpdate);
        transcript.apply({ ...user('Two'), messageId: 'b' } as SessionUpdate);
        expect(transcript.endReplay().map(m => [m.id, m.text])).toEqual([
            ['1:user', 'One more'],
            ['2:user', 'Two'],
        ]);
    });

    it('keeps the conversation when a replay fails', () => {
        const transcript = live();
        const before = transcript.messages();
        transcript.beginReplay();
        transcript.apply(user('Something else'));
        transcript.abortReplay();
        expect(transcript.messages()).toEqual(before);
        transcript.prompt('Third');
        expect(transcript.messages().at(-1)?.id).toBe('3:user');
    });

    it('starts new ids when it continues a conversation it never saw', () => {
        const transcript = new Transcript(() => '/repo');
        transcript.continueUnseen();
        const { messages } = transcript.prompt('Again');
        expect(messages[0]?.id).toMatch(/^[0-9a-f]{8}-1:user$/);
    });

    it('updates a tool call with only the fields that changed', () => {
        const transcript = new Transcript(() => '/repo');
        transcript.prompt('Go');
        transcript.apply(tool('a', { kind: 'edit', status: 'in_progress' }));
        const { steps } = transcript.apply({
            sessionUpdate: 'tool_call_update',
            toolCallId: 'a',
            title: null,
            status: 'completed',
        } as SessionUpdate);
        expect(steps).toEqual([
            expect.objectContaining({ id: '1:tool-a', label: 'Tool a', status: 'done' }),
        ]);
    });

    it('marks what a turn left running as skipped when it ends', () => {
        const transcript = new Transcript(() => '/repo');
        transcript.prompt('Go');
        transcript.apply(tool('a', { status: 'in_progress' }));
        transcript.apply(agent('Half'));
        const { messages, steps, status } = transcript.finish({ status: 'idle' });
        expect(messages.map(m => m.streaming)).toEqual([false]);
        expect(steps.map(s => s.status)).toEqual(['skipped']);
        expect(status).toEqual({ status: 'idle' });
    });

    it('says why a turn stopped early', () => {
        expect(stopStatus('end_turn', 'Devin')).toEqual({ status: 'idle' });
        expect(stopStatus('cancelled', 'Devin')).toEqual({ status: 'idle' });
        expect(stopStatus('refusal', 'Devin')).toEqual({
            status: 'error',
            detail: 'Devin refused to go on',
        });
        expect(stopStatus('max_turn_requests', 'Devin').status).toBe('error');
    });
});
