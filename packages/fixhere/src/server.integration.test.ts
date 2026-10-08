import { mkdtempSync, realpathSync } from "node:fs";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerMessage, Thread } from "@fixhere/protocol";
import { CredentialStore } from "@fixhere/provider-t3code";
import { FakeT3Server, waitFor } from "@fixhere/testing";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { type FixhereInstance, startFixhere } from "./index.ts";

const FAST = { httpMs: 300, rpcMs: 2_000, retryMinMs: 20, retryMaxMs: 100 };
const CONTEXT = {
  tagName: "button",
  selector: "main > button",
  html: '<button class="cta">Buy</button>',
  text: "Buy",
  components: [{ name: "Pricing", source: { file: "src/Pricing.tsx", line: 12 } }],
  rect: { x: 0, y: 0, width: 100, height: 40 },
  viewport: { width: 1280, height: 800, dpr: 2 },
};
const ANCHOR = { selector: "main > button", offsetX: 0.5, offsetY: 0.5 };

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()?.();
});

let nextBase = 47_900 + Math.floor(Math.random() * 500);
/** Each test gets its own port block so parallel files don't collide. */
const basePort = () => {
  nextBase += 25;
  return nextBase;
};

const tmp = (prefix: string) => realpathSync(mkdtempSync(join(tmpdir(), prefix)));

async function setup(
  options: { protocol?: 1 | 2; paired?: boolean; autoPair?: boolean; slow?: boolean } = {},
) {
  const root = tmp("fixhere-project-");
  const t3 = await FakeT3Server.start({
    protocol: options.protocol ?? 1,
    // A long, slow reply leaves a running turn to interrupt.
    ...(options.slow
      ? { chunkDelayMs: 40, reply: () => "Working through this one word at a time. ".repeat(20) }
      : {}),
    projects: [{ id: "proj-1", title: "acme", workspaceRoot: root }],
  });
  const credentials = new CredentialStore(join(tmp("fixhere-creds-"), "credentials.json"));
  if (options.paired !== false) {
    await credentials.set(t3.url, {
      token: t3.token,
      scope: "orchestration:read orchestration:operate",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
  }
  const instance = await startFixhere({
    root,
    basePort: basePort(),
    dataDir: tmp("fixhere-data-"),
    t3: {
      url: t3.url,
      credentials,
      timeouts: FAST,
      autoPair: options.autoPair ?? false,
      createPairingCode: async () => t3.issuePairingCode(),
    },
  });
  cleanup.push(async () => {
    await instance.close();
    await t3.close();
  });
  return { root, t3, instance };
}

/** A stand-in for the overlay: speaks the bridge protocol over WebSocket. */
async function connectClient(instance: FixhereInstance, origin = "http://localhost:3000") {
  const ws = new WebSocket(`${instance.url.replace("http", "ws")}/ws`, { origin });
  const received: ServerMessage[] = [];
  ws.on("message", (data) => received.push(JSON.parse(String(data)) as ServerMessage));
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  cleanup.push(() => ws.close());
  const send = (message: unknown) => ws.send(JSON.stringify(message));
  const latest = (id: string): Thread | undefined =>
    received
      .filter(
        (m): m is Extract<ServerMessage, { type: "thread.upsert" }> => m.type === "thread.upsert",
      )
      .map((m) => m.thread)
      .filter((t) => t.id === id)
      .at(-1);
  send({ type: "hello", protocol: 1, pageUrl: "http://localhost:3000/" });
  await waitFor(() => received.find((m) => m.type === "ready"));
  return { ws, received, send, latest };
}

const providerReady = (received: ServerMessage[]) =>
  waitFor(
    () =>
      received.some((m) => m.type === "provider.status" && m.provider.state === "ready") ||
      received.some((m) => m.type === "ready" && m.provider.state === "ready"),
    { message: "provider ready" },
  );

function httpGet(url: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request(url, { headers }, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe.each([1, 2] as const)("bridge end to end, protocol v%i", (protocol) => {
  it("pins an element, starts a thread and streams the reply into the pin", async () => {
    const { t3, instance } = await setup({ protocol });
    const client = await connectClient(instance);
    await providerReady(client.received);

    client.send({
      type: "thread.create",
      id: "pin-1",
      pageUrl: "http://localhost:3000/pricing",
      prompt: "Make the button green",
      anchor: ANCHOR,
      context: CONTEXT,
    });
    const done = await waitFor(
      () => {
        const pin = client.latest("pin-1");
        return pin?.status === "idle" && pin.messages.some((m) => m.role === "assistant")
          ? pin
          : undefined;
      },
      { message: "pin finished" },
    );

    // The agent got the element context; the pin shows only what the user typed.
    const sent = [...t3.threads.values()][0]?.messages[0]?.text ?? "";
    expect(sent).toContain("Make the button green");
    expect(sent).toContain("<fixhere-context>");
    expect(sent).toContain("Pricing (src/Pricing.tsx:12)");
    expect(done.messages.find((m) => m.role === "user")?.text).toBe("Make the button green");
    expect(done.messages.find((m) => m.role === "assistant")?.text).toBe(
      "Done: Make the button green",
    );
    expect(done.provider.url).toContain(t3.environmentId);
  });

  it("continues an existing thread and lists provider threads", async () => {
    const { t3, instance } = await setup({ protocol });
    const existing = t3.addThread({ projectId: "proj-1", title: "Existing work" });
    const client = await connectClient(instance);
    await providerReady(client.received);

    client.send({ type: "provider.threads" });
    const listed = await waitFor(() =>
      client.received.find(
        (m): m is Extract<ServerMessage, { type: "provider.threads" }> =>
          m.type === "provider.threads",
      ),
    );
    expect(listed.threads.map((t) => t.title)).toEqual(["Existing work"]);

    client.send({
      type: "thread.create",
      id: "pin-2",
      pageUrl: "http://localhost:3000/",
      prompt: "Also fix this",
      anchor: ANCHOR,
      context: CONTEXT,
      providerThreadId: existing.id,
    });
    await waitFor(() =>
      client.latest("pin-2")?.messages.some((m) => m.text === "Done: Also fix this"),
    );
    expect(t3.threads.size).toBe(1);
  });

  it("replies and stops the agent", async () => {
    const { t3, instance } = await setup({ protocol, slow: true });
    const client = await connectClient(instance);
    await providerReady(client.received);
    client.send({
      type: "thread.create",
      id: "pin-3",
      pageUrl: "http://localhost:3000/",
      prompt: "first",
      anchor: ANCHOR,
      context: CONTEXT,
    });
    await waitFor(() => client.latest("pin-3")?.status === "working", { message: "first turn" });
    client.send({ type: "thread.interrupt", threadId: "pin-3" });
    await waitFor(() => client.latest("pin-3")?.status === "idle", { message: "first stop" });

    client.send({ type: "thread.reply", threadId: "pin-3", text: "second" });
    await waitFor(() => client.latest("pin-3")?.status === "working", { message: "reply runs" });
    client.send({ type: "thread.interrupt", threadId: "pin-3" });
    await waitFor(() => client.latest("pin-3")?.status === "idle", { message: "stopped" });
    expect([...t3.threads.values()][0]?.sessionStatus).toBe("interrupted");
  });
});

describe("pairing from the overlay", () => {
  it("pairs when the overlay asks", async () => {
    const { instance } = await setup({ paired: false, autoPair: false });
    const client = await connectClient(instance);
    await waitFor(() =>
      client.received.some(
        (m) =>
          (m.type === "provider.status" || m.type === "ready") &&
          m.provider.state === "unauthorized",
      ),
    );
    client.send({ type: "provider.pair" });
    await providerReady(client.received);
  });
});

describe("ports", () => {
  it("gives two projects their own bridge and lets a project attach to its own", async () => {
    const base = basePort();
    const dataDir = tmp("fixhere-data-");
    const offline = { url: "http://127.0.0.1:1", autoPair: false, timeouts: FAST };
    const a = await startFixhere({ root: tmp("a-"), basePort: base, dataDir, t3: offline });
    const b = await startFixhere({ root: tmp("b-"), basePort: base, dataDir, t3: offline });
    const again = await startFixhere({ root: a.root, basePort: base, dataDir, t3: offline });
    cleanup.push(
      () => a.close(),
      () => b.close(),
    );

    expect(a.url).not.toBe(b.url);
    expect(again.attached).toBe(true);
    expect(again.url).toBe(a.url);
  });

  it("skips ports held by something that isn't Fixhere", async () => {
    const base = basePort();
    const squatter = createServer((_, res) => res.end("hello")).listen(base, "127.0.0.1");
    cleanup.push(() => new Promise<void>((resolve) => squatter.close(() => resolve())));
    await new Promise((resolve) => squatter.once("listening", resolve));

    const instance = await startFixhere({
      root: tmp("c-"),
      basePort: base,
      dataDir: tmp("fixhere-data-"),
      t3: { url: "http://127.0.0.1:1", autoPair: false, timeouts: FAST },
    });
    cleanup.push(() => instance.close());
    expect(instance.url).toBe(`http://localhost:${base + 1}`);
  });
});

describe("security", () => {
  it("rejects pages from other origins", async () => {
    const { instance } = await setup();
    await expect(connectClient(instance, "https://evil.example")).rejects.toThrow(/403/);
  });

  it("rejects requests addressed to another host name (DNS rebinding)", async () => {
    const { instance } = await setup();
    const ok = await httpGet(`${instance.url}/health`);
    const rebound = await httpGet(`${instance.url}/health`, { host: "evil.example" });
    expect(ok.status).toBe(200);
    expect(rebound.status).toBe(403);
  });

  it("serves the overlay script", async () => {
    const { instance } = await setup();
    const script = await httpGet(instance.scriptUrl);
    expect(script.status).toBe(200);
    expect(script.body.length).toBeGreaterThan(1000);
  });
});
