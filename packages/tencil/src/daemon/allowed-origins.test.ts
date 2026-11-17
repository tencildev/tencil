import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AllowedOrigins, approvableOrigin } from './allowed-origins.ts';

const file = () => join(mkdtempSync(join(tmpdir(), 'tencil-origins-')), 'allowed-origins.json');

describe('AllowedOrigins', () => {
    it('keeps approved origins next to the fixed ones, across restarts', () => {
        const path = file();
        const origins = new AllowedOrigins(path, ['http://devbox:3001']);
        origins.add('https://example.com');
        origins.add('https://example.com');
        expect(origins.all()).toEqual(['http://devbox:3001', 'https://example.com']);
        expect(new AllowedOrigins(path).all()).toEqual(['https://example.com']);
        expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(['https://example.com']);
    });

    it('ignores a missing or broken file', () => {
        const path = file();
        expect(new AllowedOrigins(path).all()).toEqual([]);
        writeFileSync(path, '{ nope');
        expect(new AllowedOrigins(path).all()).toEqual([]);
        writeFileSync(path, JSON.stringify(['https://ok.example', '*', 'null', 42]));
        expect(new AllowedOrigins(path).all()).toEqual(['https://ok.example']);
    });
});

describe('approvableOrigin', () => {
    it('takes a bare http(s) origin', () => {
        expect(approvableOrigin('https://joanverhulst.com')).toBe('https://joanverhulst.com');
        expect(approvableOrigin('http://192.168.1.10:3000')).toBe('http://192.168.1.10:3000');
    });

    it('refuses wildcards, opaque origins and anything with a path', () => {
        for (const value of ['*', 'null', 'file:///tmp', 'https://example.com/', 'nope', '']) {
            expect(approvableOrigin(value)).toBeUndefined();
        }
    });
});
