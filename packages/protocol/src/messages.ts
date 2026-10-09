import { z } from 'zod';
import { Anchor, ElementContext, ImageAttachment } from './context.ts';
import type { ProviderProject, ProviderThreadSummary, Thread } from './thread.ts';

export const PROTOCOL_VERSION = 1;

/* ----------------------------- overlay → bridge ----------------------------- */

export const ClientMessage = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('hello'),
        protocol: z.literal(PROTOCOL_VERSION),
        pageUrl: z.string(),
    }),
    z.object({
        type: z.literal('thread.create'),
        /** Client-generated id so the overlay can render the pin optimistically. */
        id: z.string().min(1).max(64),
        pageUrl: z.string(),
        prompt: z.string().min(1),
        anchor: Anchor,
        context: ElementContext,
        attachments: z.array(ImageAttachment).max(4).default([]),
        /** Continue this existing provider thread instead of starting a new one. */
        providerThreadId: z.string().optional(),
    }),
    /** Track an existing provider thread without pinning it to an element. */
    z.object({
        type: z.literal('thread.open'),
        id: z.string().min(1).max(64),
        providerThreadId: z.string(),
        title: z.string().optional(),
    }),
    z.object({ type: z.literal('provider.threads') }),
    /** Attach this page to a project folder (answer to `project.unknown`, or a switch). */
    z.object({ type: z.literal('project.select'), root: z.string().min(1) }),
    /** Ask the provider to authorize (e.g. pair with a local T3 Code). */
    z.object({ type: z.literal('provider.pair') }),
    z.object({
        type: z.literal('thread.reply'),
        threadId: z.string(),
        text: z.string().min(1),
        attachments: z.array(ImageAttachment).max(4).default([]),
    }),
    z.object({ type: z.literal('thread.interrupt'), threadId: z.string() }),
    z.object({ type: z.literal('thread.resolve'), threadId: z.string(), resolved: z.boolean() }),
    z.object({ type: z.literal('thread.delete'), threadId: z.string() }),
    /** Re-anchor a pin that was dragged somewhere else. */
    z.object({ type: z.literal('thread.move'), threadId: z.string(), anchor: Anchor }),
    /** Change the project's settings, e.g. the provider new pins go to. */
    z.object({ type: z.literal('settings.update'), provider: z.string().min(1) }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;
export type ClientMessageInput = z.input<typeof ClientMessage>;

/* ----------------------------- bridge → overlay ----------------------------- */

export const ProviderInfo = z.object({
    id: z.string(),
    label: z.string(),
    state: z.enum(['connecting', 'ready', 'unauthorized', 'unavailable']),
    detail: z.string().optional(),
    /** Human label for where threads go, e.g. the T3 Code project name. */
    target: z.string().optional(),
    /** The overlay can fix `unauthorized` itself by sending `provider.pair`. */
    canPair: z.boolean().optional(),
});
export type ProviderInfo = z.infer<typeof ProviderInfo>;

/** A provider the project can send pins to. */
export const ProviderOption = z.object({ id: z.string(), label: z.string() });
export type ProviderOption = z.infer<typeof ProviderOption>;

/** Per-project settings, as the overlay shows them. */
export const ProjectSettings = z.object({
    /** Provider new pins go to; existing pins keep their own. */
    provider: z.string(),
    providers: z.array(ProviderOption),
});
export type ProjectSettings = z.infer<typeof ProjectSettings>;

export type ServerMessage =
    | {
          type: 'ready';
          protocol: typeof PROTOCOL_VERSION;
          version: string;
          project: { name: string; root: string };
          /** The provider new pins go to. */
          provider: ProviderInfo;
          settings: ProjectSettings;
          threads: Thread[];
      }
    | { type: 'provider.status'; provider: ProviderInfo }
    | { type: 'settings'; settings: ProjectSettings }
    /** The daemon couldn't tell which project this page belongs to; the overlay asks. */
    | {
          type: 'project.unknown';
          pageUrl: string;
          choices: Array<{ root: string; title: string }>;
          /** What to do when there are no choices. */
          emptyHint?: string;
      }
    | { type: 'thread.upsert'; thread: Thread }
    | { type: 'thread.removed'; threadId: string }
    | { type: 'provider.threads'; project: ProviderProject; threads: ProviderThreadSummary[] }
    | { type: 'error'; message: string; threadId?: string };
