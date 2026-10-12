import type { Thread } from '@tencildev/protocol';

/**
 * The pins of one project. The bridge reads and writes synchronously, so a
 * store keeps the project's pins in memory (load them before handing the
 * store to a bridge) and persists changes behind the scenes; `flush` waits
 * until every change so far is saved.
 */
export interface ThreadStore {
    /** Every pin, oldest first. */
    list(): Thread[];
    get(id: string): Thread | undefined;
    upsert(thread: Thread): void;
    /** False when there was no such pin. */
    delete(id: string): boolean;
    flush(): Promise<void>;
}

/** Keeps pins in memory only: for tests, and the reference for persistent stores. */
export class MemoryThreadStore implements ThreadStore {
    readonly #threads = new Map<string, Thread>();

    constructor(threads: Thread[] = []) {
        for (const thread of threads) this.#threads.set(thread.id, settleInterrupted(thread));
    }

    list(): Thread[] {
        return [...this.#threads.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }

    get(id: string): Thread | undefined {
        return this.#threads.get(id);
    }

    upsert(thread: Thread): void {
        this.#threads.set(thread.id, thread);
    }

    delete(id: string): boolean {
        return this.#threads.delete(id);
    }

    async flush(): Promise<void> {}
}

/**
 * A pin saved while its provider thread was still being created can't be
 * picked up again; stores apply this to pins they load from a previous run.
 * Everything else gets its real status from the provider once watched.
 */
export function settleInterrupted(thread: Thread): Thread {
    if (thread.status !== 'starting' || thread.provider.threadId) return thread;
    return {
        ...thread,
        status: 'error',
        statusDetail: 'Bridge stopped before the thread was created',
    };
}
