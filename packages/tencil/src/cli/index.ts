#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { DEFAULT_T3_URL, type RuntimeMode } from '@tencildev/provider-t3code';
import pc from 'picocolors';
import { PROVIDERS, type ProviderName, saveProvider } from '../daemon/agents.ts';
import { DEFAULT_PORT } from '../daemon/server.ts';
import { runInit } from '../init/run-init.ts';
import { stopDaemon } from '../service/background.ts';
import type { DaemonCommand } from '../service/daemon-command.ts';
import { isServiceInstalled, stopService } from '../service/login-service.ts';
import { VERSION } from '../version.ts';
import { connect } from './commands/connect.ts';
import { runDaemon } from './commands/daemon.ts';
import { finishUpdateCommand } from './commands/finish-update.ts';
import { quickstart } from './commands/quickstart.ts';
import { service } from './commands/service.ts';
import { setup } from './commands/setup.ts';
import { start } from './commands/start.ts';
import { status } from './commands/status.ts';
import { forwardedFlags, RUNTIME_MODES } from './options.ts';

const HELP = `
${pc.bold('tencil')}: point at your UI, prompt your agent.

${pc.dim('Usage')}
  tencil                        Set up this machine if needed, then add Tencil to this project
  tencil setup                  Set up this machine: start Tencil (at login) and pair
  tencil init [options]         Load the overlay in this project (Next.js, Vite)
  tencil start                  Start the daemon in the background
  tencil start --foreground     Run the daemon in this terminal
  tencil stop                   Stop the daemon
  tencil status                 Show the daemon and the projects it serves
  tencil service install        Start the daemon automatically when you log in
  tencil service uninstall      Remove the login service
  tencil connect [pairing-link] Pair with T3 Code (automatic for a local T3 Code)

${pc.dim('Daemon options')}
  --port <n>              Port (default ${DEFAULT_PORT}, env TENCIL_PORT)
  --provider <name>       t3code | claude-code | ensemble: this machine's agent (setup asks when unset)
  --t3-url <url>          T3 Code server (default ${DEFAULT_T3_URL}, env TENCIL_T3_URL)
  --model <model>         T3 Code: instance:model, e.g. claudeAgent:claude-fable-5-1
                          Claude Code: a model, e.g. claude-opus-5-5 (default: its default)
  --runtime-mode <mode>   approval-required | auto-accept-edits | auto | full-access
  --listen <address>      Also listen here, e.g. a Tailscale IP for a remote browser (repeatable)
  --allow-origin <url>    Allow a non-localhost page to connect (repeatable)
  --no-create-project     Don't register unknown folders as T3 Code projects

${pc.dim('Setup and init options')}
  -y, --yes               Accept the defaults / apply changes without asking
  --dry-run               Show the changes without writing them
  --skip-install          Don't install the tencil package
  --skip-pair             Don't pair with T3 Code
  --cloud                 init: set up for Tencil Cloud previews (no daemon on this machine)
  --from <spec>           Package to install instead of "tencil" (e.g. a local path)

  -h, --help              Show help
  -v, --version           Show version
`;

async function main(): Promise<void> {
    const { values, positionals } = parseArgs({
        allowPositionals: true,
        options: {
            port: { type: 'string' },
            root: { type: 'string' },
            provider: { type: 'string' },
            't3-url': { type: 'string' },
            model: { type: 'string' },
            'runtime-mode': { type: 'string' },
            listen: { type: 'string', multiple: true },
            'allow-origin': { type: 'string', multiple: true },
            'no-create-project': { type: 'boolean' },
            foreground: { type: 'boolean' },
            yes: { type: 'boolean', short: 'y' },
            'dry-run': { type: 'boolean' },
            'skip-install': { type: 'boolean' },
            'skip-pair': { type: 'boolean' },
            cloud: { type: 'boolean' },
            from: { type: 'string' },
            help: { type: 'boolean', short: 'h' },
            version: { type: 'boolean', short: 'v' },
        },
    });

    if (values.help) return void console.log(HELP);
    if (values.version) return void console.log(VERSION);

    const [command, ...rest] = positionals;
    // Unset means "the server `tencil connect` paired with last", falling back to the default.
    const t3Url = values['t3-url'] ?? process.env.TENCIL_T3_URL;
    const port = values.port
        ? Number.parseInt(values.port, 10)
        : Number(process.env.TENCIL_PORT ?? DEFAULT_PORT);
    const provider = values.provider as ProviderName | undefined;
    if (provider && !PROVIDERS.includes(provider)) {
        throw new Error(`--provider must be one of ${PROVIDERS.join(', ')}`);
    }
    // The machine's choice, so setup doesn't ask and the login service needs no flag.
    if (provider && command !== 'daemon') await saveProvider(provider);
    const runtimeMode = values['runtime-mode'];
    if (runtimeMode && !RUNTIME_MODES.includes(runtimeMode)) {
        throw new Error(`--runtime-mode must be one of ${RUNTIME_MODES.join(', ')}`);
    }
    const daemonCommand: DaemonCommand = {
        node: process.execPath,
        cli: fileURLToPath(import.meta.url),
        port,
        args: forwardedFlags(values),
    };

    switch (command) {
        case undefined:
            return quickstart(daemonCommand, {
                root: resolve(values.root ?? process.cwd()),
                yes: values.yes,
                from: values.from,
                t3Url,
            });
        case 'daemon':
            return runDaemon(
                values,
                port,
                provider,
                t3Url,
                runtimeMode as RuntimeMode | undefined,
                daemonCommand.cli,
            );
        case 'start':
            if (values.foreground) {
                return runDaemon(
                    values,
                    port,
                    provider,
                    t3Url,
                    runtimeMode as RuntimeMode | undefined,
                    daemonCommand.cli,
                );
            }
            return start(daemonCommand);
        case 'setup':
            return setup(daemonCommand, {
                yes: values.yes,
                from: values.from,
                t3Url,
                root: resolve(values.root ?? process.cwd()),
            });
        case 'stop':
            if (isServiceInstalled(port)) {
                await stopService(port);
                console.log(
                    `\n  ${pc.green('✓')} Stopped the Tencil daemon until you next log in. ${pc.dim('Remove the login service: npx tencil service uninstall')}\n`,
                );
                return;
            }
            console.log(
                (await stopDaemon(port))
                    ? `\n  ${pc.green('✓')} Stopped the Tencil daemon.\n`
                    : "\n  The Tencil daemon isn't running.\n",
            );
            return;
        case 'status':
            return status(port);
        case 'service':
            return service(rest[0], daemonCommand, values.from);
        case 'connect':
            return connect(rest[0], t3Url);
        // Not in the help: the daemon runs it to restart itself on a new version.
        case 'finish-update':
            return finishUpdateCommand(rest[0]);
        case 'init':
            return runInit({
                root: resolve(values.root ?? process.cwd()),
                yes: values.yes,
                dryRun: values['dry-run'],
                skipInstall: values['skip-install'],
                skipPair: values['skip-pair'],
                from: values.from,
                port,
                daemon: values.cloud ? undefined : daemonCommand,
                t3Url,
                cloud: values.cloud,
            });
        default:
            console.error(`Unknown command "${command}"\n${HELP}`);
            process.exitCode = 1;
    }
}

main().catch((error: unknown) => {
    console.error(`\n  ${pc.red('✗')} ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
});
