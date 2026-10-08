/** Structural subset of Vite's Plugin type, so `vite` stays an optional peer. */
interface VitePlugin {
    name: string;
    apply: 'serve';
    transformIndexHtml(): Array<{
        tag: string;
        attrs: Record<string, string | boolean>;
        injectTo: 'body';
    }>;
    transform(code: string, id: string): string | undefined;
}

export interface FixhereViteOptions {
    /** Port of the Fixhere daemon. Defaults to FIXHERE_PORT or 4747. */
    port?: number;
}

/** Vite's dev client, which every dev page loads, whether or not it has an index.html. */
const VITE_CLIENT = /vite\/dist\/client\/(?:client|bundledDevClient)\.mjs$/;

/** Appended to the Vite client so SSR frameworks (TanStack Start, Astro, SvelteKit) get the overlay too. */
export function overlayLoader(scriptUrl: string): string {
    const src = JSON.stringify(scriptUrl);
    return `
;(() => {
  if (typeof document === "undefined" || document.querySelector(\`script[src=\${JSON.stringify(${src})}]\`)) return;
  const script = document.createElement("script");
  script.src = ${src};
  script.async = true;
  document.head.appendChild(script);
})();
`;
}

/**
 * Dev-only: loads the overlay from the Fixhere daemon running on this machine
 * (`npx fixhere start`). Without a running daemon nothing appears.
 */
export default function fixhere(options: FixhereViteOptions = {}): VitePlugin {
    const port = options.port ?? Number(process.env.FIXHERE_PORT ?? 4747);
    const scriptUrl = `http://localhost:${port}/fixhere.js`;
    return {
        name: 'fixhere',
        apply: 'serve',
        transform(code, id) {
            return VITE_CLIENT.test(id) ? code + overlayLoader(scriptUrl) : undefined;
        },
        transformIndexHtml() {
            return [{ tag: 'script', attrs: { src: scriptUrl, async: true }, injectTo: 'body' }];
        },
    };
}
