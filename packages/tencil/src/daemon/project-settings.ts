import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ProjectSettingsStore, SavedProjectSettings } from '@tencildev/bridge';
import { z } from 'zod';
import { defaultDataDir, projectStorePath } from './thread-store.ts';

const SettingsFile = z.object({
    version: z.literal(1),
    /** The provider new pins go to; unset means the daemon's `--provider`. */
    provider: z.string().optional(),
    /** Model picked per provider for new threads; unset means the provider's default. */
    models: z.record(z.string(), z.string()).optional(),
    /** Queue new comments and send them together. */
    batch: z.boolean().optional(),
});

/** A project's settings live next to its pins: `<slug>-<hash>.settings.json`. */
export function projectSettingsPath(projectRoot: string, dataDir = defaultDataDir()): string {
    return projectStorePath(projectRoot, dataDir).replace(/\.json$/, '.settings.json');
}

/** A project's overlay settings (provider, models, batching) in a JSON file. */
export class FileProjectSettings implements ProjectSettingsStore {
    constructor(readonly path: string) {}

    async load(): Promise<SavedProjectSettings | undefined> {
        const raw = await readFile(this.path, 'utf8').catch(() => undefined);
        const parsed = raw === undefined ? undefined : SettingsFile.safeParse(JSON.parse(raw));
        return parsed?.success ? parsed.data : undefined;
    }

    async save(settings: SavedProjectSettings): Promise<void> {
        await mkdir(dirname(this.path), { recursive: true });
        const temp = `${this.path}.tmp`;
        await writeFile(
            temp,
            `${JSON.stringify(
                {
                    version: 1,
                    provider: settings.provider,
                    models: settings.models,
                    batch: settings.batch,
                },
                null,
                2,
            )}\n`,
        );
        await rename(temp, this.path);
    }
}
