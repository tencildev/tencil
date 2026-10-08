import type { Thread } from '@tencil/protocol';
import { describe, expect, it } from 'vitest';
import { mergeMessage } from './bridge.ts';
import { renderPrompt, stripContext } from './prompt.ts';

const context = {
    tagName: 'button',
    selector: 'article > button',
    html: '<button class="button">Choose Pro</button>',
    text: 'Choose Pro',
    components: [
        {
            name: 'PricingCard',
            source: { file: 'src/components/PricingCard.tsx', line: 21, column: 6 },
        },
        { name: 'App', source: { file: 'src/App.tsx', line: 18 } },
    ],
    rect: { x: 10, y: 20, width: 210, height: 42 },
    viewport: { width: 1280, height: 800, dpr: 2 },
};

describe('prompt', () => {
    it("puts the user's words first and the context in a strippable block", () => {
        const text = renderPrompt({
            prompt: 'Make it red',
            pageUrl: 'http://localhost:3000/',
            context,
            hasScreenshot: true,
        });
        expect(text.startsWith('Make it red\n\n<tencil-context>')).toBe(true);
        expect(text).toContain(
            'PricingCard (src/components/PricingCard.tsx:21:6) ← App (src/App.tsx:18)',
        );
        expect(stripContext(text)).toBe('Make it red');
    });
});

describe('mergeMessage', () => {
    const thread: Thread = {
        id: 'p1',
        title: 't',
        pageUrl: 'http://localhost:3000/',
        anchor: { selector: 'button', offsetX: 0.5, offsetY: 0.5 },
        context,
        status: 'working',
        resolved: false,
        messages: [
            {
                id: 'local:1',
                role: 'user',
                text: 'Make it red',
                streaming: false,
                createdAt: '2026-10-07T10:00:00.000Z',
            },
        ],
        provider: { id: 't3code', threadId: 'x' },
        createdAt: '2026-10-07T10:00:00.000Z',
        updatedAt: '2026-10-07T10:00:00.000Z',
    };

    it("replaces the optimistic echo with the provider's user message", () => {
        const merged = mergeMessage(thread, {
            id: 'm1',
            role: 'user',
            text: renderPrompt({
                prompt: 'Make it red',
                pageUrl: 'http://localhost:3000/',
                context,
                hasScreenshot: false,
            }),
            streaming: false,
            createdAt: '2026-10-07T10:00:01.000Z',
        });
        expect(merged.messages).toEqual([
            expect.objectContaining({ id: 'm1', text: 'Make it red' }),
        ]);
    });

    it('updates streaming assistant messages in place', () => {
        const first = mergeMessage(thread, {
            id: 'a1',
            role: 'assistant',
            text: 'Wor',
            streaming: true,
            createdAt: '2026-10-07T10:00:02.000Z',
        });
        const second = mergeMessage(first, {
            id: 'a1',
            role: 'assistant',
            text: 'Working',
            streaming: false,
            createdAt: '2026-10-07T10:00:02.000Z',
        });
        expect(second.messages.filter(m => m.role === 'assistant')).toEqual([
            expect.objectContaining({ text: 'Working', streaming: false }),
        ]);
    });
});
