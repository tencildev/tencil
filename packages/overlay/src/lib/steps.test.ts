import type { ThreadStep } from '@tencildev/protocol';
import { describe, expect, it } from 'vitest';
import { clock, duration, elapsed, summary } from './steps.ts';

const step = (fields: Partial<ThreadStep>): ThreadStep => ({
    id: 's',
    label: 'Step',
    status: 'done',
    startedAt: '2026-11-13T10:00:00.000Z',
    ...fields,
});

describe('summary', () => {
    it('counts up to three kinds in words', () => {
        expect(
            summary([
                step({ kind: 'read' }),
                step({ kind: 'read' }),
                step({ kind: 'edit' }),
                step({ kind: 'command' }),
            ]),
        ).toBe('Read 2 files, edited 1 file, ran 1 command');
        expect(summary([step({ kind: 'search' })])).toBe('Searched once');
    });

    it('falls back to a step count for more kinds or steps without one', () => {
        expect(summary([step({}), step({ kind: 'read' })])).toBe('2 steps');
        expect(
            summary([
                step({ kind: 'read' }),
                step({ kind: 'edit' }),
                step({ kind: 'command' }),
                step({ kind: 'web' }),
            ]),
        ).toBe('4 steps');
        expect(summary([step({})])).toBe('1 step');
    });
});

describe('duration', () => {
    it('shows tenths under ten seconds and minutes past one', () => {
        expect(duration(step({ endedAt: '2026-11-13T10:00:02.340Z' }))).toBe('2.3s');
        expect(duration(step({ endedAt: '2026-11-13T10:00:42.000Z' }))).toBe('42s');
        expect(duration(step({ endedAt: '2026-11-13T10:01:05.000Z' }))).toBe('1m 05s');
    });

    it('is empty while running or when too short to matter', () => {
        expect(duration(step({ status: 'running' }))).toBe('');
        expect(duration(step({ endedAt: '2026-11-13T10:00:00.050Z' }))).toBe('');
    });
});

describe('elapsed', () => {
    it('runs from the first start to the latest end', () => {
        expect(
            elapsed([
                step({ endedAt: '2026-11-13T10:00:20.000Z' }),
                step({
                    startedAt: '2026-11-13T10:00:05.000Z',
                    endedAt: '2026-11-13T10:00:13.000Z',
                }),
            ]),
        ).toBe('20s');
        expect(elapsed([step({ status: 'running' })])).toBe('');
        expect(elapsed([])).toBe('');
    });
});

describe('clock', () => {
    it('reads m:ss and never goes negative', () => {
        expect(clock(75_400)).toBe('1:15');
        expect(clock(-500)).toBe('0:00');
    });
});
