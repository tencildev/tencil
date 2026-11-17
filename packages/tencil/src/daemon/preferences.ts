import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Preferences } from '@tencildev/protocol';
import { z } from 'zod';
import { defaultDataDir } from './thread-store.ts';

const PreferencesFile = Preferences.extend({ version: z.literal(1) });

export function preferencesPath(dataDir = defaultDataDir()): string {
    return join(dataDir, 'preferences.json');
}

/**
 * The person's overlay preferences (theme, shortcuts), shared by every project
 * on this machine. One file, next to `settings.json`.
 */
export class FilePreferences {
    #cached: Preferences | undefined;
    /** Saves run one after another, so a quick second change can't land first. */
    #writing = Promise.resolve();

    constructor(readonly path = preferencesPath()) {}

    async load(): Promise<Preferences> {
        if (this.#cached) return this.#cached;
        const raw = await readFile(this.path, 'utf8').catch(() => undefined);
        let parsed: ReturnType<typeof PreferencesFile.safeParse> | undefined;
        try {
            parsed = raw === undefined ? undefined : PreferencesFile.safeParse(JSON.parse(raw));
        } catch {
            // A broken file counts as none; the next change writes a good one.
        }
        const { version: _, ...preferences } = parsed?.success ? parsed.data : { version: 1 };
        this.#cached = preferences;
        return preferences;
    }

    /** Merges `changes` into what's saved and returns the result. */
    async update(changes: Preferences): Promise<Preferences> {
        const next = { ...(await this.load()), ...changes };
        this.#cached = next;
        this.#writing = this.#writing.then(() => this.#write(next)).catch(() => {});
        await this.#writing;
        return next;
    }

    async #write(preferences: Preferences): Promise<void> {
        await mkdir(dirname(this.path), { recursive: true });
        const temp = `${this.path}.tmp`;
        await writeFile(temp, `${JSON.stringify({ version: 1, ...preferences }, null, 2)}\n`);
        await rename(temp, this.path);
    }
}
