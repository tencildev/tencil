import type { Provider, ProviderOption } from '@tencildev/protocol';

/** What a project picked in the overlay's settings. */
export interface SavedProjectSettings {
    /** The provider new pins go to; unset means the host's fallback. */
    provider?: string;
    /** Model picked per provider for new threads; unset means the provider's default. */
    models?: Record<string, string>;
    /** Queue new comments and send them together; on when unset. */
    batch?: boolean;
}

/**
 * Where a project's settings live: a file next to its pins for the daemon,
 * a database row for a hosted runner.
 */
export interface ProjectSettingsStore {
    /** The saved settings, or undefined when the project has none yet. */
    load(): Promise<SavedProjectSettings | undefined>;
    save(settings: SavedProjectSettings): Promise<void>;
}

export interface ProjectProvidersOptions {
    /** Providers the project can pick from. */
    choices: ProviderOption[];
    /** Used until the project picks one, e.g. the daemon's `--provider`. */
    fallback: string;
    /** Builds a choice's provider; called once per id, on first use. */
    create: (id: string) => Provider;
    /** Where the project's choices are saved; in memory only when absent. */
    settings?: ProjectSettingsStore;
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
    readonly #settingsListeners = new Set<() => void>();
    #chosen: string | undefined;
    #models: Record<string, string> = {};
    /** On unless the project turns it off. */
    #batch = true;

    constructor(options: ProjectProvidersOptions) {
        this.#options = options;
        this.choices = options.choices;
    }

    /**
     * Ready-made providers, the first being the default. Each is started
     * here; `settings` keeps the project's picks (in memory when absent).
     */
    static of(providers: Provider | Provider[], settings?: ProjectSettingsStore): ProjectProviders {
        const list = Array.isArray(providers) ? providers : [providers];
        const [first] = list;
        if (!first) throw new Error('ProjectProviders.of needs at least one provider');
        const result = new ProjectProviders({
            choices: list.map(provider => ({ id: provider.id, label: provider.label })),
            fallback: first.id,
            create: id => list.find(provider => provider.id === id) ?? first,
            settings,
        });
        for (const provider of list) result.get(provider.id);
        return result;
    }

    async load(): Promise<void> {
        const saved = await this.#options.settings?.load();
        if (saved) {
            this.#chosen = saved.provider;
            this.#models = saved.models ?? {};
            this.#batch = saved.batch ?? true;
        }
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

    /** The model picked for a provider's new threads, if any. */
    modelFor(id: string): string | undefined {
        return this.#models[id];
    }

    async setModel(id: string, model: string | null): Promise<void> {
        if ((this.#models[id] ?? null) === model) return;
        const { [id]: _previous, ...rest } = this.#models;
        this.#models = model ? { ...rest, [id]: model } : rest;
        await this.#save();
        for (const listener of this.#settingsListeners) listener();
    }

    get batch(): boolean {
        return this.#batch;
    }

    async setBatch(on: boolean): Promise<void> {
        if (on === this.#batch) return;
        this.#batch = on;
        await this.#save();
        for (const listener of this.#settingsListeners) listener();
    }

    /** Fires when a picked model or batching changes. */
    onSettingsChange(listener: () => void): () => void {
        this.#settingsListeners.add(listener);
        return () => this.#settingsListeners.delete(listener);
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
        await this.#options.settings?.save({
            provider: this.#chosen,
            models: this.#models,
            batch: this.#batch,
        });
    }
}
