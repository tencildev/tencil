import type { FixhereInstance, FixhereOptions } from "./index.ts";
import { DEFAULT_PORT, startFixhere } from "./index.ts";

/** Structural subset of Vite's Plugin type, so `vite` stays an optional peer. */
interface VitePlugin {
  name: string;
  apply: "serve";
  configureServer(server: {
    httpServer: { once(event: "close", cb: () => void): void } | null;
  }): Promise<void>;
  transformIndexHtml(): Array<{
    tag: string;
    attrs: Record<string, string | boolean>;
    injectTo: "body";
  }>;
}

export interface FixhereViteOptions extends FixhereOptions {
  /**
   * Start the bridge inside the Vite process (default). Set to false when you
   * run `fixhere` yourself and only want the script injected.
   */
  startBridge?: boolean;
}

/**
 * Dev-only: injects the overlay script and (by default) runs the bridge
 * alongside the Vite dev server.
 */
export default function fixhere(options: FixhereViteOptions = {}): VitePlugin {
  const { startBridge = true, ...bridgeOptions } = options;
  const port = bridgeOptions.port ?? DEFAULT_PORT;
  let instance: FixhereInstance | undefined;

  return {
    name: "fixhere",
    apply: "serve",
    async configureServer(server) {
      if (!startBridge) return;
      try {
        instance = await startFixhere({
          ...bridgeOptions,
          port,
          log: bridgeOptions.log ?? ((message) => console.log(`[fixhere] ${message}`)),
        });
      } catch (error) {
        // Most likely a standalone bridge is already running; reuse it.
        console.warn(`[fixhere] ${error instanceof Error ? error.message : String(error)}`);
      }
      server.httpServer?.once("close", () => void instance?.close());
    },
    transformIndexHtml() {
      return [
        {
          tag: "script",
          attrs: { src: `http://localhost:${port}/fixhere.js`, defer: true },
          injectTo: "body",
        },
      ];
    },
  };
}
