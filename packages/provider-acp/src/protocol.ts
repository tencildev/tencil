/**
 * The parts of the Agent Client Protocol (ACP, v1) Tencil uses; the full schema
 * is at https://agentclientprotocol.com. Agents add to it often and differ in
 * what they send, so this only names what's read here. Other updates are ignored.
 */

export const PROTOCOL_VERSION = 1;

/** JSON-RPC and ACP error codes Tencil acts on. */
export const ErrorCode = {
    methodNotFound: -32601,
    invalidParams: -32602,
    internal: -32603,
    authRequired: -32000,
    resourceNotFound: -32002,
} as const;

export interface AgentCapabilities {
    loadSession?: boolean;
    promptCapabilities?: { image?: boolean; audio?: boolean; embeddedContext?: boolean };
    sessionCapabilities?: {
        list?: object | null;
        resume?: object | null;
        close?: object | null;
    };
}

export interface AuthMethod {
    id: string;
    name: string;
    description?: string | null;
    type?: string;
}

export interface InitializeResult {
    protocolVersion: number;
    agentCapabilities?: AgentCapabilities;
    authMethods?: AuthMethod[];
    agentInfo?: { name: string; title?: string | null; version: string } | null;
}

export interface SessionInfo {
    sessionId: string;
    cwd: string;
    title?: string | null;
    /** ISO 8601. */
    updatedAt?: string | null;
}

export type StopReason = 'end_turn' | 'max_tokens' | 'max_turn_requests' | 'refusal' | 'cancelled';

export type ContentBlock =
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string; uri?: string | null }
    | { type: string; [key: string]: unknown };

export type ToolKind =
    | 'read'
    | 'edit'
    | 'delete'
    | 'move'
    | 'search'
    | 'execute'
    | 'think'
    | 'fetch'
    | 'switch_mode'
    | 'other';

export type ToolCallStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export type ToolCallContent =
    | { type: 'content'; content: ContentBlock }
    | { type: 'diff'; path: string; oldText?: string | null; newText: string }
    | { type: 'terminal'; terminalId: string };

/** A `tool_call`, or the fields a `tool_call_update` changes. */
export interface ToolCall {
    toolCallId: string;
    title?: string | null;
    kind?: ToolKind | null;
    status?: ToolCallStatus | null;
    content?: ToolCallContent[] | null;
    locations?: Array<{ path: string; line?: number | null }> | null;
}

export interface PlanEntry {
    content: string;
    priority?: string;
    status: 'pending' | 'in_progress' | 'completed';
}

/** Chunks of one message share a `messageId`, when the agent sends one. */
interface ContentChunk {
    content: ContentBlock;
    messageId?: string | null;
}

export interface ConfigSelectOption {
    value: string;
    name: string;
    description?: string | null;
}

export interface ConfigSelectGroup {
    group: string;
    name: string;
    options: ConfigSelectOption[];
}

/**
 * A setting of a session (its model, mode, reasoning effort), which comes with
 * the answers to `session/new`, `session/load` and `session/resume`.
 */
export interface SessionConfigOption {
    id: string;
    name: string;
    description?: string | null;
    /** `model`, `mode`, `thought_level`, …: what it's about, for showing it. */
    category?: string | null;
    type: string;
    currentValue: string | boolean;
    /** A `select`'s values: all flat, or all in groups. */
    options?: Array<ConfigSelectOption | ConfigSelectGroup>;
}

export type SessionUpdate =
    | ({ sessionUpdate: 'user_message_chunk' } & ContentChunk)
    | ({ sessionUpdate: 'agent_message_chunk' } & ContentChunk)
    | ({ sessionUpdate: 'agent_thought_chunk' } & ContentChunk)
    | ({ sessionUpdate: 'tool_call' } & ToolCall)
    | ({ sessionUpdate: 'tool_call_update' } & ToolCall)
    | { sessionUpdate: 'plan'; entries: PlanEntry[] }
    | { sessionUpdate: 'config_option_update'; configOptions: SessionConfigOption[] }
    | { sessionUpdate: string };

export interface PermissionOption {
    optionId: string;
    name: string;
    kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';
}

export interface RequestPermissionParams {
    sessionId: string;
    toolCall: ToolCall;
    options: PermissionOption[];
}
