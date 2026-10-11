import { afterEach, describe, expect, it, vi } from 'vitest';
import { overlayLoader } from './loader.ts';
import { Tencil } from './react.ts';
import tencil from './vite.ts';

afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

const CLOUD_PREVIEW = {
    TENCIL_CLOUD: 'proj_3fK9xQ2mVb7Lw1Za',
    VERCEL_ENV: 'preview',
    VERCEL_GIT_REPO_OWNER: 'acme',
    VERCEL_GIT_REPO_SLUG: 'shop',
    VERCEL_GIT_COMMIT_REF: 'feat/checkout',
    VERCEL_GIT_COMMIT_SHA: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
};

function stubEnv(env: Record<string, string>): void {
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
}

describe('vite plugin', () => {
    it('adds the loader to index.html and to the Vite client only', () => {
        const plugin = tencil({ port: 4800 });
        expect(plugin.apply({}, { command: 'serve' })).toBe(true);
        expect(plugin.transformIndexHtml()).toEqual([
            { tag: 'script', children: overlayLoader(4800), injectTo: 'body' },
        ]);
        expect(plugin.transform('x', '/app/src/main.tsx')).toBeUndefined();
        expect(
            plugin.transform('client();', '/app/node_modules/vite/dist/client/client.mjs'),
        ).toContain(overlayLoader(4800));
    });

    it('stays out of builds without TENCIL_CLOUD', () => {
        vi.stubEnv('TENCIL_CLOUD', '');
        expect(tencil().apply({}, { command: 'build' })).toBe(false);
    });

    it('loads Tencil Cloud in a preview build, and only there', () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        stubEnv(CLOUD_PREVIEW);
        const plugin = tencil();
        expect(plugin.apply({}, { command: 'build' })).toBe(true);
        const [tag] = plugin.transformIndexHtml();
        expect(tag?.children).toContain('https://cloud.tencil.dev/tencil.js');
        expect(tag?.children).toContain('feat/checkout');
        expect(plugin.transform('client();', '/x/vite/dist/client/client.mjs')).toBeUndefined();
        expect(log).toHaveBeenCalledWith(expect.stringContaining('acme/shop@feat/checkout'));

        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.stubEnv('VERCEL_ENV', 'production');
        expect(tencil().apply({}, { command: 'build' })).toBe(false);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('production'));
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
        vi.stubEnv('TENCIL_CLOUD', '');
        expect(Tencil({})).toBeNull();
    });

    it('loads Tencil Cloud on a preview deployment, never in production', () => {
        vi.stubEnv('NODE_ENV', 'production');
        stubEnv(CLOUD_PREVIEW);
        const html = Tencil({})?.props.dangerouslySetInnerHTML.__html;
        expect(html).toContain('https://cloud.tencil.dev/tencil.js');
        expect(html).toContain('acme/shop');

        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.stubEnv('VERCEL_ENV', 'production');
        expect(Tencil({})).toBeNull();
    });
});
