import type { ImageAttachment } from './context.ts';
import type { ProviderInfo } from './messages.ts';
import type {
    Delivery,
    MessageRole,
    ProviderModel,
    ProviderProject,
    ProviderThreadSummary,
    ThreadStatus,
    ThreadStep,
} from './thread.ts';

/**
 * A provider is the agent backend a pin is delegated to (T3 Code, Claude Code,
 * …). The bridge owns pins and talks to exactly one provider per process; the
 * provider owns the conversation.
 *
 * Providers only ever see plain text + images: the bridge renders element
 * context into the prompt so every provider gets identical input.
 */
export interface Provider {
    readonly id: string;
    readonly label: string;

    /** Connect/authenticate. Must not throw; report problems through `info()`. */
    start(): Promise<void>;
    info(): ProviderInfo;
    onInfoChange(listener: (info: ProviderInfo) => void): () => void;

    /** Authorize against the provider (e.g. pair with T3 Code). Optional. */
    pair?(): Promise<void>;
    /** Threads that already exist for this project, newest first. */
    listThreads(): Promise<{ project: ProviderProject; threads: ProviderThreadSummary[] }>;
    /** Models new threads can run on, and the one they use by default. Optional. */
    listModels?(): Promise<ProviderModels>;
    /** Deep link into the provider UI for a thread, when it has one. */
    threadUrl(providerThreadId: string): string | undefined;
    createThread(input: CreateThreadInput): Promise<CreatedThread>;
    sendMessage(input: SendMessageInput): Promise<void>;
    interrupt(providerThreadId: string): Promise<void>;
    /** Archive a thread `createThread` marked `archivable`, once its pins are resolved. Optional. */
    archive?(providerThreadId: string): Promise<void>;
    /** Bring an archived thread back, for a pin reopened or replied to. */
    reopen?(providerThreadId: string): Promise<void>;

    /**
     * Stream updates for a thread. Called right after `createThread` and again
     * for every persisted thread when the bridge restarts. The provider should
     * replay current state first, then live updates.
     */
    watch(providerThreadId: string, sink: ThreadSink): () => void;

    dispose(): Promise<void>;
}

export interface CreateThreadInput {
    title: string;
    text: string;
    attachments: ImageAttachment[];
    /** A `ProviderModel.id` the user picked; the provider's default when absent or unknown. */
    model?: string;
}

export interface ProviderModels {
    models: ProviderModel[];
    /** `ProviderModel.id` new threads use when none is picked. */
    defaultModel?: string;
}

export interface CreatedThread {
    providerThreadId: string;
    url?: string;
    /** The provider started this thread for the pin alone, so resolving the pin may archive it. */
    archivable?: boolean;
}

export interface SendMessageInput {
    providerThreadId: string;
    text: string;
    attachments: ImageAttachment[];
}

export interface ProviderMessage {
    id: string;
    role: MessageRole;
    text: string;
    streaming: boolean;
    createdAt: string;
}

export interface ThreadSink {
    /** Upsert by `id`; `text` is cumulative. */
    message(message: ProviderMessage): void;
    status(status: Exclude<ThreadStatus, 'starting' | 'draft'>, detail?: string): void;
    /** Provider no longer has this thread (deleted/archived on its side). */
    gone(): void;
    /** Tencil Cloud: where the run's commit is (pushed, deploying, live, …). */
    delivery?(delivery: Delivery): void;
    /** A step of the current turn (sandbox, clone, a tool call…); upsert by `id`. */
    step?(step: ThreadStep): void;
}
