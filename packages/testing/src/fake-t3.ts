import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { type WebSocket, WebSocketServer } from "ws";

/**
 * A small stand-in for a T3 Code server: the HTTP auth endpoints, the shell
 * snapshot and the Effect RPC WebSocket, for both orchestration protocols.
 * It simulates agent turns (streamed replies, interrupts) so the provider,
 * bridge and overlay can be tested end to end without a real T3 Code.
 */
export interface FakeT3Options {
  protocol?: 1 | 2;
  serverVersion?: string;
  /** Bearer token the server accepts. */
  token?: string;
  projects?: FakeProject[];
  /** Assistant reply for a user message. */
  reply?: (text: string) => string;
  /** Delay between streamed reply chunks. */
  chunkDelayMs?: number;
  /** Accept connections but never answer (a server mid-restart). */
  stall?: boolean;
  port?: number;
}

export interface FakeProject {
  id: string;
  title: string;
  workspaceRoot: string;
  defaultModelSelection?: { instanceId: string; model: string } | null;
  repositoryIdentity?: { owner?: string; name?: string } | null;
  projectIcon?: { kind: "emoji"; emoji: string } | null;
}

export interface FakeMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  streaming: boolean;
  createdAt: string;
  attachments?: unknown[];
}

export interface FakeThread {
  id: string;
  projectId: string;
  title: string;
  branch: string | null;
  updatedAt: string;
  createdAt: string;
  modelSelection: { instanceId: string; model: string };
  messages: FakeMessage[];
  runOrdinal: number;
  activeRunId: string | null;
  sessionStatus: "idle" | "running" | "ready" | "interrupted" | "error";
}

interface RecordedCall {
  tag: string;
  payload: Record<string, unknown>;
}

type Frame =
  | { _tag: "Request"; id: string; tag: string; payload: Record<string, unknown> }
  | { _tag: "Ack" | "Interrupt"; requestId: string }
  | { _tag: "Ping" };

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

export class FakeT3Server {
  readonly environmentId = "env-test";
  readonly calls: RecordedCall[] = [];
  readonly projects: FakeProject[];
  readonly threads = new Map<string, FakeThread>();
  stall: boolean;

  readonly #options: Required<
    Pick<FakeT3Options, "protocol" | "serverVersion" | "token" | "chunkDelayMs">
  > &
    FakeT3Options;
  readonly #http: Server;
  readonly #wss = new WebSocketServer({ noServer: true });
  readonly #pairingCodes = new Set<string>();
  readonly #tickets = new Set<string>();
  readonly #subscribers = new Map<string, Set<(item: unknown) => void>>();
  readonly #sockets = new Set<Socket>();
  readonly #cancelled = new Set<string>();
  #sequence = 0;
  #port = 0;

  private constructor(options: FakeT3Options) {
    this.#options = {
      protocol: 1,
      serverVersion: "0.0.45",
      token: "test-token",
      chunkDelayMs: 5,
      ...options,
    };
    this.stall = options.stall ?? false;
    this.projects = options.projects ?? [];
    this.#http = createServer((request, response) => void this.#route(request, response));
    this.#http.on("connection", (socket) => {
      this.#sockets.add(socket);
      socket.on("close", () => this.#sockets.delete(socket));
    });
    this.#http.on("upgrade", (request, socket, head) => {
      if (this.stall) return;
      const url = new URL(request.url ?? "/", "http://localhost");
      const ticket = url.searchParams.get("wsTicket") ?? "";
      const protocolOk =
        this.#options.protocol === 1 || url.searchParams.get("orchestrationProtocol") === "2";
      if (url.pathname !== "/ws" || !this.#tickets.delete(ticket) || !protocolOk) {
        socket.write(`HTTP/1.1 ${protocolOk ? 401 : 426} Rejected\r\n\r\n`);
        socket.destroy();
        return;
      }
      this.#wss.handleUpgrade(request, socket, head, (ws) => this.#serveSocket(ws));
    });
  }

  static async start(options: FakeT3Options = {}): Promise<FakeT3Server> {
    const server = new FakeT3Server(options);
    await new Promise<void>((resolve) =>
      server.#http.listen(options.port ?? 0, "127.0.0.1", resolve),
    );
    const address = server.#http.address();
    server.#port = typeof address === "object" && address ? address.port : 0;
    return server;
  }

  get url(): string {
    return `http://127.0.0.1:${this.#port}`;
  }

  get token(): string {
    return this.#options.token;
  }

  issuePairingCode(): string {
    const code = randomUUID().slice(0, 12).toUpperCase();
    this.#pairingCodes.add(code);
    return code;
  }

  /** Seed an existing thread, e.g. for listing or continuing it. */
  addThread(input: Partial<FakeThread> & { projectId: string; title: string }): FakeThread {
    const now = new Date().toISOString();
    const thread: FakeThread = {
      id: input.id ?? randomUUID(),
      branch: null,
      createdAt: now,
      updatedAt: now,
      modelSelection: { instanceId: "codex", model: "gpt-test" },
      messages: [],
      runOrdinal: 0,
      activeRunId: null,
      sessionStatus: "idle",
      ...input,
    };
    this.threads.set(thread.id, thread);
    return thread;
  }

  /** Drop every open WebSocket, as a restarting T3 Code would. */
  disconnectAll(): void {
    for (const client of this.#wss.clients) client.terminate();
  }

  callsOf(tag: string): Record<string, unknown>[] {
    return this.calls.filter((call) => call.tag === tag).map((call) => call.payload);
  }

  async close(): Promise<void> {
    this.disconnectAll();
    for (const socket of this.#sockets) socket.destroy();
    await new Promise<void>((resolve) => this.#http.close(() => resolve()));
  }

  /* ---------------------------------- http ---------------------------------- */

  async #route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (this.stall) return;
    const url = new URL(request.url ?? "/", "http://localhost");
    const authorized = request.headers.authorization === `Bearer ${this.#options.token}`;
    const json = (status: number, body: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };

    if (request.method === "GET" && url.pathname === "/.well-known/t3/environment") {
      return json(200, {
        environmentId: this.environmentId,
        serverVersion: this.#options.serverVersion,
        ...(this.#options.protocol === 2 ? { orchestrationProtocolVersion: 2 } : {}),
      });
    }
    if (request.method === "POST" && url.pathname === "/oauth/token") {
      const form = new URLSearchParams(await readBody(request));
      const code = form.get("subject_token") ?? "";
      if (!this.#pairingCodes.delete(code)) return json(401, { error: "invalid_grant" });
      return json(200, {
        access_token: this.#options.token,
        issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
        token_type: "Bearer",
        expires_in: 30 * 24 * 3600,
        scope: form.get("scope") ?? "orchestration:read orchestration:operate",
      });
    }
    if (request.method === "POST" && url.pathname === "/api/auth/websocket-ticket") {
      if (!authorized) return json(401, { error: "unauthorized" });
      const ticket = randomUUID();
      this.#tickets.add(ticket);
      return json(200, { ticket, expiresAt: new Date(Date.now() + 60_000).toISOString() });
    }
    if (request.method === "GET" && url.pathname === "/api/orchestration/shell") {
      if (!authorized) return json(401, { error: "unauthorized" });
      return json(200, {
        snapshotSequence: this.#sequence,
        projects: this.projects,
        threads: [...this.threads.values()].map((thread) => this.#shellThread(thread)),
      });
    }
    if (request.method === "GET" && url.pathname.startsWith("/api/assets/")) {
      response.writeHead(200, { "content-type": "image/png" });
      response.end(PNG_1PX);
      return;
    }
    json(404, { error: "not_found" });
  }

  /* ----------------------------------- rpc ---------------------------------- */

  #serveSocket(ws: WebSocket): void {
    const streams = new Map<string, () => void>();
    const send = (frame: unknown) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame));
    };
    const ok = (id: string, value: unknown) =>
      send({ _tag: "Exit", requestId: id, exit: { _tag: "Success", value } });
    const fail = (id: string, tag: string, message: string) =>
      send({
        _tag: "Exit",
        requestId: id,
        exit: { _tag: "Failure", cause: [{ _tag: "Fail", error: { _tag: tag, message } }] },
      });

    ws.on("message", (data) => {
      const frame = JSON.parse(String(data)) as Frame;
      if (this.stall) return;
      if (frame._tag === "Ping") return send({ _tag: "Pong" });
      if (frame._tag === "Interrupt") {
        streams.get(frame.requestId)?.();
        streams.delete(frame.requestId);
        return;
      }
      if (frame._tag !== "Request") return;
      this.calls.push({ tag: frame.tag, payload: frame.payload });
      try {
        const result = this.#handle(frame.tag, frame.payload, (values) =>
          send({ _tag: "Chunk", requestId: frame.id, values }),
        );
        if (result.kind === "stream") streams.set(frame.id, result.unsubscribe);
        else ok(frame.id, result.value);
      } catch (error) {
        const { tag, message } = error as { tag?: string; message: string };
        if (tag === "Defect") {
          send({
            _tag: "Exit",
            requestId: frame.id,
            exit: { _tag: "Failure", cause: [{ _tag: "Die", defect: message }] },
          });
        } else {
          fail(frame.id, tag ?? "Error", message);
        }
      }
    });
    ws.on("close", () => {
      for (const unsubscribe of streams.values()) unsubscribe();
    });
  }

  #handle(
    tag: string,
    payload: Record<string, unknown>,
    chunk: (values: unknown[]) => void,
  ): { kind: "value"; value: unknown } | { kind: "stream"; unsubscribe: () => void } {
    const value = (v: unknown) => ({ kind: "value" as const, value: v });
    const v2 = this.#options.protocol === 2;

    switch (tag) {
      case "server.getConfig":
        return value({
          providers: [
            {
              instanceId: "codex",
              driver: "codex",
              enabled: true,
              installed: true,
              status: "ready",
              models: [{ slug: "gpt-test", isDefault: true }],
            },
          ],
        });
      case "assets.createUrl":
        return value({ relativeUrl: "/api/assets/icon.png", expiresAt: Date.now() + 60_000 });
      case "orchestration.subscribeThread":
        return this.#subscribe(String(payload.threadId), chunk);
      case "assets.persistChatAttachments": {
        if (!v2) break;
        const attachments = (payload.attachments as UploadAttachment[]).map(verifyUpload);
        return value({ attachments: attachments.map((a) => ({ ...a, id: randomUUID() })) });
      }
      case "projects.mutate":
        if (!v2) break;
        this.#createProject(payload);
        return value({});
      case "orchestration.launchThread": {
        if (!v2) break;
        const threadId = String(payload.threadId ?? randomUUID());
        const message = payload.initialMessage as { text: string; attachments: unknown[] };
        this.#createThread(threadId, payload);
        this.#startTurn(threadId, message.text, message.attachments);
        return value({ threadId, resumed: false, projection: {} });
      }
      case "orchestration.dispatchCommand":
        return value(this.#dispatch(payload));
    }
    throw Object.assign(new Error(`Unknown request tag: ${tag}`), { tag: "Defect" });
  }

  #dispatch(command: Record<string, unknown>): { sequence: number } {
    const v2 = this.#options.protocol === 2;
    switch (command.type) {
      case "project.create":
        this.#createProject(command);
        break;
      case "thread.turn.start": {
        if (v2) throw new Error("thread.turn.start is a V1 command");
        const threadId = String(command.threadId);
        const bootstrap = command.bootstrap as
          | { createThread?: Record<string, unknown> }
          | undefined;
        if (bootstrap?.createThread) this.#createThread(threadId, bootstrap.createThread);
        const message = command.message as { text: string; attachments: UploadAttachment[] };
        const attachments = message.attachments.map(verifyUpload);
        this.#startTurn(threadId, message.text, attachments);
        break;
      }
      case "message.dispatch":
        this.#startTurn(String(command.threadId), String(command.text), []);
        break;
      case "thread.turn.interrupt":
      case "run.interrupt":
        this.#interrupt(String(command.threadId));
        break;
      default:
        throw Object.assign(new Error(`Unsupported command ${String(command.type)}`), {
          tag: "OrchestrationDispatchCommandError",
        });
    }
    return { sequence: ++this.#sequence };
  }

  /* --------------------------------- domain --------------------------------- */

  #createProject(input: Record<string, unknown>): void {
    this.projects.push({
      id: String(input.projectId),
      title: String(input.title),
      workspaceRoot: String(input.workspaceRoot),
      defaultModelSelection: null,
    });
  }

  #createThread(threadId: string, input: Record<string, unknown>): void {
    if (this.threads.has(threadId)) return;
    if (!this.projects.some((project) => project.id === input.projectId)) {
      throw Object.assign(new Error("Project not found"), { tag: "ProjectNotFound" });
    }
    this.addThread({
      id: threadId,
      projectId: String(input.projectId),
      title: String(input.title),
      modelSelection: input.modelSelection as FakeThread["modelSelection"],
    });
  }

  #startTurn(threadId: string, text: string, attachments: unknown[]): void {
    const thread = this.threads.get(threadId);
    if (!thread) throw Object.assign(new Error("Thread not found"), { tag: "ThreadNotFound" });
    const now = new Date().toISOString();
    const user: FakeMessage = {
      id: randomUUID(),
      role: "user",
      text,
      streaming: false,
      createdAt: now,
      attachments,
    };
    thread.messages.push(user);
    thread.runOrdinal += 1;
    const runId = `run-${thread.runOrdinal}`;
    thread.activeRunId = runId;
    thread.sessionStatus = "running";
    thread.updatedAt = now;
    this.#cancelled.delete(runId);

    this.#emitMessage(thread, user);
    this.#emitRun(thread, runId, "running");

    const reply = (this.#options.reply ?? ((t: string) => `Done: ${t.split("\n")[0]}`))(text);
    const words = reply.split(/(?<=\s)/);
    const assistant: FakeMessage = {
      id: randomUUID(),
      role: "assistant",
      text: "",
      streaming: true,
      createdAt: new Date().toISOString(),
    };
    thread.messages.push(assistant);
    let index = 0;
    const step = () => {
      if (this.#cancelled.has(runId)) return;
      if (index < words.length) {
        const delta = words[index++]!;
        assistant.text += delta;
        this.#emitAssistant(thread, assistant, delta);
        setTimeout(step, this.#options.chunkDelayMs);
        return;
      }
      assistant.streaming = false;
      this.#emitAssistant(thread, assistant, "");
      thread.activeRunId = null;
      thread.sessionStatus = "ready";
      this.#emitRun(thread, runId, "completed");
    };
    setTimeout(step, this.#options.chunkDelayMs);
  }

  #interrupt(threadId: string): void {
    const thread = this.threads.get(threadId);
    if (!thread?.activeRunId) return;
    const runId = thread.activeRunId;
    this.#cancelled.add(runId);
    thread.activeRunId = null;
    thread.sessionStatus = "interrupted";
    this.#emitRun(thread, runId, "interrupted");
  }

  /* --------------------------------- streams -------------------------------- */

  #subscribe(
    threadId: string,
    chunk: (values: unknown[]) => void,
  ): { kind: "stream"; unsubscribe: () => void } {
    const thread = this.threads.get(threadId);
    if (!thread) throw Object.assign(new Error("Thread not found"), { tag: "ThreadNotFound" });
    chunk([this.#snapshot(thread), { kind: "synchronized" }]);
    const listener = (item: unknown) => chunk([item]);
    let set = this.#subscribers.get(threadId);
    if (!set) {
      set = new Set();
      this.#subscribers.set(threadId, set);
    }
    set.add(listener);
    return { kind: "stream", unsubscribe: () => set.delete(listener) };
  }

  #snapshot(thread: FakeThread): unknown {
    const messages = thread.messages.map((m) => ({ ...m }));
    if (this.#options.protocol === 2) {
      const runs = Array.from({ length: thread.runOrdinal }, (_, i) => ({
        id: `run-${i + 1}`,
        ordinal: i + 1,
        status:
          `run-${i + 1}` === thread.activeRunId
            ? "running"
            : thread.sessionStatus === "interrupted" && i + 1 === thread.runOrdinal
              ? "interrupted"
              : "completed",
      }));
      return {
        kind: "snapshot",
        snapshotSequence: this.#sequence,
        projection: { runs, messages, turnItems: [] },
      };
    }
    return {
      kind: "snapshot",
      snapshot: {
        snapshotSequence: this.#sequence,
        thread: {
          ...this.#shellThread(thread),
          messages,
          session: {
            status: thread.sessionStatus,
            activeTurnId: thread.activeRunId,
            lastError: null,
          },
          latestTurn: null,
        },
      },
    };
  }

  #emit(threadId: string, type: string, payload: unknown): void {
    const sequence = ++this.#sequence;
    const item =
      this.#options.protocol === 2
        ? { kind: "event", sequence, event: { type, payload } }
        : { kind: "event", event: { sequence, type, payload } };
    for (const listener of this.#subscribers.get(threadId) ?? []) listener(item);
  }

  #emitMessage(thread: FakeThread, message: FakeMessage): void {
    if (this.#options.protocol === 2) {
      this.#emit(thread.id, "message.updated", { ...message, threadId: thread.id });
    } else {
      this.#emit(thread.id, "thread.message-sent", {
        threadId: thread.id,
        messageId: message.id,
        role: message.role,
        text: message.text,
        streaming: message.streaming,
        createdAt: message.createdAt,
        updatedAt: message.createdAt,
        turnId: thread.activeRunId,
      });
    }
  }

  /** V1 streams deltas; V2 streams the cumulative text as a turn item. */
  #emitAssistant(thread: FakeThread, message: FakeMessage, delta: string): void {
    if (this.#options.protocol === 2) {
      this.#emit(thread.id, "turn-item.updated", {
        type: "assistant_message",
        messageId: message.id,
        text: message.text,
        streaming: message.streaming,
        createdAt: message.createdAt,
      });
      return;
    }
    this.#emit(thread.id, "thread.message-sent", {
      threadId: thread.id,
      messageId: message.id,
      role: "assistant",
      text: message.streaming ? delta : message.text,
      streaming: message.streaming,
      createdAt: message.createdAt,
      updatedAt: new Date().toISOString(),
      turnId: thread.activeRunId,
    });
  }

  #emitRun(thread: FakeThread, runId: string, status: string): void {
    if (this.#options.protocol === 2) {
      const type = status === "running" ? "run.created" : "run.updated";
      this.#emit(thread.id, type, {
        id: runId,
        ordinal: Number(runId.split("-")[1]),
        status,
      });
      return;
    }
    if (status === "running") this.#emit(thread.id, "thread.turn-start-requested", {});
    this.#emit(thread.id, "thread.session-set", {
      threadId: thread.id,
      session: {
        status:
          status === "running" ? "running" : status === "interrupted" ? "interrupted" : "ready",
        activeTurnId: status === "running" ? runId : null,
        lastError: null,
      },
    });
  }

  #shellThread(thread: FakeThread): Record<string, unknown> {
    return {
      id: thread.id,
      projectId: thread.projectId,
      title: thread.title,
      branch: thread.branch,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      archivedAt: null,
      modelSelection: thread.modelSelection,
      session: { status: thread.sessionStatus, activeTurnId: thread.activeRunId },
      latestTurn: null,
      hasPendingApprovals: false,
      hasPendingUserInput: false,
    };
  }
}

interface UploadAttachment {
  type: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl: string;
}

/** T3 Code rejects uploads whose declared size doesn't match the payload. */
function verifyUpload(attachment: UploadAttachment): Omit<UploadAttachment, "dataUrl"> {
  const decoded = Buffer.from(attachment.dataUrl.split(",", 2)[1] ?? "", "base64").byteLength;
  if (decoded !== attachment.sizeBytes) {
    throw Object.assign(new Error(`sizeBytes ${attachment.sizeBytes} != ${decoded}`), {
      tag: "AttachmentSizeMismatch",
    });
  }
  const { dataUrl: _, ...rest } = attachment;
  return rest;
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}
