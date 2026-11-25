import { randomUUID } from 'node:crypto';
import { access, realpath } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { ModelInfo, Options, Query, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type {
    CreatedThread,
    CreateThreadInput,
    ImageAttachment,
    Provider,
    ProviderInfo,
    ProviderMessage,
    ProviderModel,
    ProviderModels,
    ProviderProject,
    ProviderThreadSummary,
    SendMessageInput,
    ThreadSink,
} from '@tencildev/protocol';
import { InputQueue } from './input-queue.ts';
import { type AgentSdk, loadAgentSdk } from './load-sdk.ts';
import { messagesFromTranscript, type RunStatus, TurnTracker } from './transcript.ts';

/** The permission modes that work without anyone at a terminal to answer prompts. */
export type PermissionMode = 'default' | 'acceptEdits' | 'auto' | 'bypassPermissions';

export interface ClaudeCodeProviderOptions {
    /** Directory the dev site lives in; Claude Code runs in its repository root. */
    projectRoot: string;
    /** Where the Agent SDK is installed when Tencil has no copy of its own. */
    installDir: string;
    /** Defaults to Claude Code's own default model. */
    model?: string;
    /** Defaults to `bypassPermissions`: nobody is at a terminal to approve tools. */
    permissionMode?: PermissionMode;
    /** Close an idle session's Claude Code process after this long. Defaults to 10 minutes. */
    idleCloseMs?: number;
    /** Replaces the Agent SDK (tests). */
    sdk?: AgentSdk;
    log?: (message: string) => void;
}

interface Run {
    query: Query;
    input: InputQueue<SDKUserMessage>;
    idleTimer?: ReturnType<typeof setTimeout>;
    interrupted?: boolean;
}

interface Session {
    id: string;
    tracker: TurnTracker;
    /** The conversation so far: the transcript from disk plus live updates. */
    messages: Map<string, ProviderMessage>;
    sink?: ThreadSink;
    run?: Run;
    /** Loaded the transcript from disk once. */
    hydrated?: Promise<void>;
    /** Claude Code has no such session (deleted, or never saved). */
    missing?: boolean;
    /** The model Tencil last asked this session to run on. */
    model?: string;
}

/** Claude Code's model list barely changes; asking costs a process start when no session runs. */
const MODELS_TTL_MS = 30 * 60_000;
/** The row Claude Code offers for "whatever the default is". */
const DEFAULT_ROW = 'default';

const DEFAULT_IDLE_CLOSE_MS = 10 * 60_000;

/**
 * Runs Claude Code through the Agent SDK. Unlike T3 Code there is no server
 * holding the conversation: the daemon hosts one Claude Code process per
 * active session and Claude Code stores the transcripts, so threads are
 * Claude Code sessions (`claude --resume <id>` opens one in a terminal).
 */
export class ClaudeCodeProvider implements Provider {
    readonly id = 'claude-code';
    readonly label = 'Claude Code';

    readonly #options: ClaudeCodeProviderOptions;
    #info: ProviderInfo = { id: 'claude-code', label: 'Claude Code', state: 'connecting' };
    #infoListeners = new Set<(info: ProviderInfo) => void>();
    #sdk: Promise<AgentSdk> | undefined;
    #workspace: Promise<string> | undefined;
    readonly #sessions = new Map<string, Session>();
    #models: { list: Promise<ModelInfo[]>; at: number } | undefined;
    #disposed = false;

    constructor(options: ClaudeCodeProviderOptions) {
        this.#options = options;
    }

    async start(): Promise<void> {
        try {
            await this.#load();
            const workspace = await this.#workspaceRoot();
            this.#setInfo({ state: 'ready', target: basename(workspace) });
            this.#log(`Claude Code ready in ${workspace}`);
        } catch (error) {
            this.#sdk = undefined;
            this.#setInfo({ state: 'unavailable', detail: errorMessage(error) });
        }
    }

    info(): ProviderInfo {
        return this.#info;
    }

    onInfoChange(listener: (info: ProviderInfo) => void): () => void {
        this.#infoListeners.add(listener);
        return () => this.#infoListeners.delete(listener);
    }

    async listThreads(): Promise<{ project: ProviderProject; threads: ProviderThreadSummary[] }> {
        const [sdk, workspace] = await Promise.all([this.#load(), this.#workspaceRoot()]);
        const sessions = await sdk.listSessions({ dir: workspace, includeWorktrees: false });
        const threads = sessions
            .sort((a, b) => b.lastModified - a.lastModified)
            .map(
                (session): ProviderThreadSummary => ({
                    id: session.sessionId,
                    title: session.customTitle ?? session.summary,
                    status: this.#status(session.sessionId).status,
                    updatedAt: new Date(session.lastModified).toISOString(),
                    ...(session.gitBranch ? { branch: session.gitBranch } : {}),
                    agent: 'claudeAgent',
                }),
            );
        return { project: { name: basename(workspace) }, threads };
    }

    async listModels(): Promise<ProviderModels> {
        const [rows, configured] = await Promise.all([this.#modelRows(), this.#configuredModel()]);
        // The default row is Claude Code's own default, which a configured model overrides.
        const fallback = configured ?? rows.find(row => row.value === DEFAULT_ROW)?.resolvedModel;
        const models = rows.filter(row => row.value !== DEFAULT_ROW).map(toModel);
        const current = fallback ? matchModel(rows, fallback) : undefined;
        if (fallback && !current)
            models.unshift(toModel({ value: fallback, displayName: fallback }));
        const defaultModel = current ?? fallback;
        return { models, ...(defaultModel ? { defaultModel } : {}) };
    }

    async threadModels(providerThreadId: string): Promise<ProviderModels> {
        const session = this.#session(providerThreadId);
        const [rows, ran] = await Promise.all([this.#modelRows(), this.#lastModel(session)]);
        const models = rows.filter(row => row.value !== DEFAULT_ROW).map(toModel);
        // What Tencil asked for, else what wrote the last reply, else what it would start on.
        const known = session.model ?? ran;
        const current = known ? matchModel(rows, known) : (await this.listModels()).defaultModel;
        if (known && !current) models.unshift(toModel({ value: known, displayName: known }));
        const defaultModel = current ?? known;
        return { models, ...(defaultModel ? { defaultModel } : {}) };
    }

    threadUrl(): string | undefined {
        return undefined;
    }

    async createThread(input: CreateThreadInput): Promise<CreatedThread> {
        const session = this.#session(randomUUID());
        // Nothing on disk yet; the live run is the whole conversation.
        session.hydrated = Promise.resolve();
        session.model = input.model ?? this.#options.model;
        await this.#startRun(session, { sessionId: session.id, title: input.title });
        this.#send(session, input.text, input.attachments);
        return { providerThreadId: session.id };
    }

    async sendMessage(input: SendMessageInput): Promise<void> {
        const session = this.#session(input.providerThreadId);
        const switching = input.model !== undefined && input.model !== session.model;
        if (input.model) session.model = input.model;
        if (!session.run) {
            // A resumed session starts on the model it's given, not the one it ran on.
            await this.#startRun(session, { resume: session.id });
        } else if (switching) {
            await session.run.query.setModel(input.model);
            this.#log(`Session ${session.id} → ${input.model}`);
        }
        this.#send(session, input.text, input.attachments);
    }

    async interrupt(providerThreadId: string): Promise<void> {
        const run = this.#sessions.get(providerThreadId)?.run;
        if (!run) return;
        run.interrupted = true;
        await run.query.interrupt();
    }

    watch(providerThreadId: string, sink: ThreadSink): () => void {
        const session = this.#session(providerThreadId);
        session.sink = sink;
        void this.#hydrate(session).then(
            gone => {
                if (session.sink !== sink) return;
                if (gone) return sink.gone();
                const messages = [...session.messages.values()].sort((a, b) =>
                    a.createdAt.localeCompare(b.createdAt),
                );
                for (const message of messages) sink.message(message);
                const status = this.#status(session.id);
                sink.status(status.status, status.detail);
            },
            (error: unknown) =>
                this.#log(`Couldn't load session ${providerThreadId}: ${errorMessage(error)}`),
        );
        return () => {
            if (session.sink === sink) session.sink = undefined;
        };
    }

    async dispose(): Promise<void> {
        this.#disposed = true;
        for (const session of this.#sessions.values()) this.#close(session);
        this.#sessions.clear();
    }

    /* --------------------------------- sessions -------------------------------- */

    /** Sessions without a running process are idle (or ended in an error). */
    #status(id: string): RunStatus {
        const session = this.#sessions.get(id);
        if (!session) return { status: 'idle' };
        const status = session.tracker.status();
        return session.run || status.status === 'error' ? status : { status: 'idle' };
    }

    #session(id: string): Session {
        let session = this.#sessions.get(id);
        if (!session) {
            session = { id, tracker: new TurnTracker(), messages: new Map() };
            this.#sessions.set(id, session);
        }
        return session;
    }

    #emit(session: Session, message: ProviderMessage): void {
        session.messages.set(message.id, message);
        session.sink?.message(message);
    }

    /** Load the transcript Claude Code saved, once. Resolves true when the session doesn't exist. */
    async #hydrate(session: Session): Promise<boolean> {
        if (!session.hydrated) {
            session.hydrated = (async () => {
                const [sdk, workspace] = await Promise.all([this.#load(), this.#workspaceRoot()]);
                const entries = await sdk.getSessionMessages(session.id, { dir: workspace });
                for (const message of messagesFromTranscript(entries)) {
                    // Live updates are newer than the file.
                    if (!session.messages.has(message.id))
                        session.messages.set(message.id, message);
                }
                if (entries.length === 0 && !session.run) {
                    session.missing = !(await sdk.getSessionInfo(session.id, { dir: workspace }));
                }
            })();
            // Try again on the next watch rather than remember a failed load.
            session.hydrated.catch(() => {
                session.hydrated = undefined;
            });
        }
        await session.hydrated;
        return session.missing === true && !session.run;
    }

    async #startRun(
        session: Session,
        start: Pick<Options, 'sessionId' | 'resume' | 'title'>,
    ): Promise<void> {
        if (this.#disposed) throw new Error('Tencil is shutting down');
        const [sdk, workspace] = await Promise.all([this.#load(), this.#workspaceRoot()]);
        // Another message started it while the SDK loaded.
        if (session.run) return;
        const permissionMode = this.#options.permissionMode ?? 'bypassPermissions';
        const input = new InputQueue<SDKUserMessage>();
        const query = sdk.query({
            prompt: input,
            options: {
                ...start,
                cwd: workspace,
                systemPrompt: { type: 'preset', preset: 'claude_code' },
                includePartialMessages: true,
                permissionMode,
                allowDangerouslySkipPermissions: permissionMode === 'bypassPermissions',
                // Nobody can answer a prompt yet; denied tools tell Claude why.
                permissionPrompts: 'none',
                ...((session.model ?? this.#options.model)
                    ? { model: session.model ?? this.#options.model }
                    : {}),
                stderr: data => this.#log(data.trimEnd()),
            },
        });
        const run: Run = { query, input };
        session.run = run;
        session.tracker.setStatus({ status: 'working' });
        void this.#consume(session, run);
    }

    async #consume(session: Session, run: Run): Promise<void> {
        let failure: string | undefined;
        try {
            for await (const message of run.query) {
                const update = session.tracker.apply(message);
                for (const m of update.messages) this.#emit(session, m);
                if (update.unauthorized) {
                    this.#setInfo({ state: 'unauthorized', detail: update.unauthorized });
                }
                if (update.turnEnded && run.interrupted) {
                    run.interrupted = false;
                    session.tracker.setStatus({ status: 'idle' });
                    session.sink?.status('idle');
                } else if (update.status) {
                    session.sink?.status(update.status.status, update.status.detail);
                }
                if (update.turnEnded) this.#scheduleIdleClose(session, run);
            }
        } catch (error) {
            failure = errorMessage(error);
        }
        if (session.run !== run) return;
        session.run = undefined;
        clearTimeout(run.idleTimer);
        run.input.close();
        for (const m of session.tracker.finish()) this.#emit(session, m);
        // The process ended mid-turn: report it rather than leave the pin spinning.
        if (session.tracker.status().status === 'working' || failure) {
            const status: RunStatus = {
                status: 'error',
                detail: failure ?? 'Claude Code stopped before the turn finished',
            };
            session.tracker.setStatus(status);
            session.sink?.status(status.status, status.detail);
        }
    }

    #send(session: Session, text: string, attachments: ImageAttachment[]): void {
        const run = session.run;
        if (!run) throw new Error('Claude Code session is not running');
        clearTimeout(run.idleTimer);
        // Claude Code keeps this id in the transcript, so a replay matches it.
        const uuid = randomUUID();
        this.#emit(session, {
            id: uuid,
            role: 'user',
            text,
            streaming: false,
            createdAt: new Date().toISOString(),
        });
        session.tracker.setStatus({ status: 'working' });
        session.sink?.status('working');
        run.input.push({
            type: 'user',
            message: {
                role: 'user',
                content: [...attachments.map(imageBlock), { type: 'text', text }],
            },
            parent_tool_use_id: null,
            uuid,
            session_id: session.id,
        });
    }

    /** Each run is a Claude Code process; let idle ones go and resume on the next message. */
    #scheduleIdleClose(session: Session, run: Run): void {
        clearTimeout(run.idleTimer);
        if (session.tracker.status().status === 'working') return;
        run.idleTimer = setTimeout(() => {
            if (session.run === run) this.#close(session);
        }, this.#options.idleCloseMs ?? DEFAULT_IDLE_CLOSE_MS);
        run.idleTimer.unref?.();
    }

    #close(session: Session): void {
        const run = session.run;
        if (!run) return;
        session.run = undefined;
        clearTimeout(run.idleTimer);
        run.input.close();
        run.query.close();
    }

    /* ---------------------------------- models --------------------------------- */

    /** Claude Code's own model list: from a running session, else from a process started to ask. */
    #modelRows(): Promise<ModelInfo[]> {
        if (this.#models && Date.now() - this.#models.at < MODELS_TTL_MS) return this.#models.list;
        const running = [...this.#sessions.values()].find(session => session.run)?.run;
        const list = running ? running.query.supportedModels() : this.#askModels();
        const entry = { list, at: Date.now() };
        this.#models = entry;
        // Ask again next time rather than remember a failure.
        list.catch(() => {
            if (this.#models === entry) this.#models = undefined;
        });
        return list;
    }

    /** A Claude Code process that never gets a prompt answers without calling the model. */
    async #askModels(): Promise<ModelInfo[]> {
        const [sdk, workspace] = await Promise.all([this.#load(), this.#workspaceRoot()]);
        const input = new InputQueue<SDKUserMessage>();
        const query = sdk.query({ prompt: input, options: { cwd: workspace } });
        try {
            return await query.supportedModels();
        } finally {
            input.close();
            query.close();
        }
    }

    /**
     * What a session started without a model runs on, in Claude Code's order:
     * `--model`, then `ANTHROPIC_MODEL`, then the `model` of its settings files.
     */
    async #configuredModel(): Promise<string | undefined> {
        if (this.#options.model) return this.#options.model;
        if (process.env.ANTHROPIC_MODEL) return process.env.ANTHROPIC_MODEL;
        try {
            const [sdk, workspace] = await Promise.all([this.#load(), this.#workspaceRoot()]);
            const { effective } = await sdk.resolveSettings({ cwd: workspace });
            const model = effective.env?.ANTHROPIC_MODEL ?? effective.model;
            return typeof model === 'string' && model ? model : undefined;
        } catch (error) {
            // Older Agent SDKs can't tell; the list's own default stands in.
            this.#log(`Couldn't read Claude Code's settings: ${errorMessage(error)}`);
            return undefined;
        }
    }

    /** The model that wrote the session's latest reply, as Claude Code saved it. */
    async #lastModel(session: Session): Promise<string | undefined> {
        const [sdk, workspace] = await Promise.all([this.#load(), this.#workspaceRoot()]);
        const entries = await sdk.getSessionMessages(session.id, { dir: workspace });
        for (const entry of [...entries].reverse()) {
            const model = (entry.message as { model?: unknown } | undefined)?.model;
            if (entry.type === 'assistant' && typeof model === 'string') return model;
        }
        return undefined;
    }

    /* --------------------------------- helpers --------------------------------- */

    #load(): Promise<AgentSdk> {
        if (this.#options.sdk) return Promise.resolve(this.#options.sdk);
        this.#sdk ??= loadAgentSdk({
            installDir: this.#options.installDir,
            onInstall: () => {
                this.#setInfo({ state: 'connecting', detail: 'Installing Claude Code support…' });
                this.#log(`Installing the Claude Agent SDK into ${this.#options.installDir}`);
            },
        });
        return this.#sdk;
    }

    /** The repository root, so Claude Code sees the whole project and its CLAUDE.md. */
    #workspaceRoot(): Promise<string> {
        this.#workspace ??= (async () => {
            const root = await realpath(this.#options.projectRoot).catch(
                () => this.#options.projectRoot,
            );
            return (await repositoryRoot(root)) ?? root;
        })();
        return this.#workspace;
    }

    #setInfo(next: Omit<ProviderInfo, 'id' | 'label'>): void {
        const info: ProviderInfo = { id: this.id, label: this.label, ...next };
        if (
            info.state === this.#info.state &&
            info.detail === this.#info.detail &&
            info.target === this.#info.target
        ) {
            return;
        }
        this.#info = info;
        for (const listener of this.#infoListeners) listener(info);
    }

    #log(message: string): void {
        this.#options.log?.(message);
    }
}

function toModel(row: Pick<ModelInfo, 'value' | 'displayName'>): ProviderModel {
    return { id: row.value, label: row.displayName, group: 'Claude', agent: 'claudeAgent' };
}

/**
 * The row a model id stands for: its own, else the alias that resolves to it
 * (a transcript says `claude-opus-5-5` where the list offers `opus`).
 */
function matchModel(rows: ModelInfo[], id: string): string | undefined {
    const offered = rows.filter(row => row.value !== DEFAULT_ROW);
    // `opus[1m]` is Opus with a bigger context window: the same row.
    const base = id.replace(/\[[^\]]*\]$/, '');
    for (const candidate of new Set([id, base])) {
        const row =
            offered.find(row => row.value === candidate) ??
            offered.find(row => row.resolvedModel === candidate);
        if (row) return row.value;
    }
    return undefined;
}

function imageBlock(attachment: ImageAttachment) {
    const data = attachment.dataUrl.slice(attachment.dataUrl.indexOf(',') + 1);
    return {
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: attachment.mimeType, data },
    };
}

/** The nearest folder at or above `dir` with a `.git` entry, if any. */
async function repositoryRoot(dir: string): Promise<string | undefined> {
    for (let current = dir; ; current = dirname(current)) {
        if (await exists(join(current, '.git'))) return current;
        if (dirname(current) === current) return undefined;
    }
}

const exists = (path: string) =>
    access(path).then(
        () => true,
        () => false,
    );

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
