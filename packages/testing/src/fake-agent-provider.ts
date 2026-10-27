import type {
    CreateThreadInput,
    Provider,
    ProviderInfo,
    ProviderModels,
    ProviderProject,
    ProviderThreadSummary,
    SendMessageInput,
    ThreadSink,
} from '@tencildev/protocol';

export interface FakeAgentProviderOptions {
    id?: string;
    label?: string;
    /** The project `listThreads` reports; named after the label by default. */
    project?: ProviderProject;
    /** Threads `listThreads` reports for the project. */
    threads?: ProviderThreadSummary[];
    /** Deep links into the provider; none by default. */
    threadUrl?: (providerThreadId: string) => string | undefined;
    /** Mark every thread it starts `archivable`, as a provider that starts one per pin. */
    archivable?: boolean;
}

/**
 * A `Provider` (the agent behind pins) that answers instantly and records
 * every call. Push updates into a watched thread through `sinks`.
 */
export class FakeAgentProvider implements Provider {
    readonly id: string;
    readonly label: string;
    started = 0;
    /** Every `createThread` input, in order. */
    readonly created: CreateThreadInput[] = [];
    /** Every `sendMessage` input, in order. */
    readonly sent: SendMessageInput[] = [];
    readonly interrupted: string[] = [];
    readonly archived: string[] = [];
    readonly reopened: string[] = [];
    /** The sink of each watched provider thread. */
    readonly sinks = new Map<string, ThreadSink>();
    watchCount = 0;
    /** Make `createThread` throw, as if the agent were offline. */
    failCreate = false;
    readonly #options: FakeAgentProviderOptions;

    constructor(options: FakeAgentProviderOptions = {}) {
        this.#options = options;
        this.id = options.id ?? 'fake';
        this.label = options.label ?? 'Fake';
    }

    async start(): Promise<void> {
        this.started++;
    }

    info(): ProviderInfo {
        return { id: this.id, label: this.label, state: 'ready' };
    }

    onInfoChange(): () => void {
        return () => {};
    }

    async listThreads(): Promise<{
        project: ProviderProject;
        threads: ProviderThreadSummary[];
    }> {
        return {
            project: this.#options.project ?? { name: this.label },
            threads: this.#options.threads ?? [],
        };
    }

    async listModels(): Promise<ProviderModels> {
        return {
            models: [{ id: `${this.id}/fast`, label: 'Fast', group: this.label }],
            defaultModel: `${this.id}/fast`,
        };
    }

    threadUrl(providerThreadId: string): string | undefined {
        return this.#options.threadUrl?.(providerThreadId);
    }

    /** New provider threads are numbered per provider: `fake-1`, `fake-2`, … */
    async createThread(input: CreateThreadInput) {
        if (this.failCreate) throw new Error('Agent offline');
        this.created.push(input);
        return {
            providerThreadId: `${this.id}-${this.created.length}`,
            archivable: this.#options.archivable,
        };
    }

    async sendMessage(input: SendMessageInput): Promise<void> {
        this.sent.push(input);
    }

    async interrupt(providerThreadId: string): Promise<void> {
        this.interrupted.push(providerThreadId);
    }

    async archive(providerThreadId: string): Promise<void> {
        this.archived.push(providerThreadId);
    }

    async reopen(providerThreadId: string): Promise<void> {
        this.reopened.push(providerThreadId);
    }

    watch(providerThreadId: string, sink: ThreadSink): () => void {
        this.watchCount++;
        this.sinks.set(providerThreadId, sink);
        return () => this.sinks.delete(providerThreadId);
    }

    async dispose(): Promise<void> {}
}
