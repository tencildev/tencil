import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type Framework =
    | { kind: 'next-app'; layout: string }
    | { kind: 'next-pages'; document?: string }
    | { kind: 'vite'; config: string }
    | { kind: 'unknown'; reason: string };

export type PackageManager = 'pnpm' | 'yarn' | 'bun' | 'npm';

/** Inspect a project folder to decide how Fixhere should be wired in. */
export async function detectFramework(root: string): Promise<Framework> {
    const pkg = await readPackageJson(root);
    if (!pkg) return { kind: 'unknown', reason: 'No package.json in this folder.' };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const first = (candidates: string[]) => candidates.map(c => join(root, c)).find(existsSync);

    if (deps.next) {
        const layout = first(
            variants(['app/layout', 'src/app/layout'], ['tsx', 'jsx', 'ts', 'js']),
        );
        if (layout) return { kind: 'next-app', layout };
        const document = first(
            variants(['pages/_document', 'src/pages/_document'], ['tsx', 'jsx', 'ts', 'js']),
        );
        return { kind: 'next-pages', document };
    }

    const viteConfig = first(variants(['vite.config'], ['ts', 'mts', 'js', 'mjs', 'cts', 'cjs']));
    if (viteConfig) return { kind: 'vite', config: viteConfig };
    if (deps.vite)
        return { kind: 'unknown', reason: 'Vite is installed but no vite.config was found.' };

    return {
        kind: 'unknown',
        reason: "Couldn't detect Next.js or Vite. Add the script tag to your dev HTML instead.",
    };
}

/** Next.js and Vite apps up to two folders down (apps/web, packages/site), for monorepo roots. */
export async function findApps(root: string): Promise<Array<{ dir: string; label: string }>> {
    const apps: Array<{ dir: string; label: string }> = [];
    const visit = async (dir: string, depth: number) => {
        const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
            if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules')
                continue;
            const child = join(dir, entry.name);
            const framework = await detectFramework(child);
            if (framework.kind !== 'unknown') {
                apps.push({ dir: child, label: framework.kind === 'vite' ? 'Vite' : 'Next.js' });
            } else if (depth < 2) {
                await visit(child, depth + 1);
            }
        }
    };
    await visit(root, 1);
    return apps.sort((a, b) => a.dir.localeCompare(b.dir));
}

/** Walk up from `root` to the nearest lockfile; monorepo apps share the root's manager. */
export function detectPackageManager(root: string): PackageManager {
    let dir = root;
    while (true) {
        if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
        if (existsSync(join(dir, 'yarn.lock'))) return 'yarn';
        if (existsSync(join(dir, 'bun.lock')) || existsSync(join(dir, 'bun.lockb'))) return 'bun';
        if (existsSync(join(dir, 'package-lock.json'))) return 'npm';
        const parent = dirname(dir);
        if (parent === dir) return 'npm';
        dir = parent;
    }
}

export function installCommand(manager: PackageManager, spec: string): [string, string[]] {
    switch (manager) {
        case 'pnpm':
            return ['pnpm', ['add', '-D', spec]];
        case 'yarn':
            return ['yarn', ['add', '-D', spec]];
        case 'bun':
            return ['bun', ['add', '-d', spec]];
        default:
            return ['npm', ['install', '-D', spec]];
    }
}

function variants(bases: string[], extensions: string[]): string[] {
    return bases.flatMap(base => extensions.map(ext => `${base}.${ext}`));
}

async function readPackageJson(root: string): Promise<{
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
} | null> {
    try {
        return JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    } catch {
        return null;
    }
}
