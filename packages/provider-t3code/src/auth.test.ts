import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CredentialStore, resolveT3Url, runningT3Url, withoutNpmEnv } from './auth.ts';

function t3HomeWith(runtime: unknown): string {
    const home = mkdtempSync(join(tmpdir(), 'tencil-t3-'));
    mkdirSync(join(home, 'userdata'));
    writeFileSync(
        join(home, 'userdata', 'server-runtime.json'),
        typeof runtime === 'string' ? runtime : JSON.stringify(runtime),
    );
    return home;
}

describe('runningT3Url', () => {
    it("reads the origin of this user's running T3 Code", async () => {
        const home = t3HomeWith({ version: 1, pid: process.pid, origin: 'http://127.0.0.1:42697' });
        expect(await runningT3Url(home)).toBe('http://127.0.0.1:42697');
    });

    it('ignores a file left behind by a server that is gone', async () => {
        const exited = spawnSync(process.execPath, ['-e', '']).pid;
        expect(await runningT3Url(t3HomeWith({ pid: exited, origin: 'http://127.0.0.1:1' }))).toBe(
            undefined,
        );
        expect(await runningT3Url(t3HomeWith({ pid: 0, origin: 'http://127.0.0.1:1' }))).toBe(
            undefined,
        );
    });

    it('ignores a missing or broken file', async () => {
        expect(await runningT3Url(mkdtempSync(join(tmpdir(), 'tencil-t3-')))).toBe(undefined);
        expect(await runningT3Url(t3HomeWith('{nope'))).toBe(undefined);
        expect(await runningT3Url(t3HomeWith({ pid: process.pid }))).toBe(undefined);
    });
});

describe('resolveT3Url', () => {
    const credentials = () =>
        new CredentialStore(join(mkdtempSync(join(tmpdir(), 'tencil-cred-')), 'credentials.json'));
    const running = t3HomeWith({ pid: process.pid, origin: 'http://127.0.0.1:42697' });

    const paired = async (baseUrl: string) => {
        const store = credentials();
        await store.set(baseUrl, {
            token: 't',
            scope: '',
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
        });
        return store;
    };
    const empty = mkdtempSync(join(tmpdir(), 'tencil-t3-'));

    it('prefers a configured URL, then a server paired on another machine', async () => {
        const remote = await paired('https://devbox.example:3773');
        expect(
            await resolveT3Url({
                baseUrl: 'localhost:6000',
                credentials: remote,
                baseDir: running,
            }),
        ).toBe('http://localhost:6000');
        expect(await resolveT3Url({ credentials: remote, baseDir: running })).toBe(
            'https://devbox.example:3773',
        );
    });

    it('prefers the running T3 Code over a stale local pairing', async () => {
        const local = await paired('http://127.0.0.1:5000');
        expect(await resolveT3Url({ credentials: local, baseDir: running })).toBe(
            'http://127.0.0.1:42697',
        );
        // Not running right now: keep the paired server, it may start later.
        expect(await resolveT3Url({ credentials: local, baseDir: empty })).toBe(
            'http://127.0.0.1:5000',
        );
    });

    it('uses the running T3 Code before falling back to port 3773', async () => {
        expect(await resolveT3Url({ credentials: credentials(), baseDir: running })).toBe(
            'http://127.0.0.1:42697',
        );
        expect(await resolveT3Url({ credentials: credentials(), baseDir: empty })).toBe(
            'http://127.0.0.1:3773',
        );
    });
});

describe('withoutNpmEnv', () => {
    it("drops what an outer npx passes down but keeps the user's own settings", () => {
        expect(
            withoutNpmEnv({
                PATH: '/usr/bin',
                npm_config_package: '/tmp/tencil.tgz',
                npm_config_yes: 'true',
                npm_command: 'exec',
                NPM_CONFIG_REGISTRY: 'https://registry.example',
            }),
        ).toEqual({ PATH: '/usr/bin', NPM_CONFIG_REGISTRY: 'https://registry.example' });
    });
});
