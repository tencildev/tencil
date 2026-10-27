import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { settleInterrupted, type ThreadStore } from '@tencildev/bridge';
import { Thread } from '@tencildev/protocol';
import { z } from 'zod';
import { projectKey } from './project-resolver.ts';

const StoreFile = z.object({
    version: z.literal(1),
    /** Project the pins belong to; informational, the file name is the key. */
    root: z.string().optional(),
    threads: z.array(Thread),
});

/** Where Tencil keeps per-machine state, shared by every project. */
export function defaultDataDir(): string {
    return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'tencil');
}

/**
 * One file per project under the global data dir, named after the folder plus
 * a hash of its path: readable when browsing, unique per checkout, and never
 * shared between two bridges.
 */
export function projectStorePath(projectRoot: string, dataDir = defaultDataDir()): string {
    const root = projectKey(projectRoot);
    const hash = createHash('sha256').update(root).digest('hex').slice(0, 10);
    const slug =
        basename(root)
            .replace(/[^a-z0-9._-]+/gi, '-')
            .slice(0, 40) || 'project';
    return join(dataDir, 'projects', `${slug}-${hash}.json`);
}

/**
 * Pins for one project, persisted outside the repo so they survive bridge
 * restarts without leaving files in the project. Writes are debounced and atomic.
 */
export class FileThreadStore implements ThreadStore {
    readonly path: string;
    readonly #root: string;
    #threads = new Map<string, Thread>();
    #writeTimer: ReturnType<typeof setTimeout> | undefined;
    #writing: Promise<void> = Promise.resolve();

    constructor(projectRoot: string, dataDir?: string) {
        this.#root = projectKey(projectRoot);
        this.path = projectStorePath(this.#root, dataDir);
    }

    async load(): Promise<void> {
        const raw = await readFile(this.path, 'utf8').catch(() => undefined);
        if (raw === undefined) return;
        const parsed = StoreFile.safeParse(JSON.parse(raw));
        if (!parsed.success) return;
        for (const thread of parsed.data.threads) {
            this.#threads.set(thread.id, settleInterrupted(thread));
        }
    }

    list(): Thread[] {
        return [...this.#threads.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }

    get(id: string): Thread | undefined {
        return this.#threads.get(id);
    }

    findByProviderThread(providerId: string, providerThreadId: string): Thread | undefined {
        for (const thread of this.#threads.values()) {
            if (
                thread.provider.id === providerId &&
                thread.provider.threadId === providerThreadId
            ) {
                return thread;
            }
        }
        return undefined;
    }

    upsert(thread: Thread): void {
        this.#threads.set(thread.id, thread);
        this.#scheduleWrite();
    }

    delete(id: string): boolean {
        const deleted = this.#threads.delete(id);
        if (deleted) this.#scheduleWrite();
        return deleted;
    }

    async flush(): Promise<void> {
        if (this.#writeTimer) {
            clearTimeout(this.#writeTimer);
            this.#writeTimer = undefined;
            this.#write();
        }
        await this.#writing;
    }

    #scheduleWrite(): void {
        if (this.#writeTimer) return;
        this.#writeTimer = setTimeout(() => {
            this.#writeTimer = undefined;
            this.#write();
        }, 250);
    }

    #write(): void {
        const body = `${JSON.stringify({ version: 1, root: this.#root, threads: this.list() }, null, 2)}\n`;
        this.#writing = this.#writing.then(async () => {
            await mkdir(dirname(this.path), { recursive: true });
            const temp = `${this.path}.tmp`;
            // Prompts and agent replies are private; same permissions as credentials.
            await writeFile(temp, body, { mode: 0o600 });
            await rename(temp, this.path);
        });
    }
}
