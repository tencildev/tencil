import { describe, expect, it } from 'vitest';
import { pickNodes, type Touched } from './area.ts';
import type { Box } from './measure.ts';

const box = (left: number, top: number, width: number, height: number): Box => ({
    left,
    top,
    right: left + width,
    bottom: top + height,
});

const node = (ref: string, rect: Box, children: Touched<string>[] = []): Touched<string> => ({
    ref,
    rect,
    children,
});

describe('pickNodes', () => {
    // A page with a header block and an overview row, each half under the box.
    const page = node('main', box(0, 0, 1000, 800), [
        node('welcome', box(40, 40, 900, 140), [
            node('title', box(40, 40, 400, 50)),
            node('summary', box(40, 100, 450, 40)),
        ]),
        node('overview', box(40, 240, 900, 50), [node('date', box(780, 240, 140, 40))]),
        node('chart', box(40, 320, 900, 400)),
    ]);

    it('lists what the box touches with how much of each is inside, outermost first', () => {
        const { nodes, omitted } = pickNodes(page, box(30, 100, 500, 170));
        expect(nodes.map(picked => [picked.ref, picked.depth])).toEqual([
            ['main', 0],
            ['welcome', 1],
            ['summary', 2],
            ['overview', 1],
        ]);
        expect(nodes.find(picked => picked.ref === 'welcome')?.inside).toBeCloseTo(
            (490 * 80) / (900 * 140),
        );
        expect(nodes.find(picked => picked.ref === 'summary')?.parent).toBe(false);
        expect(omitted).toBe(0);
    });

    it('leaves out elements that barely reach into the box', () => {
        const { nodes } = pickNodes(page, box(30, 30, 920, 295));
        // The chart pokes 5px into the bottom of a 295px box: under 2% of it.
        expect(nodes.map(picked => picked.ref)).not.toContain('chart');
    });

    it('keeps the top of the tree when there are too many, and counts the rest', () => {
        const { nodes, omitted } = pickNodes(page, box(0, 0, 1000, 800), { maxNodes: 3 });
        expect(nodes.map(picked => picked.ref)).toEqual(['main', 'welcome', 'overview']);
        // Title, summary and chart; the date button covers too little of the page to count.
        expect(omitted).toBe(3);
    });

    it("doesn't spend depth on wrappers the same size as their parent", () => {
        const deep = node('root', box(0, 0, 100, 100), [
            node('wrapper', box(0, 0, 100, 100), [
                node('inner', box(0, 0, 100, 100), [node('leaf', box(10, 10, 50, 50))]),
            ]),
        ]);
        const { nodes } = pickNodes(deep, box(0, 0, 100, 100), { maxDepth: 1 });
        expect(nodes.map(picked => [picked.ref, picked.depth])).toEqual([
            ['root', 0],
            ['wrapper', 1],
            ['inner', 2],
            ['leaf', 3],
        ]);
    });
});
