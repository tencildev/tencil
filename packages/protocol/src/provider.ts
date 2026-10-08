import type { ImageAttachment } from "./context.ts";
import type { ProviderInfo } from "./messages.ts";
import type {
  MessageRole,
  ProviderProject,
  ProviderThreadSummary,
  ThreadStatus,
} from "./thread.ts";

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
  /** Deep link into the provider UI for a thread, when it has one. */
  threadUrl(providerThreadId: string): string | undefined;
  createThread(input: CreateThreadInput): Promise<CreatedThread>;
  sendMessage(input: SendMessageInput): Promise<void>;
  interrupt(providerThreadId: string): Promise<void>;

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
}

export interface CreatedThread {
  providerThreadId: string;
  url?: string;
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
  status(status: Exclude<ThreadStatus, "starting">, detail?: string): void;
  /** Provider no longer has this thread (deleted/archived on its side). */
  gone(): void;
}
