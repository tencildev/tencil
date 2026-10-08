import { z } from 'zod';
import { Anchor, ElementContext } from './context.ts';

/**
 * Provider-agnostic run state.
 * - `starting`: thread is being created on the provider
 * - `working`: the agent is producing a turn
 * - `waiting`: the agent needs approval/input inside the provider UI
 * - `idle`: last turn finished, ready for a follow-up
 * - `error`: last turn or the thread itself failed
 */
export const ThreadStatus = z.enum(['starting', 'working', 'waiting', 'idle', 'error']);
export type ThreadStatus = z.infer<typeof ThreadStatus>;

export const MessageRole = z.enum(['user', 'assistant', 'system']);
export type MessageRole = z.infer<typeof MessageRole>;

export const ThreadMessage = z.object({
    id: z.string(),
    role: MessageRole,
    /** Cumulative text; replaces the previous value on every update. */
    text: z.string(),
    streaming: z.boolean().default(false),
    createdAt: z.string(),
});
export type ThreadMessage = z.infer<typeof ThreadMessage>;

/**
 * A conversation Tencil tracks, backed by one provider thread. Owned and
 * persisted by the bridge. Pinned threads sit on an element of a page;
 * threads opened from the provider's list have no anchor and live in the dock.
 * Several pins may continue the same provider thread.
 */
export const Thread = z.object({
    id: z.string(),
    title: z.string(),
    pageUrl: z.string().optional(),
    anchor: Anchor.optional(),
    context: ElementContext.optional(),
    status: ThreadStatus,
    statusDetail: z.string().optional(),
    resolved: z.boolean().default(false),
    messages: z.array(ThreadMessage),
    provider: z.object({
        id: z.string(),
        threadId: z.string().optional(),
        /** Deep link into the provider UI, when it has one. */
        url: z.string().optional(),
    }),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type Thread = z.infer<typeof Thread>;

/** A thread as listed by the provider (e.g. every T3 Code thread in the project). */
export const ProviderThreadSummary = z.object({
    id: z.string(),
    title: z.string(),
    status: z.enum(['working', 'waiting', 'idle', 'error']),
    updatedAt: z.string(),
    url: z.string().optional(),
    branch: z.string().optional(),
    pullRequest: z.object({ number: z.number(), url: z.string() }).optional(),
    /** Work still running after the turn settled (subagents, watch loops). */
    background: z.enum(['working', 'monitoring']).optional(),
    /** Agent driver, e.g. `codex` or `claudeAgent`, for the provider icon. */
    agent: z.string().optional(),
});
export type ProviderThreadSummary = z.infer<typeof ProviderThreadSummary>;

/** How the provider presents the project the threads belong to. */
export const ProviderProject = z.object({
    name: z.string(),
    /** Absolute URL of the project's favicon, if it has one. */
    iconUrl: z.string().optional(),
    emoji: z.string().optional(),
});
export type ProviderProject = z.infer<typeof ProviderProject>;
