import type { IncomingMessage } from 'node:http';

/**
 * The bridge can make an agent edit code, so only pages the developer runs
 * locally (or explicitly allowed with `--allow-origin`) may talk to it.
 * Browsers always send Origin on WebSocket upgrades; a request without one
 * comes from a non-browser tool, which is only trusted on this machine.
 */
export function isAllowedOrigin(request: IncomingMessage, allowedOrigins: string[]): boolean {
    const origin = request.headers.origin;
    if (!origin) return isLoopbackAddress(request.socket.remoteAddress);
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return true;
    let hostname: string;
    try {
        hostname = new URL(origin).hostname;
    } catch {
        return false;
    }
    return isLoopbackName(hostname);
}

/**
 * DNS rebinding guard: a hostile domain re-pointed at this machine still sends
 * its own name as Host. Only loopback names and the names we were told about
 * (listen addresses, allowed origins' hosts) may talk to us.
 */
export function isAllowedHost(request: IncomingMessage, knownHosts: string[]): boolean {
    const header = request.headers.host;
    if (!header) return false;
    let hostname: string;
    try {
        hostname = new URL(`http://${header}`).hostname;
    } catch {
        return false;
    }
    return isLoopbackName(hostname) || knownHosts.includes(hostname);
}

/** Host names a request may be addressed to, besides loopback ones. */
export function knownHostsFor(listen: string[], allowedOrigins: string[]): string[] {
    const hosts = new Set(listen);
    for (const origin of allowedOrigins) {
        try {
            hosts.add(new URL(origin).hostname);
        } catch {
            // `*` and other non-URLs name no host.
        }
    }
    return [...hosts];
}

function isLoopbackName(hostname: string): boolean {
    return (
        hostname === 'localhost' ||
        hostname.endsWith('.localhost') ||
        hostname === '[::1]' ||
        /^127(?:\.\d{1,3}){3}$/.test(hostname)
    );
}

function isLoopbackAddress(address: string | undefined): boolean {
    if (!address) return false;
    const ip = address.replace(/^::ffff:/, '');
    return ip === '::1' || /^127(?:\.\d{1,3}){3}$/.test(ip);
}
