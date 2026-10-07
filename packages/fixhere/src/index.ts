import { existsSync } from "node:fs";
import type { Server } from "node:http";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Provider } from "@fixhere/protocol";
import { type ModelSelection, type RuntimeMode, T3CodeProvider } from "@fixhere/provider-t3code";
import { Bridge } from "./bridge.ts";
import { startServer } from "./server.ts";
import { ThreadStore } from "./store.ts";
import { VERSION } from "./version.ts";

export const DEFAULT_PORT = 4747;

export interface FixhereOptions {
  /** Project the dev site belongs to. Defaults to `process.cwd()`. */
  root?: string;
  port?: number;
  host?: string;
  allowedOrigins?: string[];
  /** Bring your own provider; defaults to T3 Code. */
  provider?: Provider;
  t3?: {
    url?: string;
    token?: string;
    modelSelection?: ModelSelection;
    runtimeMode?: RuntimeMode;
    createProjectIfMissing?: boolean;
  };
  log?: (message: string) => void;
}

export interface FixhereInstance {
  url: string;
  scriptUrl: string;
  provider: Provider;
  close(): Promise<void>;
}

export async function startFixhere(options: FixhereOptions = {}): Promise<FixhereInstance> {
  const root = resolve(options.root ?? process.cwd());
  const port = options.port ?? DEFAULT_PORT;
  const host = options.host ?? "127.0.0.1";
  const log = options.log ?? (() => {});

  const provider =
    options.provider ??
    new T3CodeProvider({
      projectRoot: root,
      baseUrl: options.t3?.url ?? process.env.FIXHERE_T3_URL,
      token: options.t3?.token ?? process.env.FIXHERE_T3_TOKEN,
      modelSelection: options.t3?.modelSelection,
      runtimeMode: options.t3?.runtimeMode,
      createProjectIfMissing: options.t3?.createProjectIfMissing ?? true,
      log,
    });

  const store = new ThreadStore(root);
  await store.load();
  const bridge = new Bridge({
    provider,
    store,
    project: { name: basename(root), root },
    version: VERSION,
    log,
  });

  let server: Server;
  try {
    server = await startServer({
      bridge,
      port,
      host,
      overlayPath: resolveOverlayPath(),
      allowedOrigins: options.allowedOrigins ?? [],
      version: VERSION,
    });
  } catch (error) {
    await bridge.dispose();
    if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
      throw new Error(
        `Port ${port} is in use. Is Fixhere already running? Use --port to pick another.`,
      );
    }
    throw error;
  }

  // Connect in the background; the overlay shows connection state live.
  void provider.start();

  const url = `http://${host === "127.0.0.1" || host === "0.0.0.0" ? "localhost" : host}:${port}`;
  return {
    url,
    scriptUrl: `${url}/fixhere.js`,
    provider,
    async close() {
      await bridge.dispose();
      await provider.dispose();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}

/** Published builds ship the overlay next to this file; the monorepo uses the workspace build. */
function resolveOverlayPath(): string {
  const candidates = [
    fileURLToPath(new URL("./overlay.global.js", import.meta.url)),
    fileURLToPath(new URL("../../overlay/dist/fixhere.global.js", import.meta.url)),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}

export { Bridge } from "./bridge.ts";
export { renderPrompt, stripContext } from "./prompt.ts";
export { ThreadStore } from "./store.ts";
