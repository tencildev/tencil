import { existsSync } from "node:fs";
import type { Server } from "node:http";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Provider } from "@fixhere/protocol";
import {
  type ModelSelection,
  type RuntimeMode,
  T3CodeProvider,
  type T3CodeProviderOptions,
} from "@fixhere/provider-t3code";
import { Bridge } from "./bridge.ts";
import { startServer } from "./server.ts";
import { ThreadStore } from "./store.ts";
import { VERSION } from "./version.ts";

export const DEFAULT_PORT = 4747;
/** How many ports after the first to try before giving up. */
const PORT_ATTEMPTS = 20;

export interface FixhereOptions {
  /** Project the dev site belongs to. Defaults to `process.cwd()`. */
  root?: string;
  /** Fixed port. By default the first free port from `basePort` is used. */
  port?: number;
  /** First port to probe when no fixed port is given. Defaults to 4747. */
  basePort?: number;
  host?: string;
  allowedOrigins?: string[];
  /** Where pins are stored; defaults to ~/.config/fixhere. */
  dataDir?: string;
  /** Bring your own provider; defaults to T3 Code. */
  provider?: Provider;
  t3?: Pick<
    T3CodeProviderOptions,
    "autoPair" | "createPairingCode" | "credentials" | "timeouts"
  > & {
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
  root: string;
  /** True when another process already runs the bridge for this project. */
  attached: boolean;
  /** Absent when attached to another process's bridge. */
  provider?: Provider;
  close(): Promise<void>;
}

/**
 * Start the bridge for a project, or attach to the one already running for it.
 * Ports are probed from 4747; a port held by another project's bridge is
 * skipped, one held by this project's bridge is reused. That lets several
 * projects run side by side and frameworks that load their config in more
 * than one process (Next.js) share a single bridge.
 */
export async function startFixhere(options: FixhereOptions = {}): Promise<FixhereInstance> {
  const root = resolve(options.root ?? process.cwd());
  const host = options.host ?? "127.0.0.1";
  const base = options.basePort ?? DEFAULT_PORT;
  const ports = options.port
    ? [options.port]
    : Array.from({ length: PORT_ATTEMPTS }, (_, i) => base + i);

  for (const port of ports) {
    const existing = await probe(host, port);
    if (existing === "free") {
      try {
        return await launch(root, host, port, options);
      } catch (error) {
        // Lost a race for the port; look at who took it.
        if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
        const winner = await probe(host, port);
        if (winner !== "free" && winner !== "foreign" && winner.root === root) {
          return attached(root, host, port);
        }
        continue;
      }
    }
    if (existing !== "foreign" && existing.root === root) return attached(root, host, port);
  }
  throw new Error(
    options.port
      ? `Port ${options.port} is in use by something else. Pick another with --port.`
      : `No free port between ${base} and ${base + PORT_ATTEMPTS - 1}.`,
  );
}

async function launch(
  root: string,
  host: string,
  port: number,
  options: FixhereOptions,
): Promise<FixhereInstance> {
  const log = options.log ?? (() => {});
  const { url: t3Url, token, ...t3 } = options.t3 ?? {};
  const provider =
    options.provider ??
    new T3CodeProvider({
      ...t3,
      projectRoot: root,
      baseUrl: t3Url ?? process.env.FIXHERE_T3_URL,
      token: token ?? process.env.FIXHERE_T3_TOKEN,
      createProjectIfMissing: t3.createProjectIfMissing ?? true,
      log,
    });

  const store = new ThreadStore(root, options.dataDir);
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
      root,
      overlayPath: resolveOverlayPath(),
      allowedOrigins: options.allowedOrigins ?? [],
      version: VERSION,
    });
  } catch (error) {
    await bridge.dispose();
    throw error;
  }

  // Connect in the background; the overlay shows connection state live.
  void provider.start();

  const url = publicUrl(host, port);
  return {
    url,
    scriptUrl: `${url}/fixhere.js`,
    root,
    attached: false,
    provider,
    async close() {
      await bridge.dispose();
      await provider.dispose();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}

function attached(root: string, host: string, port: number): FixhereInstance {
  const url = publicUrl(host, port);
  return { url, scriptUrl: `${url}/fixhere.js`, root, attached: true, close: async () => {} };
}

type ProbeResult = "free" | "foreign" | { root: string; version: string };

/** Who holds a port: nobody, something that isn't Fixhere, or a Fixhere bridge for some project. */
async function probe(host: string, port: number): Promise<ProbeResult> {
  try {
    const response = await fetch(`http://${connectHost(host)}:${port}/health`, {
      signal: AbortSignal.timeout(1_000),
    });
    const body = (await response.json().catch(() => null)) as {
      name?: string;
      root?: string;
      version?: string;
    } | null;
    return body?.name === "fixhere" && body.root
      ? { root: body.root, version: body.version ?? "" }
      : "foreign";
  } catch (error) {
    const code = (error as { cause?: { code?: string } }).cause?.code;
    return code === "ECONNREFUSED" ? "free" : "foreign";
  }
}

function connectHost(host: string): string {
  return host === "0.0.0.0" ? "127.0.0.1" : host;
}

function publicUrl(host: string, port: number): string {
  const name = host === "127.0.0.1" || host === "0.0.0.0" ? "localhost" : host;
  return `http://${name}:${port}`;
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
export { projectStorePath, ThreadStore } from "./store.ts";
