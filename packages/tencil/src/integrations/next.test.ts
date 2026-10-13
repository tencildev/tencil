import { afterEach, describe, expect, it, vi } from 'vitest';
import { withTencil } from './next.ts';

const PREVIEW = {
    TENCIL_CLOUD: 'proj_3fK9xQ2mVb7Lw1Za',
    VERCEL_ENV: 'preview',
    VERCEL_GIT_REPO_OWNER: 'acme',
    VERCEL_GIT_REPO_SLUG: 'shop',
    VERCEL_GIT_COMMIT_REF: 'feat/checkout',
    VERCEL_GIT_COMMIT_SHA: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
};

/** The config `withTencil` returns on a preview. */
interface Wrapped {
    reactStrictMode: boolean;
    turbopack: { rules: Record<string, { loaders: string[] }> };
    webpack(
        config: { module: { rules: unknown[] } },
        context: unknown,
    ): { own?: boolean; module: { rules: unknown[] } };
}

afterEach(() => vi.unstubAllEnvs());

describe('withTencil', () => {
    it('returns the config untouched outside Tencil Cloud previews', () => {
        const config = { reactStrictMode: true };
        vi.stubEnv('TENCIL_CLOUD', '');
        expect(withTencil(config)).toBe(config);

        for (const [name, value] of Object.entries(PREVIEW)) vi.stubEnv(name, value);
        vi.stubEnv('NODE_ENV', 'development');
        expect(withTencil(config)).toBe(config);
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubEnv('VERCEL_ENV', 'production');
        expect(withTencil(config)).toBe(config);
    });

    it('adds the source loader for Turbopack and webpack on a preview', () => {
        for (const [name, value] of Object.entries(PREVIEW)) vi.stubEnv(name, value);
        vi.stubEnv('NODE_ENV', 'production');
        const own = vi.fn((config: { module?: { rules?: unknown[] } }) => ({
            ...config,
            own: true,
        }));
        const config = withTencil({
            reactStrictMode: true,
            turbopack: { rules: { '*.svg': { loaders: ['@svgr/webpack'], as: '*.js' } } },
            webpack: own,
        }) as unknown as Wrapped;

        expect(config.reactStrictMode).toBe(true);
        expect(Object.keys(config.turbopack.rules)).toEqual(['*.svg', '*.tsx', '*.jsx']);
        expect(config.turbopack.rules['*.tsx']?.loaders[0]).toMatch(/next-loader\.cjs$/);

        const webpack = config.webpack({ module: { rules: ['existing'] } }, {});
        expect(own).toHaveBeenCalledOnce();
        expect(webpack.own).toBe(true);
        expect(webpack.module.rules[0]).toMatchObject({ enforce: 'pre', exclude: /node_modules/ });
        expect(webpack.module.rules[1]).toBe('existing');
    });
});
