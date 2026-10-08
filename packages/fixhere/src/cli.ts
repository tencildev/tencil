#!/usr/bin/env node
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
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
import { DEFAULT_PORT, startFixhere } from "./index.ts";
import { runInit } from "./init/run.ts";
import { VERSION } from "./version.ts";

const HELP = `
${pc.bold("fixhere")} — point at your UI, prompt your agent.

${pc.dim("Usage")}
  fixhere init [options]         Set up Fixhere in this project (Next.js, Vite)
  fixhere [dev] [options]        Start the bridge for the current project
  fixhere connect [pairing-link] Pair with T3 Code (automatic for a local T3 Code)

${pc.dim("Options")}
  --port <n>              Bridge port (default: first free from ${DEFAULT_PORT})
  --root <dir>            Project root (default: cwd)
  --t3-url <url>          T3 Code server (default ${DEFAULT_T3_URL}, env FIXHERE_T3_URL)
  --model <inst:model>    Model, e.g. claudeAgent:claude-fable-5-1 (default: project default)
  --runtime-mode <mode>   approval-required | auto-accept-edits | auto | full-access
  --allow-origin <url>    Allow a non-localhost page to connect (repeatable)
  --no-create-project     Don't register the folder in T3 Code when missing

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

  const [command = "dev", ...rest] = positionals;
  // Unset means "the server `fixhere connect` paired with last", falling back to the default.
  const t3Url = values["t3-url"] ?? process.env.FIXHERE_T3_URL;

  if (command === "connect") return connect(rest[0], t3Url);
  if (command === "init") {
    return runInit({
      root: resolve(values.root ?? process.cwd()),
      yes: values.yes,
      dryRun: values["dry-run"],
      skipInstall: values["skip-install"],
      skipPair: values["skip-pair"],
      from: values.from,
      t3Url,
    });
  }
  if (command !== "dev") {
    console.error(`Unknown command "${command}"\n${HELP}`);
    process.exitCode = 1;
    return;
  }

  const runtimeMode = values["runtime-mode"];
  if (runtimeMode && !RUNTIME_MODES.includes(runtimeMode)) {
    throw new Error(`--runtime-mode must be one of ${RUNTIME_MODES.join(", ")}`);
  }
  const port = values.port ? Number.parseInt(values.port, 10) : undefined;

  const instance = await startFixhere({
    root: values.root,
    port,
    allowedOrigins: values["allow-origin"],
    t3: {
      url: t3Url,
      modelSelection: parseModel(values.model),
      runtimeMode: runtimeMode as RuntimeMode | undefined,
      createProjectIfMissing: !values["no-create-project"],
    },
    log: (message) => console.log(`${pc.dim(time())} ${message}`),
  });

  if (instance.attached) {
    console.log(
      `\n  ${pc.green("✓")} Fixhere is already running for this project at ${instance.url}\n`,
    );
    return;
  }

  console.log(`
  ${pc.bold(pc.red("●"))} ${pc.bold("Fixhere")} ${pc.dim(`v${VERSION}`)}

  ${pc.dim("Add to your dev page:")}
  ${pc.cyan(`<script src="${instance.scriptUrl}" defer></script>`)}

  ${pc.dim("Then press")} ${pc.bold("C")} ${pc.dim("on the page to pin a prompt.")}
`);

  let lastState = "";
  instance.provider?.onInfoChange((info) => {
    if (info.state === lastState) return;
    lastState = info.state;
    const line = `${info.label}: ${info.state}${info.detail ? ` — ${info.detail}` : ""}`;
    if (info.state === "unauthorized") {
      console.log(`${pc.dim(time())} ${pc.yellow(line)}`);
      console.log(
        `${pc.dim(time())} Use ${pc.bold("Pair")} in the overlay, or ${pc.cyan("npx fixhere connect")} with a link from T3 Code → Settings → Connections.`,
      );
    } else if (info.state === "unavailable") {
      console.log(`${pc.dim(time())} ${pc.yellow(line)}`);
    }
  });

  const shutdown = async () => {
    await instance.close();
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
