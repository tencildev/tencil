import { describe, expect, it } from 'vitest';
import { V1ThreadTracker } from './v1.ts';
import { V2ThreadTracker } from './v2.ts';

const at = '2026-10-07T10:00:00.000Z';

describe('V1ThreadTracker', () => {
    it('appends streaming deltas and takes the final text', () => {
        const tracker = new V1ThreadTracker();
        const sent = (text: string, streaming: boolean) =>
            tracker.apply({
                kind: 'event',
                event: {
                    type: 'thread.message-sent',
                    payload: { messageId: 'm1', role: 'assistant', text, streaming, createdAt: at },
                },
            });
        sent('Hel', true);
        const partial = sent('lo', true);
        expect(partial.messages[0]?.text).toBe('Hello');
        const final = sent('', false);
        expect(final.messages[0]).toMatchObject({ text: 'Hello', streaming: false });
    });

    it('derives status from session updates', () => {
        const tracker = new V1ThreadTracker();
        const session = (status: string, lastError: string | null = null) =>
            tracker.apply({
                kind: 'event',
                event: {
                    type: 'thread.session-set',
                    payload: { session: { status, activeTurnId: 't1', lastError } },
                },
            });
        expect(
            tracker.apply({
                kind: 'event',
                event: { type: 'thread.turn-start-requested', payload: {} },
            }).status?.status,
        ).toBe('working');
        expect(session('running').status).toBeUndefined();
        expect(tracker.activeTurnId()).toBe('t1');
        expect(session('ready').status?.status).toBe('idle');
        expect(session('error', 'boom').status).toEqual({ status: 'error', detail: 'boom' });
    });

    it('hydrates from a snapshot', () => {
        const tracker = new V1ThreadTracker();
        const update = tracker.apply({
            kind: 'snapshot',
            snapshot: {
                thread: {
                    messages: [
                        { id: 'u1', role: 'user', text: 'hi', streaming: false, createdAt: at },
                    ],
                    session: { status: 'running', activeTurnId: 't2', lastError: null },
                    latestTurn: null,
                },
            },
        });
        expect(update.messages).toHaveLength(1);
        expect(update.status?.status).toBe('working');
    });
});

describe('V2ThreadTracker', () => {
    it('uses the latest run for status and merges assistant turn items', () => {
        const tracker = new V2ThreadTracker();
        tracker.apply({
            kind: 'event',
            sequence: 1,
            event: { type: 'run.created', payload: { id: 'r1', ordinal: 1, status: 'running' } },
        });
        expect(tracker.status().status).toBe('working');
        expect(tracker.activeTurnId()).toBe('r1');
        const item = tracker.apply({
            kind: 'event',
            sequence: 2,
            event: {
                type: 'turn-item.updated',
                payload: {
                    type: 'assistant_message',
                    messageId: 'a1',
                    text: 'Done',
                    streaming: false,
                },
            },
        });
        expect(item.messages[0]).toMatchObject({ id: 'a1', role: 'assistant', text: 'Done' });
        const finished = tracker.apply({
            kind: 'event',
            sequence: 3,
            event: { type: 'run.updated', payload: { id: 'r1', ordinal: 1, status: 'completed' } },
        });
        expect(finished.status?.status).toBe('idle');
    });

    it('stays working while a finished run saves its checkpoint', () => {
        const tracker = new V2ThreadTracker();
        const run = (status: string) =>
            tracker.apply({
                kind: 'event',
                sequence: 1,
                event: { type: 'run.updated', payload: { id: 'r1', ordinal: 1, status } },
            });
        run('running');
        expect(run('waiting').status).toBeUndefined();
        expect(tracker.status().status).toBe('working');
        expect(run('completed').status?.status).toBe('idle');
    });

    it('waits on pending approvals and questions from the current run', () => {
        const tracker = new V2ThreadTracker();
        const request = (id: string, kind: string, status: string, createdAt: string) =>
            tracker.apply({
                kind: 'event',
                sequence: 1,
                event: {
                    type: 'runtime-request.updated',
                    payload: { id, kind, status, createdAt },
                },
            });
        tracker.apply({
            kind: 'snapshot',
            projection: {
                runs: [
                    { id: 'r1', ordinal: 1, status: 'interrupted', requestedAt: at },
                    {
                        id: 'r2',
                        ordinal: 2,
                        status: 'running',
                        requestedAt: '2026-10-07T10:05:00.000Z',
                    },
                ],
                // Left pending when r1 was stopped.
                runtimeRequests: [
                    { id: 'q0', kind: 'file-change', status: 'pending', createdAt: at },
                ],
            },
        });
        expect(tracker.status().status).toBe('working');

        expect(
            request('q1', 'auth_refresh', 'pending', '2026-10-07T10:06:00.000Z').status,
        ).toBeUndefined();
        expect(request('q2', 'command', 'pending', '2026-10-07T10:06:00.000Z').status).toEqual({
            status: 'waiting',
            detail: 'Waiting for approval in T3 Code',
        });
        expect(
            request('q2', 'command', 'resolved', '2026-10-07T10:06:00.000Z').status?.status,
        ).toBe('working');
        expect(request('q3', 'user_input', 'pending', '2026-10-07T10:07:00.000Z').status).toEqual({
            status: 'waiting',
            detail: 'Waiting for your answer in T3 Code',
        });
    });
});
