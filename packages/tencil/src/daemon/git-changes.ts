import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFile, rm, stat, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ChangeTracker } from '@tencildev/bridge';
import type { ChangeSpan } from '@tencildev/protocol';

/**
 * Git actions for a project on this machine. A snapshot is the tree of the
 * work tree, untracked files included, written through a scratch index so
 * the user's own index stays as it is. A span's edits are the diff between
 * two snapshots, so reverting undoes just those hunks: other uncommitted
 * work, even in the same file, stays where it is. Committing is the agent's
 * job; HEAD tells whether it did.
 */
export class GitChanges implements ChangeTracker {
    readonly #cwd: string;
    #top: string | undefined;
    /** One Git operation at a time, so a snapshot never sees half a revert. */
    #queue: Promise<unknown> = Promise.resolve();

    constructor(projectRoot: string) {
        this.#cwd = projectRoot;
    }

    snapshot(): Promise<string | undefined> {
        return this.#serial(async () => {
            const top = await this.#toplevel();
            if (!top) return undefined;
            return this.#withScratchIndex(top, async env => {
                await git(top, ['add', '--all'], { env });
                return (await git(top, ['write-tree'], { env })).trim();
            });
        });
    }

    files(spans: ChangeSpan[]): Promise<string[]> {
        return this.#serial(async () => {
            const top = await this.#require();
            const files = new Set<string>();
            for (const { from, to } of spans) {
                const out = await git(top, ['diff', '--name-only', '--no-renames', '-z', from, to]);
                for (const file of out.split('\0')) if (file) files.add(file);
            }
            return [...files].sort();
        });
    }

    head(): Promise<string | undefined> {
        return this.#serial(async () => {
            const top = await this.#toplevel();
            if (!top) return undefined;
            const out = await git(top, ['rev-parse', '--verify', '--quiet', 'HEAD']).catch(
                () => '',
            );
            return out.trim() || undefined;
        });
    }

    revert(spans: ChangeSpan[]): Promise<void> {
        return this.#serial(async () => {
            const top = await this.#require();
            // Undo the spans, newest first, on a copy of the work tree; only a
            // clean result touches the real one, in a single patch.
            const { now, target } = await this.#withScratchIndex(top, async env => {
                await git(top, ['add', '--all'], { env });
                const now = (await git(top, ['write-tree'], { env })).trim();
                for (const span of [...spans].reverse()) {
                    await applyPatch(top, await patch(top, span), ['--cached', '-R'], env).catch(
                        (error: Error) => {
                            throw new Error(
                                `The agent's lines${inFile(error)} changed since, so they can't be reverted here. Undo them in your editor.`,
                            );
                        },
                    );
                }
                return { now, target: (await git(top, ['write-tree'], { env })).trim() };
            });
            if (now === target) return;
            await applyPatch(
                top,
                await gitBytes(top, ['diff', '--binary', '--full-index', now, target]),
            );
        });
    }

    #serial<T>(task: () => Promise<T>): Promise<T> {
        const run = this.#queue.then(task, task);
        this.#queue = run.catch(() => {});
        return run;
    }

    async #toplevel(): Promise<string | undefined> {
        if (this.#top) return this.#top;
        // Not cached when missing: `git init` later turns Git actions on.
        const out = await git(this.#cwd, ['rev-parse', '--show-toplevel']).catch(() => undefined);
        this.#top = out?.trim() || undefined;
        return this.#top;
    }

    async #require(): Promise<string> {
        const top = await this.#toplevel();
        if (!top) throw new Error("This project isn't in a Git repository");
        return top;
    }

    /**
     * A copy of the real index, so files Git already hashed aren't read again.
     * It keeps the index's timestamps: Git rehashes a file edited in the same
     * instant as the index was written only when it can see that.
     */
    async #withScratchIndex<T>(
        top: string,
        task: (env: Record<string, string>) => Promise<T>,
    ): Promise<T> {
        const index = join(tmpdir(), `tencil-index-${randomUUID()}`);
        try {
            const real = resolve(
                top,
                (await git(top, ['rev-parse', '--git-path', 'index'])).trim(),
            );
            await stat(real)
                .then(async ({ atime, mtime }) => {
                    await copyFile(real, index);
                    await utimes(index, atime, mtime);
                })
                // No index yet: Git hashes everything.
                .catch(() => rm(index, { force: true }));
            return await task({ GIT_INDEX_FILE: index });
        } finally {
            await rm(index, { force: true });
        }
    }
}

/** Patches stay bytes: a file in another encoding must come back unchanged. */
function patch(top: string, { from, to }: ChangeSpan): Promise<Buffer> {
    return gitBytes(top, ['diff', '--binary', '--full-index', '--no-renames', from, to]);
}

async function applyPatch(
    top: string,
    diff: Buffer,
    flags: string[] = [],
    env?: Record<string, string>,
): Promise<void> {
    if (diff.length === 0) return;
    await gitBytes(top, ['apply', '--whitespace=nowarn', ...flags], { env, input: diff });
}

/** ` in src/app.tsx`, from `git apply`'s error, when it names the file. */
function inFile(error: Error): string {
    const file = /error: (.+?): patch does not apply/.exec(error.message)?.[1];
    return file ? ` in ${file}` : '';
}

interface GitOptions {
    env?: Record<string, string>;
    input?: string | Buffer;
}

async function git(cwd: string, args: string[], options: GitOptions = {}): Promise<string> {
    return (await gitBytes(cwd, args, options)).toString('utf8');
}

function gitBytes(cwd: string, args: string[], options: GitOptions = {}): Promise<Buffer> {
    return new Promise((resolvePromise, reject) => {
        const { GIT_INDEX_FILE: _inherited, ...env } = process.env;
        const child = spawn('git', args, {
            cwd,
            env: { ...env, ...options.env, GIT_TERMINAL_PROMPT: '0' },
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        child.stdout.on('data', chunk => stdout.push(chunk));
        child.stderr.on('data', chunk => stderr.push(chunk));
        child.on('error', reject);
        child.on('close', code => {
            if (code === 0) return resolvePromise(Buffer.concat(stdout));
            const message = Buffer.concat(stderr).toString('utf8').trim();
            reject(new Error(message || `git ${args[0]} exited with ${code}`));
        });
        // Git can exit before it reads stdin (EPIPE); its exit code and
        // stderr above tell what went wrong.
        child.stdin.on('error', () => {});
        child.stdin.end(options.input);
    });
}
