import { afterEach, describe, expect, it, vi } from 'vitest';
import { overlayLoader } from './loader.ts';
import { Tencil } from './react.ts';
import tencil from './vite.ts';

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('vite plugin', () => {
    it('adds the loader to index.html and to the Vite client only', () => {
        const plugin = tencil({ port: 4800 });
        expect(plugin.transformIndexHtml()).toEqual([
            { tag: 'script', children: overlayLoader(4800), injectTo: 'body' },
        ]);
        expect(plugin.transform('x', '/app/src/main.tsx')).toBeUndefined();
        expect(
            plugin.transform('client();', '/app/node_modules/vite/dist/client/client.mjs'),
        ).toContain(overlayLoader(4800));
    });
});

describe('<Tencil />', () => {
    it('renders the inline loader in development only', () => {
        vi.stubEnv('NODE_ENV', 'development');
        const element = Tencil({ port: 4800 });
        expect(element?.type).toBe('script');
        expect(element?.props).toMatchObject({
            dangerouslySetInnerHTML: { __html: overlayLoader(4800) },
        });

        vi.stubEnv('NODE_ENV', 'production');
        expect(Tencil({})).toBeNull();
    });
});
