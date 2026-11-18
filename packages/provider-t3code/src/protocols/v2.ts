import { randomUUID } from 'node:crypto';
import type { ImageAttachment, ProviderMessage, ThreadStep } from '@tencildev/protocol';
import type { RpcSocket } from '../rpc-socket.ts';
import {
    decodedSize,
    type ProtocolAdapter,
    type ThreadTracker,
    type TrackerUpdate,
} from './adapter.ts';

/**
 * Orchestration V2 (builds advertising `orchestrationProtocolVersion: 2`).
 * Threads launch atomically via `orchestration.launchThread`; images are
 * persisted first and referenced by id.
 */
export const v2: ProtocolAdapter = {
    version: 2,

    async createProject(socket, input) {
        await socket.request('projects.mutate', {
            type: 'project.create',
            commandId: randomUUID(),
            projectId: input.projectId,
            title: input.title,
            workspaceRoot: input.workspaceRoot,
        });
    },

    async startThread(socket, input) {
        const messageId = randomUUID();
        const attachments = await persist(socket, input.threadId, messageId, input.attachments);
        await socket.request('orchestration.launchThread', {
            commandId: randomUUID(),
            creationSource: 'web',
            threadId: input.threadId,
            projectId: input.projectId,
            title: input.title,
            generateTitle: true,
            modelSelection: input.modelSelection,
            runtimeMode: input.runtimeMode,
            interactionMode: input.interactionMode,
            // Work in the checkout the dev server is serving, so edits hot-reload.
            workspaceStrategy: { type: 'root' },
            initialMessage: { messageId, text: input.text, attachments },
        });
    },

    async sendMessage(socket, input) {
        const messageId = randomUUID();
        const attachments = await persist(socket, input.threadId, messageId, input.attachments);
        await socket.request('orchestration.dispatchCommand', {
            type: 'message.dispatch',
            createdBy: 'user',
            creationSource: 'web',
            commandId: randomUUID(),
            threadId: input.threadId,
            messageId,
            text: input.text,
            attachments,
            dispatchMode: { type: input.busy ? 'queue_after_active' : 'start_immediately' },
        });
    },

    async interrupt(socket, threadId, runId) {
        await socket.request('orchestration.dispatchCommand', {
            type: 'run.interrupt',
            commandId: randomUUID(),
            threadId,
            runId,
            reason: 'Stopped from Tencil',
            holdQueue: true,
        });
    },

    createTracker: () => new V2ThreadTracker(),
};

async function persist(
    socket: RpcSocket,
    threadId: string,
    messageId: string,
    attachments: ImageAttachment[],
): Promise<unknown[]> {
    if (attachments.length === 0) return [];
    const result = await socket.request<{ attachments: unknown[] }>(
        'assets.persistChatAttachments',
        {
            threadId,
            messageId,
            attachments: attachments.map(attachment => ({
                type: 'image',
                name: attachment.name,
                mimeType: attachment.mimeType,
                sizeBytes: decodedSize(attachment.dataUrl),
                dataUrl: attachment.dataUrl,
            })),
        },
    );
    return result.attachments;
}

/* --------------------------------- tracker --------------------------------- */

interface WireRun {
    id: string;
    ordinal: number;
    status: string;
    requestedAt?: string;
}

/** An approval, question or sign-in the agent is blocked on. */
interface WireRuntimeRequest {
    id: string;
    kind: string;
    status: string;
    createdAt?: string;
}

interface WireMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    text: string;
    streaming: boolean;
    createdAt: string;
}

interface WireTurnItem {
    type: string;
    id?: string;
    runId?: string | null;
    parentItemId?: string | null;
    status?: string;
    title?: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
    updatedAt?: string;
    messageId?: string;
    text?: string;
    streaming?: boolean;
    createdAt?: string;
    /** `command_execution`: the command. */
    input?: unknown;
    /** `file_change` */
    fileName?: string;
    /** `file_search` */
    pattern?: string;
    /** `web_search` */
    patterns?: string[];
    /** `dynamic_tool` */
    toolName?: string | null;
}

type WireItem =
    | { kind: 'synchronized' }
    | {
          kind: 'snapshot';
          projection: {
              runs?: WireRun[];
              runtimeRequests?: WireRuntimeRequest[];
              messages?: WireMessage[];
              turnItems?: WireTurnItem[];
          };
      }
    | { kind: 'event'; sequence: number; event: { type: string; payload: unknown } }
    | { kind: 'unknown-event' };

/** Requests the user answers; T3 Code resolves `auth_refresh` and `dynamic_tool_call` itself. */
const USER_REQUEST_KINDS = new Set([
    'command',
    'file-read',
    'file-change',
    'mcp-elicitation',
    'permission',
    'user_input',
]);
const ACTIVE_RUN_STATUSES = new Set(['preparing', 'starting', 'running', 'waiting']);

export class V2ThreadTracker implements ThreadTracker {
    #runs = new Map<string, WireRun>();
    #requests = new Map<string, WireRuntimeRequest>();
    #messages = new Map<string, ProviderMessage>();
    #steps = new Map<string, ThreadStep>();
    #lastStatusKey = '';

    apply(raw: unknown): TrackerUpdate {
        const item = raw as WireItem;
        const changed: ProviderMessage[] = [];
        const steps: ThreadStep[] = [];
        let gone = false;

        if (item.kind === 'snapshot') {
            for (const run of item.projection.runs ?? []) this.#runs.set(run.id, run);
            for (const request of item.projection.runtimeRequests ?? [])
                this.#requests.set(request.id, request);
            for (const message of item.projection.messages ?? [])
                this.#upsertMessage(message, changed);
            for (const turnItem of item.projection.turnItems ?? []) {
                this.#upsertTurnItem(turnItem, changed);
                this.#upsertStep(turnItem, steps);
            }
        } else if (item.kind === 'event') {
            const { type, payload } = item.event;
            if (type === 'run.created' || type === 'run.updated') {
                const run = payload as WireRun;
                this.#runs.set(run.id, run);
            } else if (type === 'runtime-request.updated') {
                const request = payload as WireRuntimeRequest;
                this.#requests.set(request.id, request);
            } else if (type === 'message.updated') {
                this.#upsertMessage(payload as WireMessage, changed);
            } else if (type === 'turn-item.updated') {
                this.#upsertTurnItem(payload as WireTurnItem, changed);
                this.#upsertStep(payload as WireTurnItem, steps);
            } else if (type === 'thread.deleted') {
                gone = true;
            }
        }

        const update: TrackerUpdate = { messages: changed };
        if (steps.length > 0) update.steps = steps;
        if (gone) update.gone = true;
        const status = this.status();
        const statusKey = `${status.status}:${status.detail ?? ''}`;
        if (statusKey !== this.#lastStatusKey) {
            this.#lastStatusKey = statusKey;
            update.status = status;
        }
        return update;
    }

    status(): ReturnType<ThreadTracker['status']> {
        const latest = this.#latestRun();
        if (!latest) return { status: 'idle' };
        switch (latest.status) {
            case 'preparing':
            case 'queued':
            case 'starting':
            case 'running':
            // The turn is done and T3 Code is saving its checkpoint.
            case 'waiting':
                return this.#pendingRequest(latest) ?? { status: 'working' };
            case 'failed':
                return { status: 'error', detail: 'Run failed' };
            case 'interrupted':
            case 'cancelled':
                return { status: 'idle', detail: 'Stopped' };
            default:
                return { status: 'idle' };
        }
    }

    activeTurnId(): string | undefined {
        let active: WireRun | undefined;
        for (const run of this.#runs.values()) {
            if (!ACTIVE_RUN_STATUSES.has(run.status)) continue;
            if (!active || run.ordinal > active.ordinal) active = run;
        }
        return active?.id;
    }

    /**
     * Approvals and questions don't change the run's status; they're runtime requests.
     * A stopped run can leave one pending, so only count those made during `run`.
     */
    #pendingRequest(run: WireRun): ReturnType<ThreadTracker['status']> | undefined {
        for (const request of this.#requests.values()) {
            if (request.status !== 'pending' || !USER_REQUEST_KINDS.has(request.kind)) continue;
            if (run.requestedAt && request.createdAt && request.createdAt < run.requestedAt)
                continue;
            return {
                status: 'waiting',
                detail:
                    request.kind === 'user_input'
                        ? 'Waiting for your answer in T3 Code'
                        : 'Waiting for approval in T3 Code',
            };
        }
        return undefined;
    }

    #latestRun(): WireRun | undefined {
        let latest: WireRun | undefined;
        for (const run of this.#runs.values()) {
            if (!latest || run.ordinal > latest.ordinal) latest = run;
        }
        return latest;
    }

    #upsertMessage(message: WireMessage, changed: ProviderMessage[]): void {
        if (message.role === 'system') return;
        this.#set(
            {
                id: message.id,
                role: message.role,
                text: message.text,
                streaming: message.streaming,
                createdAt: message.createdAt,
            },
            changed,
        );
    }

    /** Assistant text streams as turn items before (or instead of) a message update. */
    #upsertTurnItem(item: WireTurnItem, changed: ProviderMessage[]): void {
        if (item.type !== 'assistant_message' || !item.messageId) return;
        const existing = this.#messages.get(item.messageId);
        this.#set(
            {
                id: item.messageId,
                role: 'assistant',
                text: item.text ?? '',
                streaming: item.streaming ?? false,
                createdAt: existing?.createdAt ?? item.createdAt ?? new Date().toISOString(),
            },
            changed,
        );
    }

    /** Tool calls of the latest run; earlier turns' stay in T3 Code. */
    #upsertStep(item: WireTurnItem, steps: ThreadStep[]): void {
        if (!item.id || (item.runId && item.runId !== this.#latestRun()?.id)) return;
        const label = stepLabel(item);
        if (!label) return;
        const status = STEP_STATUS[item.status ?? ''] ?? 'running';
        const startedAt =
            item.startedAt ?? this.#steps.get(item.id)?.startedAt ?? item.updatedAt ?? now();
        const step: ThreadStep = {
            id: item.id,
            label: status === 'running' ? label.running : label.done,
            status,
            kind: label.kind,
            ...(label.detail ? { detail: label.detail } : {}),
            ...(item.parentItemId ? { parentId: item.parentItemId } : {}),
            startedAt,
            ...(status !== 'running'
                ? { endedAt: item.completedAt ?? item.updatedAt ?? now() }
                : {}),
        };
        const previous = this.#steps.get(item.id);
        if (
            previous &&
            previous.status === step.status &&
            previous.label === step.label &&
            previous.endedAt === step.endedAt
        )
            return;
        this.#steps.set(item.id, step);
        const index = steps.findIndex(s => s.id === step.id);
        if (index === -1) steps.push(step);
        else steps[index] = step;
    }

    #set(next: ProviderMessage, changed: ProviderMessage[]): void {
        const previous = this.#messages.get(next.id);
        if (previous && previous.text === next.text && previous.streaming === next.streaming)
            return;
        this.#messages.set(next.id, next);
        const index = changed.findIndex(message => message.id === next.id);
        if (index === -1) changed.push(next);
        else changed[index] = next;
    }
}

const STEP_STATUS: Record<string, ThreadStep['status']> = {
    pending: 'running',
    running: 'running',
    waiting: 'running',
    completed: 'done',
    failed: 'failed',
    cancelled: 'skipped',
    interrupted: 'skipped',
};

/** How a tool turn item reads in the overlay; `undefined` for everything that isn't a tool call. */
function stepLabel(
    item: WireTurnItem,
):
    | { kind: NonNullable<ThreadStep['kind']>; running: string; done: string; detail?: string }
    | undefined {
    switch (item.type) {
        case 'command_execution': {
            const command = clip(
                String(item.input ?? item.title ?? '').split('\n', 1)[0] ?? '',
                48,
            );
            return { kind: 'command', running: `Running ${command}`, done: `Ran ${command}` };
        }
        case 'file_change': {
            const file = basename(item.fileName ?? item.title ?? 'a file');
            return { kind: 'edit', running: `Editing ${file}`, done: `Edited ${file}` };
        }
        case 'file_search': {
            const pattern = clip(item.pattern ?? item.title ?? '', 40);
            return {
                kind: 'search',
                running: `Searching for ${pattern}`,
                done: `Searched for ${pattern}`,
            };
        }
        case 'web_search': {
            const query = clip(item.patterns?.[0] ?? item.title ?? '', 36);
            return {
                kind: 'web',
                running: `Searching the web for ${query}`,
                done: `Searched the web for ${query}`,
            };
        }
        case 'dynamic_tool': {
            const tool = item.toolName ?? item.title ?? 'a tool';
            return { kind: 'tool', running: `Using ${tool}`, done: `Used ${tool}` };
        }
        case 'subagent': {
            const what = item.title ?? 'a subagent';
            return { kind: 'agent', running: `Delegating: ${what}`, done: `Delegated: ${what}` };
        }
        default:
            return undefined;
    }
}

function basename(path: string): string {
    return path.split(/[\\/]/).pop() || path;
}

function clip(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function now(): string {
    return new Date().toISOString();
}
