/**
 * The parts of `codex app-server`'s JSON-RPC protocol Tencil uses;
 * `codex app-server generate-ts` prints all of it. Codex still marks it
 * experimental and adds to it often, so this only names what's read here.
 * Other notifications and item types are ignored.
 */

export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';
export type ApprovalPolicy = 'untrusted' | 'on-request' | 'never';
export type ApprovalsReviewer = 'user' | 'auto_review';

/** What Codex may do by itself, and who decides when it asks for more. */
export interface CodexPermissions {
    sandbox: SandboxMode;
    approvalPolicy: ApprovalPolicy;
    approvalsReviewer?: ApprovalsReviewer;
}

export interface CodexThread {
    id: string;
    name?: string | null;
    preview?: string | null;
    cwd: string;
    /** Unix seconds. */
    updatedAt: number;
    gitInfo?: { branch?: string | null } | null;
}

export interface TurnError {
    message: string;
    /** `'unauthorized'`, or an object such as `{ httpConnectionFailed: { httpStatusCode: 401 } }`. */
    codexErrorInfo?: unknown;
}

export interface CodexTurn {
    id: string;
    status: 'inProgress' | 'completed' | 'interrupted' | 'failed';
    error?: TurnError | null;
    /** Unix seconds. */
    startedAt?: number | null;
    /** Only when read back with its items. */
    items?: ThreadItem[];
}

export type CommandAction =
    | { type: 'read'; command: string; name: string; path?: string | null }
    | { type: 'listFiles'; command: string; path?: string | null }
    | { type: 'search'; command: string; query?: string | null; path?: string | null }
    | { type: 'unknown'; command: string };

/** `failed` and `declined` end a tool call without it having done its work. */
type ItemStatus = 'inProgress' | 'completed' | 'failed' | 'declined';

export type ThreadItem =
    | {
          type: 'userMessage';
          id: string;
          clientId?: string | null;
          content: Array<{ type: string; text?: string }>;
      }
    | { type: 'agentMessage'; id: string; text: string }
    | { type: 'reasoning'; id: string; summary?: string[] }
    | {
          type: 'commandExecution';
          id: string;
          command: string;
          status: ItemStatus;
          commandActions?: CommandAction[];
      }
    | {
          type: 'fileChange';
          id: string;
          status: ItemStatus;
          changes?: Array<{ path: string; kind: { type: 'add' | 'delete' | 'update' } }>;
      }
    | {
          type: 'mcpToolCall';
          id: string;
          server: string;
          tool: string;
          status: ItemStatus;
          error?: { message: string } | null;
      }
    | { type: 'dynamicToolCall'; id: string; tool: string; status: ItemStatus }
    | {
          type: 'collabAgentToolCall';
          id: string;
          tool: string;
          status: ItemStatus;
          prompt?: string | null;
      }
    | { type: 'webSearch'; id: string; query?: string | null }
    | { type: 'imageView'; id: string; path: string }
    | { type: 'imageGeneration'; id: string; status?: string }
    | { type: 'contextCompaction'; id: string };

export interface ThreadItemEntry {
    item: ThreadItem;
    startedAtMs?: number | null;
}

export interface CodexModel {
    model: string;
    displayName: string;
    hidden?: boolean;
    isDefault?: boolean;
}

export interface Page<T> {
    data: T[];
    nextCursor?: string | null;
}

export interface AccountRead {
    account: { type: string } | null;
    requiresOpenaiAuth: boolean;
}
