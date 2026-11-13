import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AgentModels, ModelCache } from '@tencildev/provider-acp';
import { z } from 'zod';

const Models = z.object({
    configId: z.string(),
    choices: z.array(
        z.object({ value: z.string(), name: z.string(), group: z.string().optional() }),
    ),
    defaultModel: z.string().optional(),
});

/** Where the ACP agents' models are kept: `acp-models.json` in Tencil's data folder. */
export function acpModelsPath(dataDir: string): string {
    return join(dataDir, 'acp-models.json');
}

/**
 * The models each ACP agent offers, as its sessions last listed them, by agent
 * id. Agents only name their models per session, so this is how the model
 * picker has them before a project's first pin, and after a restart.
 */
export class AcpModelStore {
    readonly #path: string;
    #models: Promise<Record<string, AgentModels>> | undefined;
    #writes: Promise<void> = Promise.resolve();

    constructor(path: string) {
        this.#path = path;
    }

    /** One agent's models, for its providers in every project. */
    for(agentId: string): ModelCache {
        return {
            get: async () => (await this.#read())[agentId],
            set: models => {
                void this.#save(agentId, models);
            },
        };
    }

    #read(): Promise<Record<string, AgentModels>> {
        this.#models ??= readFile(this.#path, 'utf8')
            .then(raw => {
                const file = JSON.parse(raw) as unknown;
                if (!file || typeof file !== 'object' || Array.isArray(file)) return {};
                // Keep the agents whose entry still reads; drop the rest.
                return Object.fromEntries(
                    Object.entries(file).flatMap(([id, entry]) => {
                        const parsed = Models.safeParse(entry);
                        return parsed.success ? [[id, parsed.data]] : [];
                    }),
                );
            })
            .catch(() => ({}));
        return this.#models;
    }

    /** Written one after another, and only when the list changed. */
    async #save(agentId: string, models: AgentModels): Promise<void> {
        const all = await this.#read();
        if (JSON.stringify(all[agentId]) === JSON.stringify(models)) return;
        all[agentId] = models;
        const text = `${JSON.stringify(all, null, 2)}\n`;
        this.#writes = this.#writes
            .then(async () => {
                await mkdir(dirname(this.#path), { recursive: true });
                await writeFile(`${this.#path}.tmp`, text);
                await rename(`${this.#path}.tmp`, this.#path);
            })
            .catch(() => {});
        await this.#writes;
    }
}
