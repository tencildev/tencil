import type { IncomingMessage } from "node:http";

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
