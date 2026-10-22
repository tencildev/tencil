import { describe, expect, it } from 'vitest';
import { originOf } from './origins.ts';

describe('originOf', () => {
    it('keeps the port, drops the path', () => {
        expect(originOf('http://localhost:5173/settings?tab=1')).toBe('http://localhost:5173');
        expect(originOf('https://app.localhost/')).toBe('https://app.localhost');
    });

    it('skips pages a script tag cannot go into', () => {
        expect(originOf('chrome://extensions')).toBeUndefined();
        expect(originOf('file:///Users/me/index.html')).toBeUndefined();
        expect(originOf('not a url')).toBeUndefined();
    });
});
