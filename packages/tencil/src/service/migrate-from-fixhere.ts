import { cpSync, existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import pc from 'picocolors';
import { DEFAULT_PORT } from '../daemon/server.ts';
import {
    readServiceDefinition,
    removeService,
    type ServiceNames,
    servicePort,
} from './login-service.ts';

/** What Fixhere (Tencil's name up to 0.2.0) called its login service. */
export function fixhereServiceNames(port = DEFAULT_PORT): ServiceNames[] {
    const names = [{ label: 'dev.fixhere.daemon', unit: 'fixhere.service', task: 'Fixhere' }];
    if (port !== DEFAULT_PORT) {
        names.push({
            label: `dev.fixhere.daemon.${port}`,
            unit: `fixhere-${port}.service`,
            task: `Fixhere ${port}`,
        });
    }
    return names;
}

/** Files that move to Tencil's data folder: pins, pairing, settings. Not the runtime copy or logs. */
export function carriesOver(path: string): boolean {
    const name = basename(path);
    return !/^runtime(-\d+)?$/.test(name) && name !== 'daemon.log';
}

/**
 * Move a Fixhere install over to Tencil, once: copy its data folder, remove its
 * login service and stop its daemon, which would otherwise hold the port.
 */
export async function migrateFromFixhere(
    port: number,
    dataDir: string,
    log: (message: string) => void,
): Promise<void> {
    const steps: string[] = [];

    const oldDir = join(dirname(dataDir), 'fixhere');
    if (existsSync(oldDir) && !existsSync(dataDir)) {
        cpSync(oldDir, dataDir, { recursive: true, filter: carriesOver });
        steps.push('pins and pairing');
    }

    for (const names of fixhereServiceNames(port)) {
        if (servicePort(readServiceDefinition(names)) !== port) continue;
        removeService(names);
        steps.push('login service');
    }

    if (await stopFixhereDaemon(port)) steps.push('daemon');

    if (steps.length) {
        log(
            `\n  ${pc.green('✓')} Moved Fixhere over to Tencil ${pc.dim(`(${[...new Set(steps)].join(', ')})`)}`,
        );
    }
}

/** A Fixhere daemon on `port` answers /health as "fixhere"; stop it so Tencil can listen. */
async function stopFixhereDaemon(port: number): Promise<boolean> {
    const health = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(1_500),
    })
        .then(response => response.json() as Promise<{ name?: string; pid?: number }>)
        .catch(() => undefined);
    if (health?.name !== 'fixhere' || !health.pid) return false;
    try {
        process.kill(health.pid, 'SIGTERM');
    } catch {
        return false;
    }
    for (let attempt = 0; attempt < 50; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        const stillThere = await fetch(`http://127.0.0.1:${port}/health`, {
            signal: AbortSignal.timeout(500),
        }).catch(() => undefined);
        if (!stillThere) return true;
    }
    return true;
}
