import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bridgeState, connect, update } from './connection.ts';

/** A socket that never connects: every attempt closes on the next tick. */
class RefusedSocket extends EventTarget {
    static readonly OPEN = 1;
    static attempts = 0;
    readyState = 0;

    constructor() {
        super();
        RefusedSocket.attempts++;
        setTimeout(() => this.dispatchEvent(new Event('close')), 0);
    }

    close(): void {}
}

beforeEach(() => {
    vi.useFakeTimers();
    RefusedSocket.attempts = 0;
    vi.stubGlobal('WebSocket', RefusedSocket);
    vi.stubGlobal('location', { href: 'http://localhost:3000/' });
    vi.stubGlobal('window', new EventTarget());
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    update.value = null;
});

describe('connection', () => {
    it('stays offline while it retries a daemon that is down', async () => {
        const states: string[] = [];
        const stop = bridgeState.subscribe(state => states.push(state));
        connect('http://localhost:4747');

        await vi.advanceTimersByTimeAsync(20_000);
        stop();

        expect(RefusedSocket.attempts).toBeGreaterThan(3);
        // Connecting once at the start, then offline without blinking back.
        expect(states.slice(states.indexOf('closed'))).not.toContain('connecting');
    });

    it('shows a daemon restarting on a new version as connecting', async () => {
        connect('http://localhost:4747');
        await vi.advanceTimersByTimeAsync(0);
        expect(bridgeState.value).toBe('closed');

        const states: string[] = [];
        const stop = bridgeState.subscribe(state => states.push(state));
        update.value = { state: 'restarting' } as typeof update.value;
        await vi.advanceTimersByTimeAsync(10_000);
        stop();

        expect(states).toContain('connecting');
    });
});
