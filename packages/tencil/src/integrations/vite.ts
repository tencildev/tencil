import { DEFAULT_DAEMON_PORT, overlayLoader } from './loader.ts';

/** Structural subset of Vite's Plugin type, so `vite` stays an optional peer. */
interface VitePlugin {
    name: string;
    apply: 'serve';
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
}

/** Vite's dev client, which every dev page loads, whether or not it has an index.html. */
const VITE_CLIENT = /vite\/dist\/client\/(?:client|bundledDevClient)\.mjs$/;

/**
 * Dev-only: loads the overlay from the Tencil daemon on the machine serving the
 * page (`npx tencil start`). Without a running daemon nothing appears.
 */
export default function tencil(options: TencilViteOptions = {}): VitePlugin {
    const loader = overlayLoader(
        options.port ?? Number(process.env.TENCIL_PORT ?? DEFAULT_DAEMON_PORT),
    );
    return {
        name: 'tencil',
        apply: 'serve',
        transform(code, id) {
            // Every dev page loads the Vite client, so SSR frameworks (TanStack Start,
            // Astro, SvelteKit) without an index.html get the overlay too.
            return VITE_CLIENT.test(id) ? `${code}\n${loader}\n` : undefined;
        },
        transformIndexHtml() {
            return [{ tag: 'script', children: loader, injectTo: 'body' }];
        },
    };
}
