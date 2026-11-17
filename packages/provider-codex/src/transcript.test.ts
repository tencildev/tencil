import { describe, expect, it } from 'vitest';
import { messagesFromHistory, TurnTracker } from './transcript.ts';

const NOW = '2026-11-06T12:00:00.000Z';
const turn = (status: string, error: unknown = null) => ({ turn: { id: 't1', status, error } });

describe('TurnTracker', () => {
    it('streams an agent message by its item id, cumulatively', () => {
        const tracker = new TurnTracker();
        tracker.apply('turn/started', turn('inProgress'), NOW);
        expect(tracker.activeTurn()).toBe('t1');
        const started = tracker.apply(
            'item/started',
            { item: { type: 'agentMessage', id: 'msg_1', text: '' }, startedAtMs: 1000 },
            NOW,
        );
        expect(started.messages).toEqual([]);
        const first = tracker.apply('item/agentMessage/delta', { itemId: 'msg_1', delta: 'He' });
        const second = tracker.apply('item/agentMessage/delta', { itemId: 'msg_1', delta: 'llo' });
        expect(first.messages[0]).toMatchObject({ text: 'He', streaming: true });
        expect(second.messages[0]).toMatchObject({
            id: 'msg_1',
            role: 'assistant',
            text: 'Hello',
            streaming: true,
            createdAt: new Date(1000).toISOString(),
        });
        const done = tracker.apply(
            'item/completed',
            { item: { type: 'agentMessage', id: 'msg_1', text: 'Hello!' } },
            NOW,
        );
        expect(done.messages[0]).toMatchObject({
            text: 'Hello!',
            streaming: false,
            createdAt: new Date(1000).toISOString(),
        });
    });

    it('settles on the way a turn ended', () => {
        const tracker = new TurnTracker();
        tracker.apply('turn/started', turn('inProgress'));
        expect(tracker.status().status).toBe('working');
        expect(tracker.apply('turn/completed', turn('completed')).status).toEqual({
            status: 'idle',
        });
        expect(tracker.activeTurn()).toBeUndefined();
        expect(tracker.apply('turn/completed', turn('interrupted')).status).toEqual({
            status: 'idle',
        });
        expect(
            tracker.apply('turn/completed', turn('failed', { message: 'Too long' })).status,
        ).toEqual({ status: 'error', detail: 'Too long' });
    });

    it('closes a message and steps still open when a turn ends', () => {
        const tracker = new TurnTracker();
        tracker.apply('item/started', { item: { type: 'agentMessage', id: 'm', text: '' } }, NOW);
        tracker.apply('item/agentMessage/delta', { itemId: 'm', delta: 'Part' });
        tracker.apply(
            'item/started',
            { item: { type: 'commandExecution', id: 'c', command: 'sleep 20' } },
            NOW,
        );
        const ended = tracker.apply('turn/completed', turn('interrupted'), NOW);
        expect(ended.messages[0]).toMatchObject({ text: 'Part', streaming: false });
        expect(ended.steps).toEqual([
            {
                id: 'c',
                label: 'Running sleep 20',
                status: 'skipped',
                startedAt: NOW,
                endedAt: NOW,
            },
        ]);
    });

    it('starts each turn with no steps, and keeps them for a late watcher until then', () => {
        const tracker = new TurnTracker();
        const command = { type: 'commandExecution', id: 'c', command: 'ls' };
        tracker.apply('item/started', { item: command }, NOW);
        tracker.apply('item/completed', { item: { ...command, status: 'completed' } }, NOW);
        tracker.apply('turn/completed', turn('completed'), NOW);
        expect(tracker.steps().map(step => step.label)).toEqual(['Ran ls']);
        tracker.apply('turn/started', turn('inProgress'), NOW);
        expect(tracker.steps()).toEqual([]);
    });

    it('turns streamed reasoning into a step, and shows none without a summary', () => {
        const tracker = new TurnTracker();
        tracker.apply('item/started', { item: { type: 'reasoning', id: 'r', summary: [] } }, NOW);
        const silent = tracker.apply(
            'item/completed',
            { item: { type: 'reasoning', id: 'r', summary: [] } },
            NOW,
        );
        expect(silent.steps).toEqual([]);

        tracker.apply('item/reasoning/summaryTextDelta', { itemId: 'r2', delta: '**Plan' }, NOW);
        const running = tracker.apply(
            'item/reasoning/summaryTextDelta',
            { itemId: 'r2', delta: 'ning**\n\nDetails' },
            NOW,
        );
        expect(running.steps[0]).toMatchObject({
            label: 'Thinking',
            status: 'running',
            detail: 'Planning',
        });
        const done = tracker.apply(
            'item/completed',
            { item: { type: 'reasoning', id: 'r2', summary: [] } },
            NOW,
        );
        expect(done.steps[0]).toMatchObject({ label: 'Thought', status: 'done' });
    });

    it('labels commands by what they do, without the shell around them', () => {
        const labelOf = (item: Record<string, unknown>) => {
            const tracker = new TurnTracker();
            return tracker.apply(
                'item/completed',
                { item: { type: 'commandExecution', id: 'c', status: 'completed', ...item } },
                NOW,
            ).steps[0];
        };
        expect(labelOf({ command: `/bin/zsh -lc 'echo '\\''hi'\\'''` })?.label).toBe(
            `Ran echo 'hi'`,
        );
        expect(labelOf({ command: 'pwsh -c ls' })?.label).toBe('Ran pwsh -c ls');
        expect(
            labelOf({
                command: 'rg foo',
                commandActions: [{ type: 'search', command: 'rg foo', query: 'foo' }],
            })?.label,
        ).toBe('Searched for foo');
        expect(
            labelOf({
                command: 'ls src',
                commandActions: [{ type: 'listFiles', command: 'ls src', path: 'src' }],
            })?.label,
        ).toBe('Listed src');
        const long = labelOf({ command: `${'x'.repeat(60)}\nsecond line` });
        expect(long?.label).toHaveLength('Ran '.length + 48);
        expect(long?.detail).toContain('second line');
    });

    it('labels file changes by the file, or how many', () => {
        const labelOf = (changes: Array<{ path: string; kind: { type: string } }>) =>
            new TurnTracker().apply(
                'item/completed',
                { item: { type: 'fileChange', id: 'f', status: 'completed', changes } },
                NOW,
            ).steps[0];
        const update = { type: 'update' };
        expect(labelOf([{ path: '/r/a.ts', kind: { type: 'add' } }])?.label).toBe('Created a.ts');
        expect(labelOf([{ path: '/r/a.ts', kind: { type: 'delete' } }])?.label).toBe(
            'Deleted a.ts',
        );
        const many = labelOf([
            { path: '/r/a.ts', kind: update },
            { path: '/r/b.ts', kind: update },
        ]);
        expect(many).toMatchObject({ label: 'Edited 2 files', detail: 'a.ts, b.ts' });
    });

    it('keeps retries working and says so', () => {
        const tracker = new TurnTracker();
        const update = tracker.apply('error', {
            error: { message: 'Stream disconnected' },
            willRetry: true,
        });
        expect(update.status).toEqual({
            status: 'working',
            detail: 'Retrying: Stream disconnected',
        });
    });

    it('recognises being signed out, however Codex words it', () => {
        const unauthorized = (codexErrorInfo: unknown) =>
            new TurnTracker().apply(
                'turn/completed',
                turn('failed', { message: 'x', codexErrorInfo }),
            ).unauthorized;
        expect(unauthorized('unauthorized')).toContain('codex login');
        expect(unauthorized({ responseStreamConnectionFailed: { httpStatusCode: 401 } })).toContain(
            'codex login',
        );
        expect(unauthorized({ httpConnectionFailed: { httpStatusCode: 500 } })).toBeUndefined();
        expect(unauthorized('usageLimitExceeded')).toBeUndefined();
    });

    it('ignores what it has no use for', () => {
        const tracker = new TurnTracker();
        const update = tracker.apply('thread/tokenUsage/updated', { tokenUsage: {} });
        expect(update).toEqual({ messages: [], steps: [] });
        expect(
            tracker.apply('item/started', { item: { type: 'somethingNew', id: 'n' } }, NOW).steps,
        ).toEqual([]);
    });
});

describe('messagesFromHistory', () => {
    it('keeps the conversation, by the ids live messages had', () => {
        const messages = messagesFromHistory(
            [
                {
                    startedAtMs: 1000,
                    item: {
                        type: 'userMessage',
                        id: 'server-id',
                        clientId: 'our-id',
                        content: [
                            { type: 'image', text: undefined },
                            { type: 'text', text: 'Hello' },
                        ],
                    },
                },
                { startedAtMs: 2000, item: { type: 'reasoning', id: 'r', summary: [] } },
                {
                    startedAtMs: 3000,
                    item: { type: 'commandExecution', id: 'c', command: 'ls', status: 'completed' },
                },
                { startedAtMs: 4000, item: { type: 'agentMessage', id: 'msg_1', text: 'Hi' } },
                { startedAtMs: 5000, item: { type: 'agentMessage', id: 'empty', text: '  ' } },
            ],
            NOW,
        );
        expect(messages).toEqual([
            {
                id: 'our-id',
                role: 'user',
                text: 'Hello',
                streaming: false,
                createdAt: new Date(1000).toISOString(),
            },
            {
                id: 'msg_1',
                role: 'assistant',
                text: 'Hi',
                streaming: false,
                createdAt: new Date(4000).toISOString(),
            },
        ]);
    });

    it('uses the item id for messages sent from elsewhere', () => {
        const [message] = messagesFromHistory([
            {
                item: {
                    type: 'userMessage',
                    id: 'server-id',
                    clientId: null,
                    content: [{ type: 'text', text: 'From the CLI' }],
                },
            },
        ]);
        expect(message?.id).toBe('server-id');
    });

    it('keeps items without a time in order', () => {
        const agent = (id: string, startedAtMs: number | null) => ({
            startedAtMs,
            item: { type: 'agentMessage' as const, id, text: id },
        });
        const messages = messagesFromHistory(
            [agent('a', null), agent('b', 5000), agent('c', null), agent('d', 9000)],
            NOW,
        );
        expect(messages.map(message => message.createdAt)).toEqual([
            NOW,
            new Date(5000).toISOString(),
            new Date(5000).toISOString(),
            new Date(9000).toISOString(),
        ]);
    });
});
