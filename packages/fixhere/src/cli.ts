#!/usr/bin/env node
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  CredentialStore,
  createLocalPairingCode,
  DEFAULT_T3_URL,
  exchangePairingCredential,
  parsePairingInput,
  type RuntimeMode,
} from "@fixhere/provider-t3code";
import pc from "picocolors";
import { DEFAULT_PORT, probeDaemon, startDaemon } from "./daemon.ts";
import { runInit } from "./init/run.ts";
import {
  type DaemonCommand,
  installService,
  isEphemeralInstall,
  startInBackground,
  stopDaemon,
  uninstallService,
} from "./service.ts";
import { defaultDataDir } from "./store.ts";
import { VERSION } from "./version.ts";

const HELP = `
${pc.bold("fixhere")}: point at your UI, prompt your agent.

${pc.dim("Usage")}
  fixhere [start]                Start the daemon in the background
  fixhere start --foreground     Run the daemon in this terminal
  fixhere stop                   Stop the daemon
  fixhere status                 Show the daemon and the projects it serves
  fixhere service install        Start the daemon automatically when you log in
  fixhere service uninstall      Remove the login service
  fixhere init [options]         Load the overlay in this project (Next.js, Vite)
  fixhere connect [pairing-link] Pair with T3 Code (automatic for a local T3 Code)

${pc.dim("Daemon options")}
  --port <n>              Port (default ${DEFAULT_PORT}, env FIXHERE_PORT)
  --t3-url <url>          T3 Code server (default ${DEFAULT_T3_URL}, env FIXHERE_T3_URL)
  --model <inst:model>    Model, e.g. claudeAgent:claude-fable-5-1 (default: project default)
  --runtime-mode <mode>   approval-required | auto-accept-edits | auto | full-access
  --allow-origin <url>    Allow a non-localhost page to connect (repeatable)
  --no-create-project     Don't register unknown folders as T3 Code projects

${pc.dim("Init options")}
  -y, --yes               Apply changes without asking
  --dry-run               Show the changes without writing them
  --skip-install          Don't install the fixhere package
  --skip-pair             Don't pair with T3 Code
  --from <spec>           Package to install instead of "fixhere" (e.g. a local path)

  -h, --help              Show help
  -v, --version           Show version
`;

const RUNTIME_MODES = ["approval-required", "auto-accept-edits", "auto", "full-access"];
/** Flags the background daemon and the login service inherit from `start`. */
const DAEMON_FLAGS = ["t3-url", "model", "runtime-mode", "allow-origin", "no-create-project"];

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      port: { type: "string" },
      root: { type: "string" },
      "t3-url": { type: "string" },
      model: { type: "string" },
      "runtime-mode": { type: "string" },
      "allow-origin": { type: "string", multiple: true },
      "no-create-project": { type: "boolean" },
      foreground: { type: "boolean" },
      yes: { type: "boolean", short: "y" },
      "dry-run": { type: "boolean" },
      "skip-install": { type: "boolean" },
      "skip-pair": { type: "boolean" },
      from: { type: "string" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });

  if (values.help) return void console.log(HELP);
  if (values.version) return void console.log(VERSION);

  const [command = "start", ...rest] = positionals;
  // Unset means "the server `fixhere connect` paired with last", falling back to the default.
  const t3Url = values["t3-url"] ?? process.env.FIXHERE_T3_URL;
  const port = values.port
    ? Number.parseInt(values.port, 10)
    : Number(process.env.FIXHERE_PORT ?? DEFAULT_PORT);
  const runtimeMode = values["runtime-mode"];
  if (runtimeMode && !RUNTIME_MODES.includes(runtimeMode)) {
    throw new Error(`--runtime-mode must be one of ${RUNTIME_MODES.join(", ")}`);
  }
  const daemonCommand: DaemonCommand = {
    node: process.execPath,
    cli: fileURLToPath(import.meta.url),
    port,
    args: forwardedFlags(values),
  };

  switch (command) {
    case "daemon":
      return runDaemon(values, port, t3Url, runtimeMode as RuntimeMode | undefined);
    case "start":
      if (values.foreground) {
        return runDaemon(values, port, t3Url, runtimeMode as RuntimeMode | undefined);
      }
      return start(daemonCommand);
    case "stop":
      console.log(
        (await stopDaemon(port))
          ? `\n  ${pc.green("✓")} Stopped the Fixhere daemon.\n`
          : "\n  The Fixhere daemon isn't running.\n",
      );
      return;
    case "status":
      return status(port);
    case "service":
      return service(rest[0], daemonCommand);
    case "connect":
      return connect(rest[0], t3Url);
    case "init":
      return runInit({
        root: resolve(values.root ?? process.cwd()),
        yes: values.yes,
        dryRun: values["dry-run"],
        skipInstall: values["skip-install"],
        skipPair: values["skip-pair"],
        from: values.from,
        port,
        daemon: daemonCommand,
      });
    default:
      console.error(`Unknown command "${command}"\n${HELP}`);
      process.exitCode = 1;
  }
}

async function start(command: DaemonCommand): Promise<void> {
  const result = await startInBackground(command, defaultDataDir());
  const verb =
    result.status === "running"
      ? "is running"
      : result.status === "restarted"
        ? "restarted"
        : "started";
  console.log(`
  ${pc.green("●")} ${pc.bold("Fixhere")} ${verb} ${pc.dim(`(v${VERSION}, port ${command.port})`)}

  Open a project's dev server and press ${pc.bold("C")} on the page. Projects need the
  overlay loaded once: run ${pc.cyan("npx fixhere init")} in the project.
  ${pc.dim(`Start it automatically at login: ${pc.cyan("npx fixhere service install")}`)}
`);
}

async function status(port: number): Promise<void> {
  const health = await probeDaemon(port);
  if (!health) {
    console.log(
      `\n  The Fixhere daemon isn't running. Start it with ${pc.cyan("npx fixhere start")}.\n`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `\n  ${pc.green("●")} Fixhere v${health.version} on port ${port} ${pc.dim(`(pid ${health.pid})`)}`,
  );
  if (health.projects.length === 0)
    console.log(pc.dim("  No projects yet; open a dev page with the overlay."));
  for (const project of health.projects) {
    const state =
      project.provider.state === "ready" ? pc.green("ready") : pc.yellow(project.provider.state);
    console.log(
      `  ${pc.bold(project.name)} ${pc.dim(project.root)}  ${project.provider.label}: ${state}  ${pc.dim(`${project.clients} page(s)`)}`,
    );
  }
  console.log("");
}

async function service(action: string | undefined, command: DaemonCommand): Promise<void> {
  if (action === "install") {
    if (isEphemeralInstall(command.cli)) {
      throw new Error(
        "Install Fixhere globally first (npm i -g fixhere), then run `fixhere service install`: npx's cache can be cleaned up under a login service.",
      );
    }
    const where = await installService(command, defaultDataDir());
    console.log(
      `\n  ${pc.green("✓")} Fixhere now starts when you log in ${pc.dim(`(${where})`)}\n`,
    );
    return;
  }
  if (action === "uninstall") {
    await uninstallService(command.port);
    console.log(`\n  ${pc.green("✓")} Removed the login service.\n`);
    return;
  }
  throw new Error("Use `fixhere service install` or `fixhere service uninstall`.");
}

async function runDaemon(
  values: Record<string, unknown>,
  port: number,
  t3Url: string | undefined,
  runtimeMode: RuntimeMode | undefined,
): Promise<void> {
  const daemon = await startDaemon({
    port,
    allowedOrigins: values["allow-origin"] as string[] | undefined,
    t3: {
      url: t3Url,
      modelSelection: parseModel(values.model as string | undefined),
      runtimeMode,
      createProjectIfMissing: !values["no-create-project"],
    },
    log: (message) => console.log(`${pc.dim(time())} ${message}`),
  }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      throw new Error(
        `Port ${port} is in use. Is Fixhere already running? Try \`fixhere status\`.`,
      );
    }
    throw error;
  });
  const shutdown = async () => {
    await daemon.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

async function connect(input: string | undefined, t3Url: string | undefined): Promise<void> {
  const store = new CredentialStore();
  const baseUrl = t3Url ?? (await store.lastBaseUrl()) ?? DEFAULT_T3_URL;
  let pairing = input;
  if (!pairing) {
    console.log(`\n  ${pc.dim("Creating a pairing code on the local T3 Code…")}`);
    pairing = await createLocalPairingCode(baseUrl).catch(() => undefined);
  }
  if (!pairing) {
    console.log(`
  Create a pairing link in ${pc.bold("T3 Code → Settings → Connections")}
  (or run ${pc.cyan("npx t3 pair")}) and paste it below.
`);
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    pairing = await rl.question("  Pairing link or code: ");
    rl.close();
  }
  const target = parsePairingInput(pairing, baseUrl);
  const credential = await exchangePairingCredential(target);
  await store.set(target.baseUrl, credential);
  console.log(
    `\n  ${pc.green("✓")} Paired with T3 Code at ${target.baseUrl} ${pc.dim(`(valid until ${new Date(credential.expiresAt).toLocaleDateString()})`)}\n`,
  );
}

function forwardedFlags(values: Record<string, unknown>): string[] {
  const args: string[] = [];
  for (const flag of DAEMON_FLAGS) {
    const value = values[flag];
    if (value === true) args.push(`--${flag}`);
    else if (typeof value === "string") args.push(`--${flag}`, value);
    else if (Array.isArray(value)) for (const v of value) args.push(`--${flag}`, String(v));
  }
  return args;
}

function parseModel(value: string | undefined) {
  if (!value) return undefined;
  const [instanceId, ...model] = value.split(":");
  if (!instanceId || model.length === 0) throw new Error("--model must look like instance:model");
  return { instanceId, model: model.join(":") };
}

function time(): string {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

main().catch((error: unknown) => {
  console.error(`\n  ${pc.red("✗")} ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
