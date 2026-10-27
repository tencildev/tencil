import { z } from 'zod';
import { Anchor, ElementContext } from './context.ts';

/**
 * Provider-agnostic run state.
 * - `draft`: a comment queued in a batch, not sent to the agent yet
 * - `starting`: thread is being created on the provider
 * - `working`: the agent is producing a turn
 * - `waiting`: the agent needs approval/input inside the provider UI
 * - `idle`: last turn finished, ready for a follow-up
 * - `error`: last turn or the thread itself failed
 */
export const ThreadStatus = z.enum(['draft', 'starting', 'working', 'waiting', 'idle', 'error']);
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
 * Where a Tencil Cloud run's change is once the agent is done: Tencil Cloud
 * commits and pushes it, the host redeploys the preview. The local daemon
 * never sets it; there the dev server reloads.
 * - `queued`: waiting for earlier runs on the same branch
 * - `pushed`: committed and pushed (to the branch's pull request, or a new one)
 * - `deploying` / `live` / `deploy-failed`: the preview of that commit
 * - `no-changes`: the agent changed nothing, so nothing was pushed
 * - `failed`: couldn't commit or push (e.g. a conflict); see `detail`
 */
export const DeliveryStatus = z.enum([
    'queued',
    'pushed',
    'deploying',
    'live',
    'deploy-failed',
    'no-changes',
    'failed',
]);
export type DeliveryStatus = z.infer<typeof DeliveryStatus>;

export const Delivery = z.object({
    status: DeliveryStatus,
    detail: z.string().optional(),
    /** Runs ahead of this one on the branch, while queued. */
    queuePosition: z.number().int().nonnegative().optional(),
    commit: z.object({ sha: z.string(), url: z.string() }).optional(),
    /** `opened`: Tencil Cloud opened it for this run (the branch had none). */
    pullRequest: z
        .object({ number: z.number().int(), url: z.string(), opened: z.boolean().default(false) })
        .optional(),
    /** The redeployed preview, once live. */
    previewUrl: z.string().optional(),
    /** Deploy logs, when the deploy failed. */
    logsUrl: z.string().optional(),
});
export type Delivery = z.infer<typeof Delivery>;

export const StepStatus = z.enum(['running', 'done', 'failed', 'skipped']);
export type StepStatus = z.infer<typeof StepStatus>;

/**
 * One thing a provider did during the current turn, for the overlay to show
 * under "Working…": Tencil Cloud starting a sandbox, cloning, installing, then
 * the agent's tool calls (nested under the agent step through `parentId`).
 */
export const ThreadStep = z.object({
    id: z.string(),
    label: z.string(),
    status: StepStatus,
    /** A second line: the command, a file, why it failed. */
    detail: z.string().optional(),
    parentId: z.string().optional(),
    startedAt: z.string(),
    endedAt: z.string().optional(),
});
export type ThreadStep = z.infer<typeof ThreadStep>;

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
        /** Started for these pins: archived once they're all resolved (`Provider.archive`). */
        archivable: z.boolean().optional(),
    }),
    /** Tencil Cloud only: the run's commit, pull request and preview. */
    delivery: Delivery.optional(),
    /** What the provider did during the latest turn, when it reports steps. */
    steps: z.array(ThreadStep).optional(),
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

/** A model a provider can start threads on, e.g. T3 Code's Claude Opus. */
export const ProviderModel = z.object({
    /** Opaque to the overlay; the provider parses it back. */
    id: z.string(),
    label: z.string(),
    /** The agent it belongs to, e.g. "Claude" or "Codex". */
    group: z.string(),
    /** Agent kind for its icon (`codex`, `claudeAgent`). */
    agent: z.string().optional(),
});
export type ProviderModel = z.infer<typeof ProviderModel>;

/** How the provider presents the project the threads belong to. */
export const ProviderProject = z.object({
    name: z.string(),
    /** Absolute URL of the project's favicon, if it has one. */
    iconUrl: z.string().optional(),
    emoji: z.string().optional(),
});
export type ProviderProject = z.infer<typeof ProviderProject>;
