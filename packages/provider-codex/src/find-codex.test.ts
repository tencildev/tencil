import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appServerSpawner, findCodex, NOT_INSTALLED } from './find-codex.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'tencil-find-codex-'));

function binary(dir: string, name = 'codex'): string {
    mkdirSync(dir, { recursive: true });
    const path = join(dir, name);
    writeFileSync(path, '#!/bin/sh\n');
    chmodSync(path, 0o755);
    return path;
}

const linux = { platform: 'linux' as const };

describe('findCodex', () => {
    it('finds the CLI on the PATH, the first one when there are several', () => {
        const [a, b] = [tmp(), tmp()];
        binary(b);
        const first = binary(a);
        expect(findCodex({ ...linux, env: { PATH: `/nowhere:${a}:${b}` } })).toBe(first);
    });

    it('finds nothing when there is nothing', () => {
        expect(findCodex({ ...linux, env: { PATH: tmp() } })).toBeUndefined();
        expect(findCodex({ ...linux, env: {} })).toBeUndefined();
    });

    it("skips a folder or a file that doesn't run", () => {
        const dir = tmp();
        mkdirSync(join(dir, 'codex'));
        expect(findCodex({ ...linux, env: { PATH: dir } })).toBeUndefined();

        const other = tmp();
        const path = binary(other);
        chmodSync(path, 0o644);
        expect(findCodex({ ...linux, env: { PATH: other } })).toBeUndefined();
    });

    it('finds the copy in the desktop app on a Mac, after the PATH', () => {
        const [system, user] = [tmp(), tmp()];
        const options = { platform: 'darwin' as const, applications: [system, user] };
        expect(findCodex({ ...options, env: {} })).toBeUndefined();

        const inUser = binary(join(user, 'Codex.app', 'Contents', 'Resources'));
        expect(findCodex({ ...options, env: {} })).toBe(inUser);
        const inSystem = binary(join(system, 'ChatGPT.app', 'Contents', 'Resources'));
        expect(findCodex({ ...options, env: {} })).toBe(inSystem);

        const dir = tmp();
        const onPath = binary(dir);
        expect(findCodex({ ...options, env: { PATH: dir } })).toBe(onPath);
    });

    it('only looks in apps on a Mac', () => {
        const applications = [tmp()];
        binary(join(applications[0]!, 'ChatGPT.app', 'Contents', 'Resources'));
        expect(findCodex({ ...linux, applications, env: {} })).toBeUndefined();
    });

    it('finds the npm shim on Windows', () => {
        const dir = tmp();
        const shim = binary(dir, 'codex.cmd');
        expect(findCodex({ platform: 'win32', env: { PATH: dir } })).toBe(shim);
    });
});

describe('appServerSpawner', () => {
    it('uses what it is given, and says how to install Codex when it finds none', () => {
        const spawn = () => {
            throw new Error('unused');
        };
        expect(appServerSpawner({ spawn })).toBe(spawn);
        expect(typeof appServerSpawner({ command: '/some/codex' })).toBe('function');
        expect(typeof appServerSpawner({}, () => '/found/codex')).toBe('function');
        expect(() => appServerSpawner({}, () => undefined)).toThrow(NOT_INSTALLED);
    });
});
