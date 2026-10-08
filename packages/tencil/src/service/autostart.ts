import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { withoutNpmEnv } from '@tencil/provider-t3code';
import { DEFAULT_PORT, probeDaemon } from '../daemon/server.ts';
import { VERSION } from '../version.ts';
import { sameFlags, startInBackground, waitForDaemon } from './background.ts';
import type { DaemonCommand } from './daemon-command.ts';
import { installService, isServiceInstalled } from './login-service.ts';

/**
 * Running from a package manager's install (npx's cache, a project, a global
 * prefix) rather than a source checkout. Those can be cleaned up or upgraded
 * under a login service, so it gets its own copy.
 */
export function isPackageInstall(cliPath: string): boolean {
    return /[\\/]node_modules[\\/]/.test(cliPath);
}

/** The login service's own copy of Tencil; one per port, like the service. */
export function runtimeDir(dataDir: string, port = DEFAULT_PORT): string {
    return join(dataDir, port === DEFAULT_PORT ? 'runtime' : `runtime-${port}`);
}

export function runtimeCli(dataDir: string, port = DEFAULT_PORT): string {
    return join(runtimeDir(dataDir, port), 'node_modules', 'tencil', 'dist', 'cli.mjs');
}

export function runtimeInstallArgs(dataDir: string, spec: string, port = DEFAULT_PORT): string[] {
    return [
        'install',
        '--prefix',
        runtimeDir(dataDir, port),
        spec,
        '--no-audit',
        '--no-fund',
        '--loglevel=error',
    ];
}

/**
 * Start Tencil at login and now. Keeps the running daemon's flags unless new
 * ones are given. `from` installs another package spec (a local tarball) as
 * the service's copy instead of this version from npm.
 */
export async function enableAutostart(
    command: DaemonCommand,
    dataDir: string,
    from?: string,
): Promise<string> {
    const running = await probeDaemon(command.port);
    const args = command.args?.length ? command.args : (running?.flags ?? []);
    let cli = command.cli;
    if (isPackageInstall(cli)) {
        const spec = from && existsSync(from) ? resolve(from) : (from ?? `tencil@${VERSION}`);
        const result = spawnSync(
            process.platform === 'win32' ? 'npm.cmd' : 'npm',
            runtimeInstallArgs(dataDir, spec, command.port),
            {
                encoding: 'utf8',
                stdio: ['ignore', 'ignore', 'pipe'],
                shell: process.platform === 'win32',
                env: withoutNpmEnv(),
            },
        );
        if (result.status !== 0) {
            throw new Error(
                `Couldn't install Tencil for the login service (npm ${result.status ?? 'failed'}): ${result.stderr?.trim() ?? ''}`,
            );
        }
        cli = runtimeCli(dataDir, command.port);
    }
    const where = await installService({ ...command, cli, args }, dataDir);
    await waitForDaemon(command.port, dataDir);
    return where;
}

/**
 * Make sure this version of the daemon runs. With a login service it is
 * updated in place, since stopping its daemon would only make it restart.
 */
export async function ensureDaemon(
    command: DaemonCommand,
    dataDir: string,
): Promise<{ status: 'started' | 'running' | 'restarted'; autostart: boolean }> {
    if (!isServiceInstalled(command.port)) {
        const { status } = await startInBackground(command, dataDir);
        return { status, autostart: false };
    }
    const running = await probeDaemon(command.port);
    const flags = command.args?.length ? command.args : (running?.flags ?? []);
    if (running && running.version === VERSION && sameFlags(running.flags, flags)) {
        return { status: 'running', autostart: true };
    }
    await enableAutostart(command, dataDir);
    return { status: running ? 'restarted' : 'started', autostart: true };
}
