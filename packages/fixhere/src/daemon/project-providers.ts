import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Provider, ProviderOption } from '@fixhere/protocol';
import { z } from 'zod';

const SettingsFile = z.object({
    version: z.literal(1),
    /** The provider new pins go to; unset means the daemon's `--provider`. */
    provider: z.string().optional(),
});

export interface ProjectProvidersOptions {
    /** Providers the project can pick from. */
    choices: ProviderOption[];
    /** Used until the project picks one: the daemon's `--provider`. */
    fallback: string;
    create: (id: string) => Provider;
    /** Where the project's choice is saved; in memory only when absent. */
    settingsPath?: string;
}

/**
 * The providers of one project. New pins go to the project's default, which
 * the overlay's settings change; existing pins keep the provider they were
 * made with. Providers are created and started on first use.
 */
export class ProjectProviders {
    readonly choices: ProviderOption[];
    readonly #options: ProjectProvidersOptions;
    readonly #providers = new Map<string, Provider>();
    readonly #listeners = new Set<() => void>();
    #chosen: string | undefined;

    constructor(options: ProjectProvidersOptions) {
        this.#options = options;
        this.choices = options.choices;
    }

    /** One fixed provider and no settings file (tests). */
    static of(provider: Provider): ProjectProviders {
        const providers = new ProjectProviders({
            choices: [{ id: provider.id, label: provider.label }],
            fallback: provider.id,
            create: () => provider,
        });
        providers.get(provider.id);
        return providers;
    }

    async load(): Promise<void> {
        if (!this.#options.settingsPath) return;
        const raw = await readFile(this.#options.settingsPath, 'utf8').catch(() => undefined);
        const parsed = raw === undefined ? undefined : SettingsFile.safeParse(JSON.parse(raw));
        if (parsed?.success) this.#chosen = parsed.data.provider;
    }

    get defaultId(): string {
        const chosen = this.#chosen;
        return chosen && this.choices.some(choice => choice.id === chosen)
            ? chosen
            : this.#options.fallback;
    }

    default(): Provider {
        return this.get(this.defaultId);
    }

    /** Can pins of this provider be served (a choice, or one already running)? */
    has(id: string): boolean {
        return this.#providers.has(id) || this.choices.some(choice => choice.id === id);
    }

    get(id: string): Provider {
        let provider = this.#providers.get(id);
        if (!provider) {
            provider = this.#options.create(id);
            this.#providers.set(id, provider);
            // Pins record the provider's own id; let them find it under that too.
            if (provider.id !== id) this.#providers.set(provider.id, provider);
            void provider.start();
        }
        return provider;
    }

    async setDefault(id: string): Promise<void> {
        if (!this.choices.some(choice => choice.id === id)) {
            throw new Error(`Unknown provider "${id}"`);
        }
        if (id === this.defaultId) return;
        this.#chosen = id;
        await this.#save();
        for (const listener of this.#listeners) listener();
    }

    onDefaultChange(listener: () => void): () => void {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }

    async dispose(): Promise<void> {
        await Promise.all([...new Set(this.#providers.values())].map(p => p.dispose()));
        this.#providers.clear();
    }

    async #save(): Promise<void> {
        const path = this.#options.settingsPath;
        if (!path) return;
        await mkdir(dirname(path), { recursive: true });
        const temp = `${path}.tmp`;
        await writeFile(
            temp,
            `${JSON.stringify({ version: 1, provider: this.#chosen }, null, 2)}\n`,
        );
        await rename(temp, path);
    }
}
