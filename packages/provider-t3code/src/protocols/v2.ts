import { randomUUID } from "node:crypto";
import type { ImageAttachment, ProviderMessage } from "@fixhere/protocol";
import {
  decodedSize,
  type ProtocolAdapter,
  type ThreadTracker,
  type TrackerUpdate,
} from "./adapter.ts";
import type { RpcSocket } from "./rpc.ts";

/**
 * Orchestration V2 (builds advertising `orchestrationProtocolVersion: 2`).
 * Threads launch atomically via `orchestration.launchThread`; images are
 * persisted first and referenced by id.
 */
export const v2: ProtocolAdapter = {
  version: 2,

  async createProject(socket, input) {
    await socket.request("projects.mutate", {
      type: "project.create",
      commandId: randomUUID(),
      projectId: input.projectId,
      title: input.title,
      workspaceRoot: input.workspaceRoot,
    });
  },

  async startThread(socket, input) {
    const messageId = randomUUID();
    const attachments = await persist(socket, input.threadId, messageId, input.attachments);
    await socket.request("orchestration.launchThread", {
      commandId: randomUUID(),
      creationSource: "web",
      threadId: input.threadId,
      projectId: input.projectId,
      title: input.title,
      generateTitle: true,
      modelSelection: input.modelSelection,
      runtimeMode: input.runtimeMode,
      interactionMode: input.interactionMode,
      // Work in the checkout the dev server is serving, so edits hot-reload.
      workspaceStrategy: { type: "root" },
      initialMessage: { messageId, text: input.text, attachments },
    });
  },

  async sendMessage(socket, input) {
    const messageId = randomUUID();
    const attachments = await persist(socket, input.threadId, messageId, input.attachments);
    await socket.request("orchestration.dispatchCommand", {
      type: "message.dispatch",
      createdBy: "user",
      creationSource: "web",
      commandId: randomUUID(),
      threadId: input.threadId,
      messageId,
      text: input.text,
      attachments,
      dispatchMode: { type: input.busy ? "queue_after_active" : "start_immediately" },
    });
  },

  async interrupt(socket, threadId, runId) {
    await socket.request("orchestration.dispatchCommand", {
      type: "run.interrupt",
      commandId: randomUUID(),
      threadId,
      runId,
      reason: "Stopped from Fixhere",
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
  const result = await socket.request<{ attachments: unknown[] }>("assets.persistChatAttachments", {
    threadId,
    messageId,
    attachments: attachments.map((attachment) => ({
      type: "image",
      name: attachment.name,
      mimeType: attachment.mimeType,
      sizeBytes: decodedSize(attachment.dataUrl),
      dataUrl: attachment.dataUrl,
    })),
  });
  return result.attachments;
}

/* --------------------------------- tracker --------------------------------- */

interface WireRun {
  id: string;
  ordinal: number;
  status: string;
}

interface WireMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  streaming: boolean;
  createdAt: string;
}

interface WireTurnItem {
  type: string;
  messageId?: string;
  text?: string;
  streaming?: boolean;
  createdAt?: string;
}

type WireItem =
  | { kind: "synchronized" }
  | {
      kind: "snapshot";
      projection: { runs?: WireRun[]; messages?: WireMessage[]; turnItems?: WireTurnItem[] };
    }
  | { kind: "event"; sequence: number; event: { type: string; payload: unknown } }
  | { kind: "unknown-event" };

const ACTIVE_RUN_STATUSES = new Set(["preparing", "starting", "running", "waiting"]);

export class V2ThreadTracker implements ThreadTracker {
  #runs = new Map<string, WireRun>();
  #messages = new Map<string, ProviderMessage>();
  #lastStatusKey = "";

  apply(raw: unknown): TrackerUpdate {
    const item = raw as WireItem;
    const changed: ProviderMessage[] = [];
    let gone = false;

    if (item.kind === "snapshot") {
      for (const run of item.projection.runs ?? []) this.#runs.set(run.id, run);
      for (const message of item.projection.messages ?? []) this.#upsertMessage(message, changed);
      for (const turnItem of item.projection.turnItems ?? [])
        this.#upsertTurnItem(turnItem, changed);
    } else if (item.kind === "event") {
      const { type, payload } = item.event;
      if (type === "run.created" || type === "run.updated") {
        const run = payload as WireRun;
        this.#runs.set(run.id, run);
      } else if (type === "message.updated") {
        this.#upsertMessage(payload as WireMessage, changed);
      } else if (type === "turn-item.updated") {
        this.#upsertTurnItem(payload as WireTurnItem, changed);
      } else if (type === "thread.deleted") {
        gone = true;
      }
    }

    const update: TrackerUpdate = { messages: changed };
    if (gone) update.gone = true;
    const status = this.status();
    const statusKey = `${status.status}:${status.detail ?? ""}`;
    if (statusKey !== this.#lastStatusKey) {
      this.#lastStatusKey = statusKey;
      update.status = status;
    }
    return update;
  }

  status(): ReturnType<ThreadTracker["status"]> {
    const latest = this.#latestRun();
    if (!latest) return { status: "idle" };
    switch (latest.status) {
      case "preparing":
      case "queued":
      case "starting":
      case "running":
        return { status: "working" };
      case "waiting":
        return { status: "waiting", detail: "Waiting for approval in T3 Code" };
      case "failed":
        return { status: "error", detail: "Run failed" };
      case "interrupted":
      case "cancelled":
        return { status: "idle", detail: "Stopped" };
      default:
        return { status: "idle" };
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

  #latestRun(): WireRun | undefined {
    let latest: WireRun | undefined;
    for (const run of this.#runs.values()) {
      if (!latest || run.ordinal > latest.ordinal) latest = run;
    }
    return latest;
  }

  #upsertMessage(message: WireMessage, changed: ProviderMessage[]): void {
    if (message.role === "system") return;
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
    if (item.type !== "assistant_message" || !item.messageId) return;
    const existing = this.#messages.get(item.messageId);
    this.#set(
      {
        id: item.messageId,
        role: "assistant",
        text: item.text ?? "",
        streaming: item.streaming ?? false,
        createdAt: existing?.createdAt ?? item.createdAt ?? new Date().toISOString(),
      },
      changed,
    );
  }

  #set(next: ProviderMessage, changed: ProviderMessage[]): void {
    const previous = this.#messages.get(next.id);
    if (previous && previous.text === next.text && previous.streaming === next.streaming) return;
    this.#messages.set(next.id, next);
    const index = changed.findIndex((message) => message.id === next.id);
    if (index === -1) changed.push(next);
    else changed[index] = next;
  }
}
