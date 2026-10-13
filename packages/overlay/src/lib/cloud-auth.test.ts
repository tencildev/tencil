import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    challengeFor,
    forgetToken,
    pinBlocked,
    signInRequired,
    storedToken,
    viewer,
} from './cloud-auth.ts';

const CLOUD = 'https://cloud.tencil.dev';

beforeEach(() => {
    const items = new Map<string, string>();
    vi.stubGlobal('localStorage', {
        getItem: (key: string) => items.get(key) ?? null,
        setItem: (key: string, value: string) => items.set(key, value),
        removeItem: (key: string) => items.delete(key),
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
    signInRequired.value = null;
    viewer.value = null;
});

describe('PKCE', () => {
    it('derives the S256 challenge from the verifier', async () => {
        const verifier = 'M25iVXpKU3puUjFaYWg3T1NDTDQtcW1ROUY5YXlwalNoc0hhakxifmZHag';
        // base64url(sha256(verifier)), computed with Node's crypto.
        expect(await challengeFor(verifier)).toBe('qjrzSW9gMiUgpUvqgEPE4_-8swvyCtfOVvg55o5S_es');
    });
});

describe('stored tokens', () => {
    it('returns a token until shortly before it expires, per Tencil Cloud host', () => {
        const now = Date.now();
        localStorage.setItem(
            'tencil-cloud-token:cloud.tencil.dev',
            JSON.stringify({ token: 'abc', expiresAt: now + 10 * 60_000 }),
        );
        expect(storedToken(CLOUD, now)).toBe('abc');
        expect(storedToken('https://staging.tencil.dev', now)).toBeUndefined();
        expect(storedToken(CLOUD, now + 9.5 * 60_000)).toBeUndefined();
        // An expired token is dropped.
        expect(localStorage.getItem('tencil-cloud-token:cloud.tencil.dev')).toBeNull();
    });

    it('forgets a token on sign-out or rejection', () => {
        localStorage.setItem(
            'tencil-cloud-token:cloud.tencil.dev',
            JSON.stringify({ token: 'abc', expiresAt: Date.now() + 3_600_000 }),
        );
        forgetToken(CLOUD);
        expect(storedToken(CLOUD)).toBeUndefined();
    });

    it('ignores garbage in storage', () => {
        localStorage.setItem('tencil-cloud-token:cloud.tencil.dev', '{not json');
        expect(storedToken(CLOUD)).toBeUndefined();
    });
});

describe('pinBlocked', () => {
    it('blocks pinning until signed in, and for viewers without write access', () => {
        expect(pinBlocked.value).toBeNull();
        signInRequired.value = {
            signIn: {
                authorizeUrl: `${CLOUD}/oauth/authorize`,
                tokenUrl: `${CLOUD}/oauth/token`,
                clientId: 'overlay',
                redirectUri: `${CLOUD}/overlay/callback`,
            },
        };
        expect(pinBlocked.value).toMatch(/Sign in/);
        signInRequired.value = null;
        viewer.value = { name: 'Ada', login: 'ada', access: 'read' };
        expect(pinBlocked.value).toMatch(/View only/);
        viewer.value = { name: 'Ada', login: 'ada', access: 'write' };
        expect(pinBlocked.value).toBeNull();
    });
});
