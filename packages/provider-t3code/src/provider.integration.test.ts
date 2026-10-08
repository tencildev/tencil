import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderMessage, ThreadSink, ThreadStatus } from "@fixhere/protocol";
import { FakeT3Server, waitFor } from "@fixhere/testing";
import { afterEach, describe, expect, it } from "vitest";
import { CredentialStore } from "./auth.ts";
import { T3CodeProvider, type T3CodeProviderOptions } from "./provider.ts";

const FAST = { httpMs: 300, rpcMs: 1_000, retryMinMs: 20, retryMaxMs: 100 };
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()?.();
});

function projectDir(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), "fixhere-project-")));
}

async function setup(
  protocol: 1 | 2,
  options: Partial<T3CodeProviderOptions> & { seedProject?: boolean; paired?: boolean } = {},
) {
  const root = projectDir();
  const server = await FakeT3Server.start({
    protocol,
    projects:
      options.seedProject === false ? [] : [{ id: "proj-1", title: "acme", workspaceRoot: root }],
  });
  const credentials = new CredentialStore(join(projectDir(), "credentials.json"));
  if (options.paired !== false) {
    await credentials.set(server.url, {
      token: server.token,
      scope: "orchestration:read orchestration:operate",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
  }
  const provider = new T3CodeProvider({
    projectRoot: root,
    baseUrl: server.url,
    credentials,
    createProjectIfMissing: true,
    timeouts: FAST,
    ...options,
  });
  cleanup.push(async () => {
    await provider.dispose();
    await server.close();
  });
  return { root, server, provider, credentials };
}

function recordingSink() {
  const messages = new Map<string, ProviderMessage>();
  const statuses: ThreadStatus[] = [];
  let gone = false;
  const sink: ThreadSink = {
    message: (message) => messages.set(message.id, message),
    status: (status) => statuses.push(status),
    gone: () => {
      gone = true;
    },
  };
  return { sink, messages, statuses, isGone: () => gone };
}

const ready = (provider: T3CodeProvider) =>
  waitFor(() => provider.info().state === "ready", { message: "provider ready" });

describe.each([1, 2] as const)("T3 Code provider, protocol v%i", (protocol) => {
  it("connects and maps the folder to the existing project", async () => {
    const { provider } = await setup(protocol);
    await provider.start();
    await ready(provider);
    expect(provider.info()).toMatchObject({ state: "ready", target: "acme" });
  });

  it("creates the project when the folder isn't one yet", async () => {
    const { provider, server, root } = await setup(protocol, { seedProject: false });
    await provider.start();
    await ready(provider);
    expect(server.projects).toEqual([expect.objectContaining({ workspaceRoot: root })]);
  });

  it("starts a thread and streams the reply back", async () => {
    const { provider } = await setup(protocol);
    await provider.start();
    await ready(provider);

    const created = await provider.createThread({
      title: "Make it blue",
      text: "Make the button blue",
      attachments: [],
    });
    expect(created.url).toContain(created.providerThreadId);

    const { sink, messages, statuses } = recordingSink();
    provider.watch(created.providerThreadId, sink);
    const reply = await waitFor(
      () => [...messages.values()].find((m) => m.role === "assistant" && !m.streaming && m.text),
      { message: "final assistant message" },
    );
    expect(reply.text).toBe("Done: Make the button blue");
    await waitFor(() => statuses.at(-1) === "idle", { message: "idle status" });
    expect([...messages.values()].find((m) => m.role === "user")?.text).toBe(
      "Make the button blue",
    );
  });

  it("sends follow-ups and interrupts a running turn", async () => {
    const { provider, server } = await setup(protocol);
    await provider.start();
    await ready(provider);
    const { providerThreadId } = await provider.createThread({
      title: "t",
      text: "first",
      attachments: [],
    });
    const { sink, statuses } = recordingSink();
    provider.watch(providerThreadId, sink);
    await waitFor(() => statuses.at(-1) === "idle", { message: "first turn done" });

    await provider.sendMessage({ providerThreadId, text: "second", attachments: [] });
    await waitFor(() => statuses.at(-1) === "working", { message: "second turn running" });
    await provider.interrupt(providerThreadId);
    await waitFor(() => statuses.at(-1) === "idle", { message: "interrupted" });
    expect(server.threads.get(providerThreadId)?.sessionStatus).toBe("interrupted");
  });

  it("uploads screenshots with exact byte sizes", async () => {
    const { provider, server } = await setup(protocol);
    await provider.start();
    await ready(provider);
    const { providerThreadId } = await provider.createThread({
      title: "t",
      text: "with screenshot",
      attachments: [{ name: "shot.png", mimeType: "image/png", dataUrl: PNG }],
    });
    const user = server.threads.get(providerThreadId)?.messages.find((m) => m.role === "user");
    expect(user?.attachments).toHaveLength(1);
  });

  it("lists the project's threads with metadata", async () => {
    const { provider, server } = await setup(protocol);
    server.addThread({ projectId: "proj-1", title: "Existing work", branch: "feature/x" });
    server.addThread({ projectId: "other", title: "Other project" });
    await provider.start();
    await ready(provider);
    const { project, threads } = await provider.listThreads();
    expect(project.name).toBe("acme");
    expect(threads).toEqual([
      expect.objectContaining({ title: "Existing work", branch: "feature/x", agent: "codex" }),
    ]);
  });

  it("resubscribes watched threads after T3 Code drops the connection", async () => {
    const { provider, server } = await setup(protocol);
    await provider.start();
    await ready(provider);
    const { providerThreadId } = await provider.createThread({
      title: "t",
      text: "one",
      attachments: [],
    });
    const { sink, messages } = recordingSink();
    provider.watch(providerThreadId, sink);
    await waitFor(() => [...messages.values()].some((m) => m.text === "Done: one"));

    server.disconnectAll();
    await waitFor(() => provider.info().state !== "ready", { message: "noticed disconnect" });
    await ready(provider);
    await provider.sendMessage({ providerThreadId, text: "two", attachments: [] });
    await waitFor(() => [...messages.values()].some((m) => m.text === "Done: two"), {
      message: "reply after reconnect",
    });
  });
});

describe("pairing and recovery", () => {
  it("pairs automatically when no token is stored", async () => {
    let server: FakeT3Server | undefined;
    const {
      provider,
      credentials,
      server: started,
    } = await setup(1, {
      paired: false,
      createPairingCode: async () => server?.issuePairingCode(),
    });
    server = started;
    await provider.start();
    await ready(provider);
    expect((await credentials.get(started.url))?.token).toBe(started.token);
  });

  it("reports unauthorized when pairing isn't possible", async () => {
    const { provider } = await setup(1, {
      paired: false,
      createPairingCode: async () => undefined,
    });
    await provider.start();
    await waitFor(() => provider.info().state === "unauthorized");
    expect(provider.info().detail).toMatch(/fixhere connect/);
  });

  it("recovers once a stalled T3 Code starts answering", async () => {
    const { provider, server } = await setup(1);
    server.stall = true;
    void provider.start();
    await waitFor(() => provider.info().state === "unavailable", { message: "stall detected" });
    expect(provider.info().detail).toMatch(/isn't running/);
    server.stall = false;
    await ready(provider);
  });
});

describe("isInside", () => {
  it("matches the folder itself and nested folders only", async () => {
    const { isInside } = await import("./provider.ts");
    expect(isInside("/a/b", "/a/b")).toBe(true);
    expect(isInside("/a/b/c", "/a/b")).toBe(true);
    expect(isInside("/a/bc", "/a/b")).toBe(false);
    expect(isInside("/a", "/a/b")).toBe(false);
  });
});
