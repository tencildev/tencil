import { describe, expect, it } from 'vitest';
import fixhere, { overlayLoader } from './vite.ts';

describe('vite plugin', () => {
    it('generates a loader that is valid JavaScript and loads the overlay once', () => {
        const code = overlayLoader('http://localhost:4747/fixhere.js');
        expect(() => new Function(code)).not.toThrow();

        const appended: Array<{ src: string }> = [];
        const document = {
            querySelector: (selector: string) =>
                appended.find(s => selector.includes(s.src)) ?? null,
            createElement: () => ({ src: '', async: false }),
            head: { appendChild: (script: { src: string }) => appended.push(script) },
        };
        const run = new Function('document', code);
        run(document);
        run(document);
        expect(appended).toEqual([{ src: 'http://localhost:4747/fixhere.js', async: true }]);
    });

    it('only touches the Vite client module', () => {
        const plugin = fixhere();
        expect(plugin.transform('x', '/app/src/main.tsx')).toBeUndefined();
    });
});
