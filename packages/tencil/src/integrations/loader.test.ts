import { describe, expect, it } from 'vitest';
import { overlayLoader } from './loader.ts';

/** Runs the loader against a fake page served from `hostname`. */
function page(hostname: string) {
    const appended: Array<{ src: string; async: boolean }> = [];
    const document = {
        querySelector: (selector: string) =>
            appended.find(s => selector.includes(`"${s.src}"`)) ?? null,
        createElement: () => ({ src: '', async: false }),
        head: { appendChild: (script: { src: string; async: boolean }) => appended.push(script) },
    };
    const run = (code: string) =>
        new Function('document', 'location', code)(document, { hostname });
    return { appended, run };
}

describe('overlay loader', () => {
    it('is valid JavaScript', () => {
        expect(() => new Function(overlayLoader())).not.toThrow();
    });

    it('loads the overlay from the daemon on the host serving the page, once', () => {
        const local = page('localhost');
        local.run(overlayLoader());
        local.run(overlayLoader());
        expect(local.appended).toEqual([{ src: 'http://localhost:4747/tencil.js', async: true }]);

        const devbox = page('devbox');
        devbox.run(overlayLoader(4800));
        expect(devbox.appended).toEqual([{ src: 'http://devbox:4800/tencil.js', async: true }]);
    });
});
