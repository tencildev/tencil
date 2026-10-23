import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import type { EnsembleClient, EnsembleProject } from './api.ts';

const run = promisify(execFile);

/** Where the pins of a page served from a folder go. */
export type FolderTarget =
    | { kind: 'thread'; threadId: string }
    | { kind: 'project'; project: EnsembleProject }
    /** No Ensemble project holds the folder; `repository` is the one to add. */
    | { kind: 'missing'; repository: string };

interface GitInfo {
    branch?: string;
    /** The checkout's top folder. */
    top: string;
    /** The main checkout, for a worktree of another repository. */
    main?: string;
}

/**
 * The Ensemble target for a page whose dev server runs in `folder`:
 * - inside an Ensemble project's folder, it's the user's own checkout: each pin starts a thread.
 * - on the branch of one open thread, it's that thread's workspace: pins go to the thread.
 * - a worktree of a project's repository counts as that project.
 */
export async function targetForFolder(
    client: EnsembleClient,
    folder: string,
): Promise<FolderTarget> {
    const dir = await realpath(folder).catch(() => folder);
    const [projects, git] = await Promise.all([client.projects(), gitInfo(dir)]);
    const folders = await Promise.all(
        projects.map(async project =>
            project.source.kind === 'local'
                ? { project, path: await realpath(project.source.path).catch(() => '') }
                : undefined,
        ),
    );
    const local = folders.filter(entry => entry?.path) as Array<{
        project: EnsembleProject;
        path: string;
    }>;
    const own = deepest(local, dir);
    if (own) return { kind: 'project', project: own };
    if (git?.branch) {
        const threads = (await client.threads()).filter(thread => thread.branch === git.branch);
        if (threads.length === 1 && threads[0]) {
            return { kind: 'thread', threadId: threads[0].id };
        }
    }
    if (git?.main) {
        const project = deepest(local, join(git.main, relative(git.top, dir)));
        if (project) return { kind: 'project', project };
    }
    return { kind: 'missing', repository: git?.main ?? git?.top ?? dir };
}

/** The project whose folder holds `dir` most closely. */
function deepest(
    folders: Array<{ project: EnsembleProject; path: string }>,
    dir: string,
): EnsembleProject | undefined {
    let best: { project: EnsembleProject; depth: number } | undefined;
    for (const { project, path } of folders) {
        if (dir !== path && !dir.startsWith(path.endsWith(sep) ? path : `${path}${sep}`)) {
            continue;
        }
        const depth = path.split(sep).length;
        if (!best || depth > best.depth) best = { project, depth };
    }
    return best?.project;
}

async function gitInfo(dir: string): Promise<GitInfo | undefined> {
    try {
        const { stdout } = await run(
            'git',
            [
                '-C',
                dir,
                'rev-parse',
                '--abbrev-ref',
                'HEAD',
                '--show-toplevel',
                '--path-format=absolute',
                '--git-common-dir',
            ],
            { timeout: 3_000, windowsHide: true },
        );
        const [branch, top, common] = stdout.trim().split('\n');
        if (!top || !common) return undefined;
        const realTop = await realpath(top).catch(() => top);
        const repository = basename(common) === '.git' ? dirname(common) : undefined;
        const main = repository && (await realpath(repository).catch(() => repository));
        return {
            branch: branch && branch !== 'HEAD' ? branch : undefined,
            top: realTop,
            main: main && main !== realTop ? main : undefined,
        };
    } catch {
        return undefined;
    }
}
