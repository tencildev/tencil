import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import type { ProjectSource } from '@tencildev/protocol';
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
/** A page's project, and how it was found. */
export interface Detected {
    root: string;
    source: ProjectSource;
}

type AutoDetected = Detected & { source: { via: 'ensemble' | 'plugin' | 'port' | 'docker' } };

function pickKey(origin: string, detected: string): string {
    return `${origin} ${detected}`;
}

export class ProjectResolver {
    readonly #memory: OriginMemory;
    /** Picks made over a detected project, by address and that project. */
    readonly #picks: OriginMemory;
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
        this.#picks = new OriginMemory(join(options.dataDir, 'project-picks.json'));
        this.#exec = options.exec ?? defaultExec;
        this.#platform = options.platform ?? process.platform;
        this.#ensembleForPort = options.ensembleForPort;
    }

    async resolve(pageUrl: string, claimedRoot?: string): Promise<string | undefined> {
        return (await this.detect(pageUrl, claimedRoot))?.root;
    }

    /**
     * The page's project and how it was found. A pick made over a detected
     * project only holds while that same project is detected on the address:
     * when another app takes the port, detection wins again.
     */
    async detect(pageUrl: string, claimedRoot?: string): Promise<Detected | undefined> {
        const origin = safeOrigin(pageUrl);
        if (!origin) return undefined;
        const found = await this.#automatic(origin, claimedRoot);
        if (found) {
            const picked = await this.#picks.get(pickKey(origin, found.root));
            const usable = picked && (ensembleThreadId(picked) || existsSync(picked));
            if (!usable || picked === found.root) return found;
            return {
                root: picked,
                source: { via: 'picked', detected: { root: found.root, ...found.source } },
            };
        }
        const remembered = await this.#memory.get(origin);
        return remembered && (ensembleThreadId(remembered) || existsSync(remembered))
            ? { root: remembered, source: { via: 'picked' } }
            : undefined;
    }

    /** Detection alone: Ensemble thread, the plugin's git root, then the port. */
    async #automatic(origin: string, claimedRoot?: string): Promise<AutoDetected | undefined> {
        const port = portOf(origin);
        // A dev server an Ensemble thread runs belongs to that thread, whichever folder it runs in.
        const thread = port
            ? await this.#ensembleForPort?.(port).catch(() => undefined)
            : undefined;
        if (thread) return { root: thread, source: { via: 'ensemble', port } };
        if (claimedRoot && isGitRoot(claimedRoot)) {
            return { root: resolve(claimedRoot), source: { via: 'plugin' } };
        }
        const found = port ? await this.#portFolder(port).catch(() => undefined) : undefined;
        if (!found || !port) return undefined;
        return {
            root: projectRoot(found.folder),
            source: { via: found.docker ? 'docker' : 'port', port },
        };
    }

    /**
     * Use `root` for this address while `detected` is what Tencil finds there
     * (the overlay's Change). Picking the detected project itself undoes it.
     */
    async pick(pageUrl: string, detected: string, root: string): Promise<void> {
        const origin = safeOrigin(pageUrl);
        if (!origin) return;
        const key = pickKey(origin, detected);
        if (projectKey(root) === detected) await this.#picks.delete(key);
        else await this.#picks.set(key, projectKey(root));
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
        return (await this.#portFolder(port))?.folder;
    }

    async #portFolder(port: number): Promise<{ folder: string; docker: boolean } | undefined> {
        const docker = async () => {
            const folder = await this.#composeFolder(port);
            return folder ? { folder, docker: true } : undefined;
        };
        const pids = await this.#listeners(port);
        // Linux hides root's sockets (docker-proxy) from other users, and Docker without
        // its userland proxy has no listener at all.
        if (pids.length === 0 && this.#platform === 'linux') return docker();
        for (const pid of pids) {
            const cwd = await this.#cwd(pid).catch(() => undefined);
            if (cwd && cwd !== sep && existsSync(join(cwd, 'package.json'))) {
                return { folder: cwd, docker: false };
            }
            const commandLine = await this.#commandLine(pid).catch(() => '');
            if (isDockerForwarder(commandLine)) return docker();
            const fromCommand = projectFromCommandLine(commandLine);
            if (fromCommand) return { folder: fromCommand, docker: false };
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
        await this.#write(all);
    }

    async delete(origin: string): Promise<void> {
        const all = await this.#read();
        if (!(origin in all)) return;
        delete all[origin];
        await this.#write(all);
    }

    async #write(all: Record<string, string>): Promise<void> {
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
