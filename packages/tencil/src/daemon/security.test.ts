import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { isAllowedHost, isAllowedOrigin, knownHostsFor } from './security.ts';

const request = (headers: Record<string, string>, remoteAddress = '127.0.0.1') =>
    ({ headers, socket: { remoteAddress } }) as unknown as IncomingMessage;

describe('isAllowedOrigin', () => {
    it('allows loopback pages and listed origins only', () => {
        expect(isAllowedOrigin(request({ origin: 'http://localhost:3001' }), [])).toBe(true);
        expect(isAllowedOrigin(request({ origin: 'http://app.localhost:3001' }), [])).toBe(true);
        expect(isAllowedOrigin(request({ origin: 'http://devbox:3001' }), [])).toBe(false);
        expect(
            isAllowedOrigin(request({ origin: 'http://devbox:3001' }), [
                'http://devbox:3001',
            ]),
        ).toBe(true);
    });

    it('trusts origin-less tools only on this machine', () => {
        expect(isAllowedOrigin(request({}, '127.0.0.1'), [])).toBe(true);
        expect(isAllowedOrigin(request({}, '::ffff:127.0.0.1'), [])).toBe(true);
        expect(isAllowedOrigin(request({}, '::1'), [])).toBe(true);
        expect(isAllowedOrigin(request({}, '100.64.0.1'), [])).toBe(false);
    });
});

describe('isAllowedHost', () => {
    it('accepts loopback names and known hosts', () => {
        const known = knownHostsFor(['127.0.0.1', '100.64.0.1'], ['http://devbox:3001', '*']);
        expect(known).toEqual(['127.0.0.1', '100.64.0.1', 'devbox']);
        expect(isAllowedHost(request({ host: 'localhost:4747' }), known)).toBe(true);
        expect(isAllowedHost(request({ host: '100.64.0.1:4747' }), known)).toBe(true);
        expect(isAllowedHost(request({ host: 'devbox:4747' }), known)).toBe(true);
        expect(isAllowedHost(request({ host: 'evil.example:4747' }), known)).toBe(false);
        expect(isAllowedHost(request({}), known)).toBe(false);
    });
});
