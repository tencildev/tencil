import { describe, expect, it } from 'vitest';
import type { ToolCall } from './protocol.ts';
import { planLabel, thoughtLabel, toolLabel } from './tool-steps.ts';

const CWD = '/private/tmp/site';
const label = (call: Omit<ToolCall, 'toolCallId'>) => toolLabel({ toolCallId: 't', ...call }, CWD);

describe('tool steps', () => {
    it("keeps the agent's own title, in plain text", () => {
        expect(label({ title: 'Read `src/hero.tsx`', kind: 'read' })).toEqual({
            label: 'Read src/hero.tsx',
        });
        expect(label({ title: '`pnpm test`', kind: 'execute' })).toEqual({ label: 'pnpm test' });
    });

    it('says what was done to which file when the title only names the tool or the file', () => {
        const file = [{ path: `${CWD}/index.html` }];
        expect(label({ title: 'read', kind: 'read', locations: file })).toEqual({
            label: 'Read index.html',
        });
        expect(label({ title: 'index.html', kind: 'edit' })).toEqual({ label: 'Edit index.html' });
        expect(label({ title: 'edit', kind: 'edit' })).toEqual({ label: 'Edit' });
        expect(label({ kind: 'delete', locations: file })).toEqual({ label: 'Delete index.html' });
        expect(label({ title: 'Write file', locations: file })).toEqual({
            label: 'Write file index.html',
        });
    });

    it("leaves out a location that's just the checkout, however it's written", () => {
        for (const path of [CWD, '/tmp/site', '/tmp']) {
            expect(label({ title: 'bash', kind: 'execute', locations: [{ path }] })).toEqual({
                label: 'bash',
            });
        }
    });

    it('puts the rest of a long title, or the file it leaves out, in the detail', () => {
        const long =
            'Run the whole test suite with coverage and the slow integration tests enabled';
        expect(label({ title: long, kind: 'execute' })).toEqual({
            label: `${long.slice(0, 59)}…`,
            detail: long,
        });
        expect(
            label({
                title: 'Apply the requested change',
                locations: [{ path: '/tmp/site/src/a.ts' }],
            }),
        ).toEqual({ label: 'Apply the requested change', detail: 'src/a.ts' });
    });

    it('says why a call failed', () => {
        expect(
            label({
                title: 'pnpm test',
                kind: 'execute',
                status: 'failed',
                content: [{ type: 'content', content: { type: 'text', text: 'Exit 1\nmore' } }],
            }),
        ).toEqual({ label: 'pnpm test', detail: 'Exit 1' });
    });

    it('shows the first line of a thought and how far a plan is', () => {
        expect(thoughtLabel('## **Looking around**\n\nmore', false)).toEqual({
            label: 'Thinking',
            detail: 'Looking around',
        });
        expect(thoughtLabel('  ', true)).toBeUndefined();
        expect(
            planLabel([
                { content: 'One', status: 'completed' },
                { content: 'Two', status: 'pending' },
            ]),
        ).toEqual({ label: 'Plan: 1 of 2 done', status: 'running', detail: 'Two' });
        expect(planLabel([{ content: 'One', status: 'completed' }]).status).toBe('done');
    });
});
