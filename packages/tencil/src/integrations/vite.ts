import {
    type CloudBuild,
    cloudLoader,
    resolveCloudBuild,
    type TencilCloudOptions,
} from './cloud.ts';
import { DEFAULT_DAEMON_PORT, overlayLoader } from './loader.ts';

/** Structural subset of Vite's Plugin type, so `vite` stays an optional peer. */
interface VitePlugin {
    name: string;
    apply(config: unknown, env: { command: 'build' | 'serve' }): boolean;
    transformIndexHtml(): Array<{
        tag: string;
        children: string;
        injectTo: 'body';
    }>;
    transform(code: string, id: string): string | undefined;
}

export interface TencilViteOptions {
    /** Port of the Tencil daemon. Defaults to TENCIL_PORT or 4747. */
    port?: number;
    /**
     * Tencil Cloud for preview builds. On when TENCIL_CLOUD holds a project key;
     * repo, branch and commit come from the host. Production builds never load it.
     */
    cloud?: TencilCloudOptions;
}

/** Vite's dev client, which every dev page loads, whether or not it has an index.html. */
const VITE_CLIENT = /vite\/dist\/client\/(?:client|bundledDevClient)\.mjs$/;

/**
 * In development: loads the overlay from the Tencil daemon on the machine serving
 * the page (`npx tencil start`). Without a running daemon nothing appears.
 *
 * In a build: nothing, unless TENCIL_CLOUD is set for a preview deployment; then
 * the page loads the overlay from Tencil Cloud.
 */
export default function tencil(options: TencilViteOptions = {}): VitePlugin {
    const port = options.port ?? Number(process.env.TENCIL_PORT ?? DEFAULT_DAEMON_PORT);
    let loader = overlayLoader(port);
    let command: 'build' | 'serve' = 'serve';
    return {
        name: 'tencil',
        apply(_config, env) {
            command = env.command;
            if (command === 'serve') return true;
            const cloud = resolveCloudBuild(process.env, options.cloud);
            report(cloud);
            if (cloud.kind !== 'on') return false;
            loader = cloudLoader(cloud);
            return true;
        },
        transform(code, id) {
            // Every dev page loads the Vite client, so SSR frameworks (TanStack Start,
            // Astro, SvelteKit) without an index.html get the overlay too.
            if (command !== 'serve') return undefined;
            return VITE_CLIENT.test(id) ? `${code}\n${loader}\n` : undefined;
        },
        transformIndexHtml() {
            return [{ tag: 'script', children: loader, injectTo: 'body' }];
        },
    };
}

function report(cloud: CloudBuild): void {
    if (cloud.kind === 'refused') {
        console.warn(`[tencil] Not loading Tencil Cloud in this build. ${cloud.reason}`);
    } else if (cloud.kind === 'on') {
        console.log(
            `[tencil] Tencil Cloud on for ${cloud.build.repo}@${cloud.build.branch} (${cloud.build.sha.slice(0, 7)}).`,
        );
    }
}
