import { type FixhereInstance, type FixhereOptions, startFixhere } from "./index.ts";

/** Structural subset of Vite's Plugin type, so `vite` stays an optional peer. */
interface VitePlugin {
  name: string;
  apply: "serve";
  configureServer(server: {
    config: { root: string };
    httpServer: { once(event: "close", cb: () => void): void } | null;
  }): Promise<void>;
  transformIndexHtml(): Array<{
    tag: string;
    attrs: Record<string, string | boolean>;
    injectTo: "body";
  }>;
  transform(code: string, id: string): string | undefined;
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

export type FixhereViteOptions = FixhereOptions;

/**
 * Dev-only: runs the bridge with the Vite dev server (or attaches to the one
 * already running for this project) and injects the overlay script.
 */
export default function fixhere(options: FixhereViteOptions = {}): VitePlugin {
  let instance: FixhereInstance | undefined;

  return {
    name: "fixhere",
    apply: "serve",
    async configureServer(server) {
      try {
        instance = await startFixhere({
          root: server.config.root,
          ...options,
          log: options.log ?? ((message) => console.log(`[fixhere] ${message}`)),
        });
      } catch (error) {
        console.warn(`[fixhere] ${error instanceof Error ? error.message : String(error)}`);
      }
      server.httpServer?.once("close", () => void instance?.close());
    },
    transform(code, id) {
      if (!instance || !VITE_CLIENT.test(id)) return undefined;
      return code + overlayLoader(instance.scriptUrl);
    },
    transformIndexHtml() {
      if (!instance) return [];
      return [{ tag: "script", attrs: { src: instance.scriptUrl, defer: true }, injectTo: "body" }];
    },
  };
}
