import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { WebSocketServer } from "ws";
import type { Bridge, BridgeClient } from "./bridge.ts";

export interface ServerOptions {
  bridge: Bridge;
  port: number;
  host: string;
  /** Project root, reported on /health so other processes can attach. */
  root: string;
  /** Absolute path of the built overlay IIFE. */
  overlayPath: string;
  /** Extra origins allowed to connect, besides loopback ones. */
  allowedOrigins: string[];
  version: string;
}

/** Screenshots ride along as data URLs. */
const MAX_PAYLOAD_BYTES = 32 * 1024 * 1024;

export function startServer(options: ServerOptions): Promise<Server> {
  const server = createServer(async (request, response) => {
    if (!isAllowedHost(request, options.host)) {
      response.writeHead(403, { "content-type": "text/plain" });
      response.end("Forbidden host");
      return;
    }
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/fixhere.js") {
      try {
        const body = await readFile(options.overlayPath);
        response.writeHead(200, {
          "content-type": "text/javascript; charset=utf-8",
          "cache-control": "no-cache",
          "access-control-allow-origin": "*",
        });
        response.end(body);
      } catch {
        response.writeHead(500, { "content-type": "text/plain" });
        response.end(`Overlay bundle missing at ${options.overlayPath}. Build it first.`);
      }
      return;
    }
    if (url.pathname === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({ name: "fixhere", version: options.version, root: options.root }),
      );
      return;
    }
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("Not found");
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (
      url.pathname !== "/ws" ||
      !isAllowedHost(request, options.host) ||
      !isAllowedOrigin(request, options.allowedOrigins)
    ) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      const client: BridgeClient = {
        send: (message) => {
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
        },
      };
      const disconnect = options.bridge.connect(client);
      ws.on("message", (data) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(String(data));
        } catch {
          client.send({ type: "error", message: "Malformed JSON" });
          return;
        }
        void options.bridge.handle(client, parsed);
      });
      ws.on("close", disconnect);
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

/**
 * The bridge can make an agent edit code, so only pages the developer runs
 * locally may talk to it. Browsers always send Origin on WebSocket upgrades;
 * requests without one come from non-browser tools.
 */
export function isAllowedOrigin(request: IncomingMessage, allowedOrigins: string[]): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  if (allowedOrigins.includes("*") || allowedOrigins.includes(origin)) return true;
  let hostname: string;
  try {
    hostname = new URL(origin).hostname;
  } catch {
    return false;
  }
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname)
  );
}

/**
 * DNS rebinding guard: a hostile domain re-pointed at 127.0.0.1 still sends
 * its own name as Host. When bound to loopback only loopback names may talk to us.
 */
export function isAllowedHost(request: IncomingMessage, boundHost: string): boolean {
  if (!isLoopback(boundHost)) return true;
  const header = request.headers.host;
  if (!header) return false;
  let hostname: string;
  try {
    hostname = new URL(`http://${header}`).hostname;
  } catch {
    return false;
  }
  return isLoopback(hostname) || hostname === "localhost" || hostname.endsWith(".localhost");
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}
