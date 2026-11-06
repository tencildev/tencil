import { accessSync, constants, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { type SpawnAppServer, spawnAppServer } from './app-server.ts';

export const NOT_INSTALLED =
    "Codex isn't installed. Install it with `npm i -g @openai/codex`, then run `codex login`.";

/** Where the Codex desktop app keeps its copy of the CLI, inside ChatGPT or its own app. */
const APP_BINARIES = ['ChatGPT.app', 'Codex.app'].map(app =>
    join(app, 'Contents', 'Resources', 'codex'),
);

export interface FindCodexOptions {
    env?: Record<string, string | undefined>;
    platform?: NodeJS.Platform;
    /** Where a Mac keeps its apps. */
    applications?: string[];
}

/**
 * The Codex binary: the CLI on the PATH, otherwise the one in the desktop app.
 * Tencil never installs it. It's about 400 MB, and it's the user's own install
 * and login that pins run under, so setup says how to get it instead.
 */
export function findCodex(options: FindCodexOptions = {}): string | undefined {
    const platform = options.platform ?? process.platform;
    const names = platform === 'win32' ? ['codex.exe', 'codex.cmd'] : ['codex'];
    const onPath = ((options.env ?? process.env).PATH ?? '')
        .split(platform === 'win32' ? ';' : delimiter)
        .filter(Boolean)
        .flatMap(dir => names.map(name => join(dir, name)));
    const applications = options.applications ?? ['/Applications', join(homedir(), 'Applications')];
    const inApps =
        platform === 'darwin'
            ? applications.flatMap(dir => APP_BINARIES.map(binary => join(dir, binary)))
            : [];
    return [...onPath, ...inApps].find(isExecutable);
}

/** How to start Codex. Throws, saying how to fix it, when this machine has none. */
export function appServerSpawner(
    options: { command?: string; spawn?: SpawnAppServer },
    find = findCodex,
): SpawnAppServer {
    if (options.spawn) return options.spawn;
    const command = options.command ?? find();
    if (!command) throw new Error(NOT_INSTALLED);
    return () => spawnAppServer(command);
}

function isExecutable(path: string): boolean {
    try {
        accessSync(path, constants.X_OK);
        return statSync(path).isFile();
    } catch {
        return false;
    }
}
