import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ImageStore } from '@tencildev/bridge';
import { dataUrlType } from '@tencildev/protocol';
import { defaultDataDir, projectStorePath } from './thread-store.ts';

const EXTENSIONS: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
};
const ID = /^[a-f0-9]{32}$/;

/** A project's images live next to its pins: `<slug>-<hash>.images/<id>.png`. */
export function projectImagesPath(projectRoot: string, dataDir = defaultDataDir()): string {
    return projectStorePath(projectRoot, dataDir).replace(/\.json$/, '.images');
}

/**
 * The images agents showed in one project's pins, one file per image so they
 * stay readable when browsing. Writes happen in the background; screenshots
 * of the user's app are as private as the pins, so the folder is the user's only.
 */
export class FileImageStore implements ImageStore {
    /** Ids saved (or being saved) by this daemon, and their file names. */
    readonly #files = new Map<string, string>();
    #writing: Promise<void> = Promise.resolve();

    constructor(readonly path: string) {}

    put(id: string, dataUrl: string): void {
        const type = dataUrlType(dataUrl);
        const extension = type && EXTENSIONS[type];
        if (!ID.test(id) || !extension || this.#files.has(id)) return;
        const file = `${id}.${extension}`;
        this.#files.set(id, file);
        const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
        this.#writing = this.#writing.then(async () => {
            try {
                await mkdir(this.path, { recursive: true, mode: 0o700 });
                await writeFile(join(this.path, file), bytes, { mode: 0o600 });
            } catch {
                // Not saved: it's still in the agent's thread, and shows again on the next replay.
                this.#files.delete(id);
            }
        });
    }

    async get(id: string): Promise<string | undefined> {
        if (!ID.test(id)) return undefined;
        await this.#writing;
        const known = this.#files.get(id);
        const files = known ? [known] : Object.values(EXTENSIONS).map(ext => `${id}.${ext}`);
        for (const file of files) {
            const bytes = await readFile(join(this.path, file)).catch(() => undefined);
            if (!bytes) continue;
            const type = Object.entries(EXTENSIONS).find(([, ext]) => file.endsWith(`.${ext}`))![0];
            this.#files.set(id, file);
            return `data:${type};base64,${bytes.toString('base64')}`;
        }
        return undefined;
    }

    delete(id: string): void {
        if (!ID.test(id)) return;
        this.#files.delete(id);
        this.#writing = this.#writing.then(async () => {
            for (const ext of Object.values(EXTENSIONS)) {
                await rm(join(this.path, `${id}.${ext}`), { force: true }).catch(() => {});
            }
        });
    }

    /** Wait until every image so far is written (or removed). */
    flush(): Promise<void> {
        return this.#writing;
    }
}
