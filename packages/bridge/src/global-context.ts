/**
 * Instructions that go with every pin of every project. They're machine state
 * (account state for Tencil Cloud), so the host keeps them and shares one store
 * between all of its bridges.
 */
export interface GlobalContextStore {
    /** The saved text, empty when there is none. Hosts load it before a bridge reads it. */
    get(): string;
    set(context: string): Promise<void>;
    /** Fires after every change, so each bridge can tell its overlays. */
    onChange(listener: () => void): () => void;
}

/** A global context that lasts as long as the process; for tests and hosts without storage. */
export class MemoryGlobalContext implements GlobalContextStore {
    #context: string;
    readonly #listeners = new Set<() => void>();

    constructor(context = '') {
        this.#context = context;
    }

    get(): string {
        return this.#context;
    }

    async set(context: string): Promise<void> {
        if (context === this.#context) return;
        this.#context = context;
        for (const listener of this.#listeners) listener();
    }

    onChange(listener: () => void): () => void {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }
}
