import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const run = promisify(execFile);
const CLI = fileURLToPath(new URL('../../dist/cli.mjs', import.meta.url));

/** Runs the built CLI with its own config folder and a T3 Code that isn't there. */
function cli(args: string[], env: Record<string, string>) {
    return run(process.execPath, [CLI, ...args], {
        env: { ...process.env, ...env, TENCIL_T3_URL: 'http://127.0.0.1:1', NO_COLOR: '1' },
        timeout: 20_000,
    }).then(
        result => ({ code: 0, out: result.stdout }),
        (error: { code?: number; stdout?: string }) => ({
            code: error.code ?? 1,
            out: error.stdout ?? '',
        }),
    );
}

describe.skipIf(!existsSync(CLI))('tencil CLI daemon lifecycle (built)', () => {
    it('starts in the background, reports status, reuses a running daemon and stops', async () => {
        const env = {
            XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), 'tencil-cli-')),
            TENCIL_PORT: String(48_500 + Math.floor(Math.random() * 400)),
        };
        try {
            const started = await cli(['start'], env);
            expect(started.out).toMatch(/Tencil started/);

            const status = await cli(['status'], env);
            expect(status.code).toBe(0);
            expect(status.out).toMatch(/Tencil v/);

            const again = await cli(['start'], env);
            expect(again.out).toMatch(/is running/);
        } finally {
            const stopped = await cli(['stop'], env);
            expect(stopped.out).toMatch(/Stopped/);
        }
        const after = await cli(['status'], env);
        expect(after.code).toBe(1);
    });

    it('keeps the daemon flags across restarts unless new ones are given', async () => {
        const env = {
            XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), 'tencil-cli-')),
            TENCIL_PORT: String(48_900 + Math.floor(Math.random() * 400)),
        };
        const flags = async () =>
            (
                (await (await fetch(`http://127.0.0.1:${env.TENCIL_PORT}/health`)).json()) as {
                    flags: string[];
                }
            ).flags;
        try {
            await cli(['start', '--allow-origin', 'http://devbox:3000'], env);
            expect(await flags()).toEqual(['--allow-origin', 'http://devbox:3000']);

            // What `init` and upgrades do: start without flags.
            expect((await cli(['start'], env)).out).toMatch(/is running/);
            expect(await flags()).toEqual(['--allow-origin', 'http://devbox:3000']);

            const changed = await cli(['start', '--allow-origin', 'http://other:3000'], env);
            expect(changed.out).toMatch(/restarted/);
            expect(await flags()).toEqual(['--allow-origin', 'http://other:3000']);
        } finally {
            await cli(['stop'], env);
        }
    });
});
