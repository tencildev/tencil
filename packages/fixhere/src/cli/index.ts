#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { DEFAULT_T3_URL, type RuntimeMode } from '@fixhere/provider-t3code';
import pc from 'picocolors';
import { DEFAULT_PORT } from '../daemon/server.ts';
import { runInit } from '../init/run-init.ts';
import { stopDaemon } from '../service/background.ts';
import type { DaemonCommand } from '../service/daemon-command.ts';
import { isServiceInstalled, stopService } from '../service/login-service.ts';
import { VERSION } from '../version.ts';
import { connect } from './commands/connect.ts';
import { runDaemon } from './commands/daemon.ts';
import { service } from './commands/service.ts';
import { setup } from './commands/setup.ts';
import { start } from './commands/start.ts';
import { status } from './commands/status.ts';
import { forwardedFlags, RUNTIME_MODES } from './options.ts';

const HELP = `
${pc.bold('fixhere')}: point at your UI, prompt your agent.

${pc.dim('Usage')}
  fixhere setup                  Set up this machine: start Fixhere (at login) and pair
  fixhere init [options]         Load the overlay in this project (Next.js, Vite)
  fixhere [start]                Start the daemon in the background
  fixhere start --foreground     Run the daemon in this terminal
  fixhere stop                   Stop the daemon
  fixhere status                 Show the daemon and the projects it serves
  fixhere service install        Start the daemon automatically when you log in
  fixhere service uninstall      Remove the login service
  fixhere connect [pairing-link] Pair with T3 Code (automatic for a local T3 Code)

${pc.dim('Daemon options')}
  --port <n>              Port (default ${DEFAULT_PORT}, env FIXHERE_PORT)
  --t3-url <url>          T3 Code server (default ${DEFAULT_T3_URL}, env FIXHERE_T3_URL)
  --model <inst:model>    Model, e.g. claudeAgent:claude-fable-5-1 (default: project default)
  --runtime-mode <mode>   approval-required | auto-accept-edits | auto | full-access
  --listen <address>      Also listen here, e.g. a Tailscale IP for a remote browser (repeatable)
  --allow-origin <url>    Allow a non-localhost page to connect (repeatable)
  --no-create-project     Don't register unknown folders as T3 Code projects

${pc.dim('Setup and init options')}
  -y, --yes               Accept the defaults / apply changes without asking
  --dry-run               Show the changes without writing them
  --skip-install          Don't install the fixhere package
  --skip-pair             Don't pair with T3 Code
  --from <spec>           Package to install instead of "fixhere" (e.g. a local path)

  -h, --help              Show help
  -v, --version           Show version
`;

async function main(): Promise<void> {
    const { values, positionals } = parseArgs({
        allowPositionals: true,
        options: {
            port: { type: 'string' },
            root: { type: 'string' },
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
            from: { type: 'string' },
            help: { type: 'boolean', short: 'h' },
            version: { type: 'boolean', short: 'v' },
        },
    });

    if (values.help) return void console.log(HELP);
    if (values.version) return void console.log(VERSION);

    const [command = 'start', ...rest] = positionals;
    // Unset means "the server `fixhere connect` paired with last", falling back to the default.
    const t3Url = values['t3-url'] ?? process.env.FIXHERE_T3_URL;
    const port = values.port
        ? Number.parseInt(values.port, 10)
        : Number(process.env.FIXHERE_PORT ?? DEFAULT_PORT);
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
        case 'daemon':
            return runDaemon(values, port, t3Url, runtimeMode as RuntimeMode | undefined);
        case 'start':
            if (values.foreground) {
                return runDaemon(values, port, t3Url, runtimeMode as RuntimeMode | undefined);
            }
            return start(daemonCommand);
        case 'setup':
            return setup(daemonCommand, { yes: values.yes, from: values.from, t3Url });
        case 'stop':
            if (isServiceInstalled(port)) {
                await stopService(port);
                console.log(
                    `\n  ${pc.green('✓')} Stopped the Fixhere daemon until you next log in. ${pc.dim('Remove the login service: npx fixhere service uninstall')}\n`,
                );
                return;
            }
            console.log(
                (await stopDaemon(port))
                    ? `\n  ${pc.green('✓')} Stopped the Fixhere daemon.\n`
                    : "\n  The Fixhere daemon isn't running.\n",
            );
            return;
        case 'status':
            return status(port);
        case 'service':
            return service(rest[0], daemonCommand, values.from);
        case 'connect':
            return connect(rest[0], t3Url);
        case 'init':
            return runInit({
                root: resolve(values.root ?? process.cwd()),
                yes: values.yes,
                dryRun: values['dry-run'],
                skipInstall: values['skip-install'],
                skipPair: values['skip-pair'],
                from: values.from,
                port,
                daemon: daemonCommand,
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
