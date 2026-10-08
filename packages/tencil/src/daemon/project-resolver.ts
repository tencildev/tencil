import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Runs a command and returns stdout; injectable so tests don't depend on the OS. */
export type Exec = (command: string, args: string[]) => Promise<string>;

const defaultExec: Exec = async (command, args) =>
    (await run(command, args, { timeout: 3_000, windowsHide: true })).stdout;

/**
 * Works out which project folder a page belongs to:
 *   1. what the user picked for this address before,
 *   2. the dev server's working directory, found from the port it listens on.
 * Returns undefined when neither works; the overlay then asks.
 */
export class ProjectResolver {
    readonly #memory: OriginMemory;
    readonly #exec: Exec;
    readonly #platform: NodeJS.Platform;

    constructor(options: { dataDir: string; exec?: Exec; platform?: NodeJS.Platform }) {
        this.#memory = new OriginMemory(join(options.dataDir, 'origins.json'));
        this.#exec = options.exec ?? defaultExec;
        this.#platform = options.platform ?? process.platform;
    }

    async resolve(pageUrl: string): Promise<string | undefined> {
        const origin = safeOrigin(pageUrl);
        if (!origin) return undefined;
        const remembered = await this.#memory.get(origin);
        if (remembered && existsSync(remembered)) return remembered;
        const port = portOf(origin);
        if (!port) return undefined;
        const folder = await this.folderForPort(port).catch(() => undefined);
        return folder ? projectRoot(folder) : undefined;
    }

    /** Remember the user's choice for an address (from the overlay's project picker). */
    remember(pageUrl: string, root: string): Promise<void> {
        const origin = safeOrigin(pageUrl);
        return origin ? this.#memory.set(origin, resolve(root)) : Promise.resolve();
    }

    /** Folder of the process listening on `port`: its working directory, or its script's package. */
    async folderForPort(port: number): Promise<string | undefined> {
        for (const pid of await this.#listeners(port)) {
            const cwd = await this.#cwd(pid).catch(() => undefined);
            if (cwd && cwd !== sep && existsSync(join(cwd, 'package.json'))) return cwd;
            const fromCommand = projectFromCommandLine(
                await this.#commandLine(pid).catch(() => ''),
            );
            if (fromCommand) return fromCommand;
        }
        return undefined;
    }

    async #listeners(port: number): Promise<number[]> {
        if (this.#platform === 'win32') {
            return parseNetstat(await this.#exec('netstat', ['-ano', '-p', 'TCP']), port);
        }
        try {
            return parsePids(
                await this.#exec('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']),
            );
        } catch (error) {
            // Minimal Linux installs have `ss` but not `lsof`.
            if (this.#platform !== 'linux') throw error;
            return parseSs(await this.#exec('ss', ['-Hltnp', `sport = :${port}`]));
        }
    }

    async #cwd(pid: number): Promise<string | undefined> {
        if (this.#platform === 'linux') return readlink(`/proc/${pid}/cwd`);
        if (this.#platform === 'win32') return undefined;
        return parseLsofCwd(
            await this.#exec('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']),
        );
    }

    async #commandLine(pid: number): Promise<string> {
        if (this.#platform === 'win32') {
            return this.#exec('powershell', [
                '-NoProfile',
                '-Command',
                `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
            ]);
        }
        return this.#exec('ps', ['-o', 'command=', '-p', String(pid)]);
    }
}

/** Closest folder with a package.json at or above `folder`, or `folder` itself. */
export function projectRoot(folder: string): string {
    let dir = resolve(folder);
    while (true) {
        if (existsSync(join(dir, 'package.json'))) return dir;
        const parent = dirname(dir);
        if (parent === dir) return resolve(folder);
        dir = parent;
    }
}

export function parsePids(output: string): number[] {
    return [...new Set(output.split(/\s+/).filter(Boolean).map(Number).filter(Number.isInteger))];
}

/** `lsof -Fn` prints fields one per line; the path is on the line starting with `n`. */
export function parseLsofCwd(output: string): string | undefined {
    return output
        .split('\n')
        .find(line => line.startsWith('n'))
        ?.slice(1)
        .trim();
}

/** PIDs from `ss -Hltnp`: `users:(("node",pid=4242,fd=23))`. */
export function parseSs(output: string): number[] {
    return [...new Set([...output.matchAll(/pid=(\d+)/g)].map(match => Number(match[1])))];
}

/** PIDs in LISTENING state on `port` from `netstat -ano`. */
export function parseNetstat(output: string, port: number): number[] {
    const pids = output
        .split(/\r?\n/)
        .map(line => line.trim().split(/\s+/))
        .filter(
            ([proto, local, , state]) =>
                proto === 'TCP' && state === 'LISTENING' && local?.endsWith(`:${port}`),
        )
        .map(columns => Number(columns.at(-1)));
    return [...new Set(pids.filter(Number.isInteger))];
}

/**
 * Dev servers are started from a project's node_modules
 * (`…/eyes/apps/frontend/node_modules/next/dist/bin/next dev`): the part
 * before `node_modules` is the project.
 */
export function projectFromCommandLine(commandLine: string): string | undefined {
    const match = commandLine.match(
        /(?:^|[\s"'])((?:[A-Za-z]:)?[\\/][^\s"']*?)[\\/]node_modules[\\/]/,
    );
    return match?.[1];
}

function safeOrigin(pageUrl: string): string | undefined {
    try {
        return new URL(pageUrl).origin;
    } catch {
        return undefined;
    }
}

function portOf(origin: string): number | undefined {
    const url = new URL(origin);
    if (url.port) return Number(url.port);
    return url.protocol === 'https:' ? 443 : url.protocol === 'http:' ? 80 : undefined;
}

/** Remembered address → project choices, e.g. for dev servers in containers. */
class OriginMemory {
    constructor(readonly path: string) {}

    async get(origin: string): Promise<string | undefined> {
        return (await this.#read())[origin];
    }

    async set(origin: string, root: string): Promise<void> {
        const all = await this.#read();
        all[origin] = root;
        await mkdir(dirname(this.path), { recursive: true });
        await writeFile(this.path, `${JSON.stringify(all, null, 2)}\n`);
    }

    async #read(): Promise<Record<string, string>> {
        try {
            return JSON.parse(await readFile(this.path, 'utf8'));
        } catch {
            return {};
        }
    }
}
