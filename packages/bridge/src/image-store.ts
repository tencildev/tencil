/**
 * The images agents showed in a project's messages, by id (a hash of the
 * image). Threads only keep the ids, so a pin stays small however many
 * screenshots its agent took; the overlay asks for each image once.
 */
export interface ImageStore {
    /** Keep `dataUrl` under `id`. Called again for images it already has; may save in the background. */
    put(id: string, dataUrl: string): void;
    get(id: string): Promise<string | undefined>;
    /** No pin shows it any more. */
    delete(id: string): void;
    /** Wait until every change so far is saved. */
    flush?(): Promise<void>;
}

/** Keeps images in memory only: for tests, and hosts with nowhere to keep them. */
export class MemoryImageStore implements ImageStore {
    readonly #images = new Map<string, string>();

    put(id: string, dataUrl: string): void {
        this.#images.set(id, dataUrl);
    }

    async get(id: string): Promise<string | undefined> {
        return this.#images.get(id);
    }

    delete(id: string): void {
        this.#images.delete(id);
    }

    get size(): number {
        return this.#images.size;
    }
}
