import { spawn } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_PORT, probeDaemon } from '../daemon/server.ts';
import { VERSION } from '../version.ts';
import { type DaemonCommand, daemonArgs } from './daemon-command.ts';

/**
 * Start the daemon in the background unless it already runs. A daemon from an
 * older Fixhere version is replaced so pages always get the current overlay.
 */
export async function startInBackground(
    command: DaemonCommand,
    dataDir: string,
): Promise<{ status: 'started' | 'running' | 'restarted'; pid: number }> {
    const running = await probeDaemon(command.port);
    if (running && running.version === VERSION) return { status: 'running', pid: running.pid };
    if (running) await stopDaemon(command.port);

    mkdirSync(dataDir, { recursive: true });
    const logFile = openSync(join(dataDir, 'daemon.log'), 'a');
    const child = spawn(command.node, daemonArgs(command), {
        detached: true,
        stdio: ['ignore', logFile, logFile],
        windowsHide: true,
    });
    child.unref();

    for (let attempt = 0; attempt < 50; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        const health = await probeDaemon(command.port);
        if (health) return { status: running ? 'restarted' : 'started', pid: health.pid };
    }
    throw new Error(`The daemon didn't start. See ${join(dataDir, 'daemon.log')}.`);
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
