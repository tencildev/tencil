import { describe, expect, it } from 'vitest';
import { projectPath, resolvePath, taggedFrames } from './element-context.ts';

describe('projectPath', () => {
    it.each([
        ['http://localhost:5173/src/components/Card.tsx?t=123', 'src/components/Card.tsx'],
        ['http://localhost:5173/@fs/Users/me/app/src/App.tsx', '/Users/me/app/src/App.tsx'],
        ['webpack-internal:///./src/App.tsx', 'src/App.tsx'],
        ['webpack-internal:///(app-pages-browser)/./app/page.tsx', 'app/page.tsx'],
        ['turbopack:///[project]/app/page.tsx', '[project]/app/page.tsx'],
        ['file:///Users/me/app/src/App.tsx', '/Users/me/app/src/App.tsx'],
        ['/src/App.tsx', 'src/App.tsx'],
    ])('%s → %s', (input, expected) => {
        expect(projectPath(input)).toBe(expected);
    });
});

describe('resolvePath', () => {
    it('restores the directory from the served path', () => {
        expect(resolvePath('Hero.tsx', 'src/components/Hero.tsx')).toBe('src/components/Hero.tsx');
    });
    it('keeps symbolicated paths that already have a directory', () => {
        expect(resolvePath('app/page.tsx', 'chunks/app.js')).toBe('app/page.tsx');
    });
    it('ignores unrelated raw paths', () => {
        expect(resolvePath('Hero.tsx', 'chunks/main.js')).toBe('Hero.tsx');
    });
});

/** Just enough of an element for `taggedFrames`. */
function element(attributes: Record<string, string>, parent: Element | null = null): Element {
    return {
        getAttribute: (name: string) => attributes[name] ?? null,
        parentElement: parent,
    } as unknown as Element;
}

describe('taggedFrames', () => {
    it('reads the components a preview build tagged, innermost first', () => {
        const page = element({
            'data-tencil-src': 'src/app.tsx:9:5',
            'data-tencil-component': 'App',
        });
        const card = element(
            { 'data-tencil-src': 'src/card.tsx:4:9', 'data-tencil-component': 'Card' },
            page,
        );
        const wrapper = element({}, card);
        const title = element(
            { 'data-tencil-src': 'src/card.tsx:5:13', 'data-tencil-component': 'Card' },
            wrapper,
        );
        expect(taggedFrames(title)).toEqual([
            { name: 'Card', source: { file: 'src/card.tsx', line: 5, column: 13 } },
            { name: 'App', source: { file: 'src/app.tsx', line: 9, column: 5 } },
        ]);
    });

    it('names a frame after its file outside components, and ignores other values', () => {
        const root = element({ 'data-tencil-src': 'src/main.tsx:3:1' });
        expect(taggedFrames(element({ 'data-tencil-src': 'nonsense' }, root))).toEqual([
            { name: 'main.tsx', source: { file: 'src/main.tsx', line: 3, column: 1 } },
        ]);
        expect(taggedFrames(element({}))).toEqual([]);
    });
});
