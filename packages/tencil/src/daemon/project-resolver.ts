import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { ensembleThreadId } from '@tencildev/provider-ensemble';

const run = promisify(execFile);

/** Runs a command and returns stdout; injectable so tests don't depend on the OS. */
export type Exec = (command: string, args: string[]) => Promise<string>;

/** The `ensemble://thread/<id>` root of the Ensemble thread whose dev server listens on `port`. */
export type EnsembleForPort = (port: number) => Promise<string | undefined>;

const defaultExec: Exec = async (command, args) =>
    (await run(command, args, { timeout: 3_000, windowsHide: true })).stdout;

/**
 * Works out which project folder a page belongs to:
 *   1. the Ensemble thread whose dev server listens on the port,
 *   2. the repository root the Vite or Next loader sent, if it's a git checkout,
 *   3. the dev server's working directory, found from the port it listens on,
 *   4. what the user picked for this address before (a folder or an Ensemble thread).
 * Picks come last: ports get reused (5173 is every Vite app's default), so a pick
 * only stands in for what can't be detected. Returns undefined when nothing works;
 * the overlay then asks.
 */
export class ProjectResolver {
    readonly #memory: OriginMemory;
    readonly #exec: Exec;
    readonly #platform: NodeJS.Platform;
    readonly #ensembleForPort?: EnsembleForPort;

    constructor(options: {
        dataDir: string;
        exec?: Exec;
        platform?: NodeJS.Platform;
        ensembleForPort?: EnsembleForPort;
    }) {
        this.#memory = new OriginMemory(join(options.dataDir, 'origins.json'));
        this.#exec = options.exec ?? defaultExec;
        this.#platform = options.platform ?? process.platform;
        this.#ensembleForPort = options.ensembleForPort;
    }

    async resolve(pageUrl: string, claimedRoot?: string): Promise<string | undefined> {
        const origin = safeOrigin(pageUrl);
        if (!origin) return undefined;
        const port = portOf(origin);
        // A dev server an Ensemble thread runs belongs to that thread, whichever folder it runs in.
        const thread = port
            ? await this.#ensembleForPort?.(port).catch(() => undefined)
            : undefined;
        if (thread) return thread;
        if (claimedRoot && isGitRoot(claimedRoot)) return resolve(claimedRoot);
        const folder = port ? await this.folderForPort(port).catch(() => undefined) : undefined;
        if (folder) return projectRoot(folder);
        const remembered = await this.#memory.get(origin);
        return remembered && (ensembleThreadId(remembered) || existsSync(remembered))
            ? remembered
            : undefined;
    }

    /** Remember the user's choice for an address (from the overlay's project picker). */
    remember(pageUrl: string, root: string): Promise<void> {
        const origin = safeOrigin(pageUrl);
        return origin ? this.#memory.set(origin, projectKey(root)) : Promise.resolve();
    }

    /**
     * Folder of the process listening on `port`: its working directory, or its script's
     * package. When Docker publishes the port, the compose project of the container.
     */
    async folderForPort(port: number): Promise<string | undefined> {
        const pids = await this.#listeners(port);
        // Linux hides root's sockets (docker-proxy) from other users, and Docker without
        // its userland proxy has no listener at all.
        if (pids.length === 0 && this.#platform === 'linux') return this.#composeFolder(port);
        for (const pid of pids) {
            const cwd = await this.#cwd(pid).catch(() => undefined);
            if (cwd && cwd !== sep && existsSync(join(cwd, 'package.json'))) return cwd;
            const commandLine = await this.#commandLine(pid).catch(() => '');
            if (isDockerForwarder(commandLine)) return this.#composeFolder(port);
            const fromCommand = projectFromCommandLine(commandLine);
            if (fromCommand) return fromCommand;
        }
        return undefined;
    }

    /** Working directory of the compose project whose container publishes `port`. */
    async #composeFolder(port: number): Promise<string | undefined> {
        const output = await this.#exec('docker', [
            'ps',
            '--filter',
            `publish=${port}`,
            '--format',
            '{{.Label "com.docker.compose.project.working_dir"}}',
        ]).catch(() => '');
        return firstLine(output);
    }

    async #listeners(port: number): Promise<number[]> {
        if (this.#platform === 'win32') {
            // No `-p TCP`: it lists IPv4 only, and Vite on localhost listens on [::1].
            return parseNetstat(await this.#exec('netstat', ['-ano']), port);
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

/**
 * A folder with `.git` in it: a checkout, or a worktree (where `.git` is a
 * file). Any local page can claim a root, so only accept a real repository;
 * that's the same trust as picking it in the overlay.
 */
export function isGitRoot(folder: string): boolean {
    return isAbsolute(folder) && existsSync(join(folder, '.git'));
}

/** How the daemon keys a project: an `ensemble://thread/<id>` root as is, a folder by its absolute path. */
export function projectKey(root: string): string {
    return ensembleThreadId(root) === undefined ? resolve(root) : root;
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
 * Processes that forward a published container port to the host: Docker Desktop
 * (`com.docker.backend`, `vpnkit` before 4.x), Docker Engine on Linux (`docker-proxy`),
 * OrbStack (`OrbStack Helper`), Colima and Rancher Desktop (`limactl`), Podman (`gvproxy`)
 * and WSL 2's localhost relay (`wslrelay`).
 */
export function isDockerForwarder(commandLine: string): boolean {
    return /(?:^|[\\/"])(?:com\.docker\.backend|vpnkit|docker-proxy|OrbStack Helper|limactl|gvproxy|wslrelay)(?:\.exe)?(?:["\s]|$)/i.test(
        commandLine.trim(),
    );
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

function firstLine(output: string): string | undefined {
    return output
        .split(/\r?\n/)
        .map(line => line.trim())
        .find(Boolean);
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
