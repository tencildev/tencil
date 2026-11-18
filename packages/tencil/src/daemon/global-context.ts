import type { GlobalContextStore } from '@tencildev/bridge';
import { readSettings, writeSettings } from './agents.ts';
import { defaultDataDir } from './thread-store.ts';

/**
 * The instructions that go with every pin of every project on this machine,
 * kept as `context` in `settings.json` next to the machine's agent. One per
 * daemon, shared by every project's bridge.
 */
export class FileGlobalContext implements GlobalContextStore {
    #context = '';
    readonly #listeners = new Set<() => void>();
    /** Saves run one after another, so a quick second change can't land first. */
    #writing = Promise.resolve();

    constructor(readonly dataDir = defaultDataDir()) {}

    async load(): Promise<void> {
        this.#context = (await readSettings(this.dataDir)).context ?? '';
    }

    get(): string {
        return this.#context;
    }

    async set(context: string): Promise<void> {
        if (context === this.#context) return;
        this.#context = context;
        for (const listener of this.#listeners) listener();
        this.#writing = this.#writing
            .then(() => writeSettings({ context: context || undefined }, this.dataDir))
            .catch(() => {});
        await this.#writing;
    }

    onChange(listener: () => void): () => void {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }
}
