import type { ImageAttachment, ProviderMessage, ThreadStatus } from '@tencil/protocol';
import type { RpcSocket } from '../rpc-socket.ts';

export type RuntimeMode = 'approval-required' | 'auto-accept-edits' | 'auto' | 'full-access';

export interface ModelSelection {
    instanceId: string;
    model: string;
    /** Per-model options such as reasoning effort, passed through as T3 Code stored them. */
    options?: unknown;
}

export interface TrackerUpdate {
    messages: ProviderMessage[];
    status?: { status: Exclude<ThreadStatus, 'starting' | 'draft'>; detail?: string };
    gone?: boolean;
}

/** Folds one protocol's thread stream into Tencil messages + status. */
export interface ThreadTracker {
    apply(item: unknown): TrackerUpdate;
    status(): { status: Exclude<ThreadStatus, 'starting' | 'draft'>; detail?: string };
    /** What an interrupt should target (run id in V2, turn id in V1). */
    activeTurnId(): string | undefined;
}

export interface StartThreadInput {
    threadId: string;
    projectId: string;
    title: string;
    text: string;
    attachments: ImageAttachment[];
    modelSelection: ModelSelection;
    runtimeMode: RuntimeMode;
    interactionMode: 'default' | 'plan';
}

export interface SendInput {
    threadId: string;
    text: string;
    attachments: ImageAttachment[];
    busy: boolean;
    runtimeMode: RuntimeMode;
    interactionMode: 'default' | 'plan';
}

/**
 * T3 Code has two orchestration protocols on the wire:
 * - V1: every released build so far (`thread.turn.start`, `thread.message-sent`)
 * - V2: newer builds advertising `orchestrationProtocolVersion: 2`
 *   (`orchestration.launchThread`, runs, turn items)
 */
export interface ProtocolAdapter {
    readonly version: 1 | 2;
    createProject(
        socket: RpcSocket,
        input: { projectId: string; title: string; workspaceRoot: string },
    ): Promise<void>;
    startThread(socket: RpcSocket, input: StartThreadInput): Promise<void>;
    sendMessage(socket: RpcSocket, input: SendInput): Promise<void>;
    interrupt(socket: RpcSocket, threadId: string, turnId: string): Promise<void>;
    createTracker(): ThreadTracker;
}

export function decodedSize(dataUrl: string): number {
    return Buffer.from(dataUrl.split(',', 2)[1] ?? '', 'base64').byteLength;
}
