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
    transformIndexHtml() {
      if (!instance) return [];
      return [{ tag: "script", attrs: { src: instance.scriptUrl, defer: true }, injectTo: "body" }];
    },
  };
}
