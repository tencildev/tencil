import { describe, expect, it } from 'vitest';
import { ToolSteps, toolLabel } from './tool-steps.ts';

describe('toolLabel', () => {
    it('names the file, command or query a tool works on', () => {
        expect(toolLabel('Read', { file_path: '/repo/src/app.tsx' })).toEqual({
            kind: 'read',
            running: 'Reading app.tsx',
            done: 'Read app.tsx',
        });
        expect(toolLabel('Edit', { file_path: 'C:\\repo\\styles.css' })?.done).toBe(
            'Edited styles.css',
        );
        expect(toolLabel('NotebookEdit', { notebook_path: '/a/b.ipynb' })?.done).toBe(
            'Edited b.ipynb',
        );
        expect(
            toolLabel('Bash', { command: 'pnpm test\necho done', description: 'Run the tests' }),
        ).toEqual({
            kind: 'command',
            running: 'Running pnpm test',
            done: 'Ran pnpm test',
            detail: 'Run the tests',
        });
        expect(toolLabel('WebFetch', { url: 'https://example.com/docs' })?.done).toBe(
            'Fetched example.com',
        );
        expect(toolLabel('Task', { description: 'Find the road' })?.running).toBe(
            'Delegating: Find the road',
        );
    });

    it('clips long patterns and commands', () => {
        const label = toolLabel('Bash', { command: 'x'.repeat(100) });
        expect(label?.done).toBe(`Ran ${'x'.repeat(47)}…`);
    });

    it('names MCP tools by their own name and hides bookkeeping', () => {
        expect(toolLabel('mcp__blender__execute_code', {})).toMatchObject({
            kind: 'tool',
            done: 'Used execute_code',
        });
        expect(toolLabel('TodoWrite', { todos: [] })).toBeUndefined();
        expect(toolLabel('ToolSearch', {})).toBeUndefined();
    });

    it('copes with missing or odd input', () => {
        expect(toolLabel('Read', undefined)?.done).toBe('Read ');
        expect(toolLabel('Grep', { pattern: 42 })?.done).toBe('Searched for ');
    });
});

describe('ToolSteps', () => {
    it('starts a step once and finishes it with the done label', () => {
        const steps = new ToolSteps();
        const started = steps.start('t1', 'Read', { file_path: '/a.ts' }, 't0', 'parent');
        expect(started).toEqual({
            id: 't1',
            label: 'Reading a.ts',
            status: 'running',
            kind: 'read',
            parentId: 'parent',
            startedAt: 't0',
        });
        expect(steps.start('t1', 'Read', { file_path: '/a.ts' }, 't0')).toBeUndefined();
        expect(steps.finish('t1', false, 't1')).toMatchObject({
            label: 'Read a.ts',
            status: 'done',
            endedAt: 't1',
        });
        expect(steps.finish('t1', false, 't2')).toBeUndefined();
    });

    it('keeps what a failed call tried', () => {
        const steps = new ToolSteps();
        steps.start('t1', 'Bash', { command: 'pnpm build' }, 't0');
        expect(steps.finish('t1', true, 't1')).toMatchObject({
            label: 'Running pnpm build',
            status: 'failed',
        });
    });

    it('skips hidden tools and the calls left open', () => {
        const steps = new ToolSteps();
        expect(steps.start('t1', 'TodoWrite', {}, 't0')).toBeUndefined();
        expect(steps.finish('t1', false, 't1')).toBeUndefined();
        steps.start('t2', 'Bash', { command: 'sleep 60' }, 't0');
        expect(steps.abandon('t9')).toEqual([
            expect.objectContaining({ id: 't2', status: 'skipped', endedAt: 't9' }),
        ]);
        expect(steps.abandon('t10')).toEqual([]);
    });
});
