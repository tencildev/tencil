import { spawn } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_PORT, probeDaemon } from '../daemon/server.ts';
import { VERSION } from '../version.ts';
import { type DaemonCommand, daemonArgs } from './daemon-command.ts';
import { isNewerThanThis } from './versions.ts';

/**
 * Start the daemon in the background unless it already runs. A daemon from an
 * older Tencil version is replaced so pages always get the current overlay;
 * so is one running with other flags than the ones given. Without flags of
 * its own, a replacement keeps the running daemon's (`--listen`, `--t3-url`, …).
 */
export async function startInBackground(
    command: DaemonCommand,
    dataDir: string,
): Promise<{ status: 'started' | 'running' | 'restarted'; pid: number; newer?: string }> {
    const running = await probeDaemon(command.port);
    if (running && isNewerThanThis(running.version)) {
        return { status: 'running', pid: running.pid, newer: running.version };
    }
    const flags = command.args?.length ? command.args : (running?.flags ?? []);
    if (running && running.version === VERSION && sameFlags(running.flags, flags)) {
        return { status: 'running', pid: running.pid };
    }
    if (running) await stopDaemon(command.port);

    mkdirSync(dataDir, { recursive: true });
    const logFile = openSync(join(dataDir, 'daemon.log'), 'a');
    const child = spawn(command.node, daemonArgs({ ...command, args: flags }), {
        detached: true,
        stdio: ['ignore', logFile, logFile],
        windowsHide: true,
    });
    child.unref();

    const health = await waitForDaemon(command.port, dataDir);
    return { status: running ? 'restarted' : 'started', pid: health.pid };
}

/** Wait for a daemon on `port` (optionally one of `version`) to answer. */
export async function waitForDaemon(
    port: number,
    dataDir: string,
    version?: string,
): Promise<{ pid: number }> {
    for (let attempt = 0; attempt < 100; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        const health = await probeDaemon(port);
        if (health && (!version || health.version === version)) return health;
    }
    throw new Error(`The daemon didn't start. See ${join(dataDir, 'daemon.log')}.`);
}

export function sameFlags(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((flag, i) => flag === b[i]);
}

/** Stop the daemon answering on `port`. Returns false when none was running. */
export async function stopDaemon(port = DEFAULT_PORT): Promise<boolean> {
    const running = await probeDaemon(port);
    if (!running) return false;
    try {
        process.kill(running.pid, 'SIGTERM');
    } catch {
        return false;
    }
    for (let attempt = 0; attempt < 50; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        if (!(await probeDaemon(port))) return true;
    }
    return true;
}
