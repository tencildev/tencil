import { fileURLToPath } from 'node:url';
import { resolveCloudBuild, type TencilCloudOptions } from './cloud.ts';

/** The parts of Next's config this touches, so `next` stays an optional peer. */
interface NextConfigParts {
    turbopack?: { rules?: Record<string, unknown>; [key: string]: unknown };
    webpack?: (config: WebpackConfig, context: unknown) => WebpackConfig;
    [key: string]: unknown;
}

interface WebpackConfig {
    module?: { rules?: unknown[] };
    [key: string]: unknown;
}

/**
 * Wrap `next.config` for Tencil Cloud preview builds: every element gets a
 * `data-tencil-src` attribute with its file and line, because production React
 * keeps no source info. Without TENCIL_CLOUD, in development and on production
 * deployments the config comes back untouched.
 *
 *   export default withTencil(nextConfig);
 */
export function withTencil<T extends object>(
    config: T = {} as T,
    options: { cloud?: TencilCloudOptions } = {},
): T {
    if (process.env.NODE_ENV === 'development') return config;
    if (resolveCloudBuild(process.env, options.cloud).kind !== 'on') return config;
    return addSourceLoader(config as NextConfigParts) as T;
}

function addSourceLoader(config: NextConfigParts): NextConfigParts {
    // Built next to this file (dist/next-loader.cjs); webpack and Turbopack require() it.
    const loader = fileURLToPath(new URL('./next-loader.cjs', import.meta.url));
    // Turbopack takes the loader's output as the same file type.
    const rule = { loaders: [loader] };
    return {
        ...config,
        turbopack: {
            ...config.turbopack,
            rules: { ...config.turbopack?.rules, '*.tsx': rule, '*.jsx': rule },
        },
        webpack(webpackConfig: WebpackConfig, context: unknown) {
            const result = config.webpack ? config.webpack(webpackConfig, context) : webpackConfig;
            result.module ??= {};
            result.module.rules ??= [];
            result.module.rules.unshift({
                test: /\.[jt]sx$/,
                exclude: /node_modules/,
                enforce: 'pre',
                use: [{ loader }],
            });
            return result;
        },
    };
}
