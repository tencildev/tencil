import { z } from 'zod';
import { Anchor, ElementContext, ImageAttachment } from './context.ts';
import type { ProviderModel, ProviderProject, ProviderThreadSummary, Thread } from './thread.ts';

export const PROTOCOL_VERSION = 1;

/**
 * The code a page was built from, set by Tencil Cloud builds (`TENCIL_CLOUD`).
 * Local pages have none: the daemon finds their project from the dev server.
 */
export const BuildInfo = z.object({
    /** Project key from the Tencil Cloud dashboard. */
    projectKey: z.string().min(1).max(64),
    /** `owner/name` on GitHub. */
    repo: z.string().min(3).max(200),
    branch: z.string().min(1).max(255),
    sha: z.string().min(7).max(64),
});
export type BuildInfo = z.infer<typeof BuildInfo>;

/** How the overlay signs in to Tencil Cloud: OAuth 2.1 authorization code with PKCE. */
export interface CloudSignIn {
    authorizeUrl: string;
    tokenUrl: string;
    clientId: string;
    /** A Tencil Cloud page that posts the code back to the overlay (`tencil:oauth`). */
    redirectUri: string;
    scope?: string;
}

/** Who is signed in to Tencil Cloud, and what they may do on this project. */
export interface Viewer {
    name: string;
    /** GitHub login. */
    login?: string;
    avatarUrl?: string;
    /** `read`: can see pins, not make or answer them (no write access to the repository). */
    access: 'write' | 'read';
}

/**
 * The daemon's own updates (local only; Tencil Cloud leaves it out). `latest`
 * is set when a newer Tencil is published. `state` walks through an update
 * started from the overlay: installing it, waiting for running threads,
 * restarting on it, or failed (the old version keeps running).
 */
export interface UpdateStatus {
    latest?: string;
    state: 'idle' | 'installing' | 'waiting' | 'restarting' | 'failed';
    /** `waiting`: how many threads are still running. */
    running?: number;
    /** `failed`: what went wrong. */
    error?: string;
}

/* ------------------------------- preferences ------------------------------- */

/** A key combination, matched by key position (`code`) so it works on any layout. */
export const Shortcut = z.object({
    code: z.string().min(1).max(32),
    /** What the layout prints for it, for labels. */
    key: z.string().min(1).max(32),
    alt: z.boolean(),
    ctrl: z.boolean(),
    meta: z.boolean(),
    shift: z.boolean(),
});
export type Shortcut = z.infer<typeof Shortcut>;

export const Shortcuts = z.object({
    comment: Shortcut.nullable(),
    ruler: Shortcut.nullable(),
    hidePins: Shortcut.nullable(),
    /** Never cleared: it's the only way back to a hidden dock. */
    hideDock: Shortcut,
    /** Held, not pressed. */
    measure: z.enum(['Alt', 'Control', 'Meta', 'Shift']).nullable(),
});
export type Shortcuts = z.infer<typeof Shortcuts>;

/**
 * The person's own overlay settings, the same in every project on the machine.
 * Saved by the local daemon; unset ones fall back to the overlay's defaults.
 */
export const Preferences = z.object({
    theme: z.enum(['dark', 'light', 'system']).optional(),
    shortcuts: Shortcuts.optional(),
});
export type Preferences = z.infer<typeof Preferences>;

/* ----------------------------- overlay → bridge ----------------------------- */

export const ClientMessage = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('hello'),
        protocol: z.literal(PROTOCOL_VERSION),
        pageUrl: z.string(),
        /** Repository root the page's dev server runs in (Vite and Next integrations). */
        root: z.string().max(4096).optional(),
        build: BuildInfo.optional(),
        /** Tencil Cloud access token; the local daemon has no sign-in. */
        token: z.string().min(1).max(4096).optional(),
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
        /** Queue it for a batch (`drafts.send`) instead of sending it now. */
        draft: z.boolean().optional(),
    }),
    /** Rewrite a queued comment. */
    z.object({
        type: z.literal('thread.edit'),
        threadId: z.string(),
        prompt: z.string().min(1),
    }),
    /** Send queued comments to the agent together, as one new thread. */
    z.object({
        type: z.literal('drafts.send'),
        /** In pin order; `number` is the pin's number, which the agent refers to. */
        drafts: z
            .array(z.object({ threadId: z.string(), number: z.number().int().positive() }))
            .min(1),
    }),
    /** Track an existing provider thread without pinning it to an element. */
    z.object({
        type: z.literal('thread.open'),
        id: z.string().min(1).max(64),
        providerThreadId: z.string(),
        title: z.string().optional(),
    }),
    z.object({ type: z.literal('provider.threads') }),
    /** The models new threads of the default provider can run on. */
    z.object({ type: z.literal('provider.models') }),
    /** List the projects this page could belong to, to switch (local daemon only). */
    z.object({ type: z.literal('project.choices') }),
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
    /** Git actions: commit the files the pin's agent changed, and nothing else. */
    z.object({ type: z.literal('thread.commit'), threadId: z.string() }),
    /** Git actions: undo the pin's change in the work tree, keeping other edits. */
    z.object({ type: z.literal('thread.revert'), threadId: z.string() }),
    /** Re-anchor a pin that was dragged somewhere else. */
    z.object({ type: z.literal('thread.move'), threadId: z.string(), anchor: Anchor }),
    /** Change the project's settings, e.g. the provider new pins go to. */
    z.object({
        type: z.literal('settings.update'),
        provider: z.string().min(1).optional(),
        batch: z.boolean().optional(),
        ruler: z.boolean().optional(),
        git: z.boolean().optional(),
    }),
    /** Run new threads of the default provider on this model; null goes back to its default. */
    z.object({ type: z.literal('model.select'), model: z.string().min(1).nullable() }),
    /** Install the latest Tencil and restart the daemon on it (local daemon only). */
    z.object({ type: z.literal('update.start') }),
    /** Save some preferences on this machine (local daemon only); unnamed ones stay. */
    z.object({ type: z.literal('preferences.update'), preferences: Preferences }),
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
    /** Model picked for the provider's new threads; unset means the provider's default. */
    model: z.string().optional(),
    /** New comments are queued and sent together. */
    batch: z.boolean(),
    /** The toolbar offers the ruler: spacing while picking, distances with Alt. */
    ruler: z.boolean(),
    /**
     * Git actions: pins whose agent changed files offer Commit and Revert. Off
     * by default; left out where the host can't run Git (Tencil Cloud).
     */
    git: z.boolean().optional(),
});
export type ProjectSettings = z.infer<typeof ProjectSettings>;

/**
 * How the daemon matched the page to its project: an Ensemble thread's dev
 * server, the git root the Vite or Next plugin passed, the dev server listening
 * on the page's port, the Docker container publishing it, or a pick in the overlay.
 */
const DetectedVia = z.enum(['ensemble', 'plugin', 'port', 'docker']);

export const ProjectSource = z.object({
    via: z.enum([...DetectedVia.options, 'picked']),
    port: z.number().int().optional(),
    /** Picked over a project Tencil did detect: that one, to go back to. */
    detected: z
        .object({ root: z.string(), via: DetectedVia, port: z.number().int().optional() })
        .optional(),
});
export type ProjectSource = z.infer<typeof ProjectSource>;

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
          /** Tencil Cloud only: who is signed in. */
          viewer?: Viewer;
          /** Local daemon only: the latest version and any update in progress. */
          update?: UpdateStatus;
      }
    /** The update status changed: a check found a newer version, or an update moved on. */
    | { type: 'update'; update: UpdateStatus }
    /** Local daemon only: the answer to `project.choices`. */
    | { type: 'project.choices'; choices: Array<{ root: string; title: string }> }
    /** Local daemon only: how this page's project was found, after it attaches. */
    | { type: 'project.source'; source: ProjectSource }
    /** Local daemon only: the saved preferences, on connect and whenever they change. */
    | { type: 'preferences'; preferences: Preferences }
    /** Tencil Cloud: sign in first (no token, or one it no longer accepts). */
    | { type: 'auth.required'; signIn: CloudSignIn; reason?: string }
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
    | {
          type: 'provider.models';
          provider: string;
          models: ProviderModel[];
          /** What new threads run on when no model is picked. */
          defaultModel?: string;
      }
    | { type: 'error'; message: string; threadId?: string };
