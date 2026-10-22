import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Sites the developer let talk to the daemon from the approval page, on top of
 * loopback ones and `--allow-origin`. Kept in memory: the WebSocket upgrade
 * checks it synchronously.
 */
export class AllowedOrigins {
    readonly #fixed: string[];
    #approved: string[];

    constructor(
        readonly path: string,
        fixed: string[] = [],
    ) {
        this.#fixed = fixed;
        this.#approved = read(path);
    }

    all(): string[] {
        return [...this.#fixed, ...this.#approved];
    }

    add(origin: string): void {
        if (this.all().includes(origin)) return;
        this.#approved = [...this.#approved, origin];
        mkdirSync(dirname(this.path), { recursive: true });
        writeFileSync(this.path, `${JSON.stringify(this.#approved, null, 2)}\n`);
    }
}

/** The origin a page may ask to be allowed: http(s) and nothing but scheme, host and port. */
export function approvableOrigin(value: string | undefined | null): string | undefined {
    if (!value) return undefined;
    try {
        const url = new URL(value);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
        return url.origin === value ? value : undefined;
    } catch {
        return undefined;
    }
}

function read(path: string): string[] {
    try {
        const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
        return Array.isArray(parsed) ? parsed.filter(o => approvableOrigin(o) === o) : [];
    } catch {
        return [];
    }
}
