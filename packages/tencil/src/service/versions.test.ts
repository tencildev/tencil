import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { VERSION } from '../version.ts';
import { enableAutostart, ensureDaemon } from './autostart.ts';
import { startInBackground } from './background.ts';
import { compareVersions, isNewerThanThis, NewerDaemonError } from './versions.ts';

describe('compareVersions', () => {
    it('compares by number, not as text', () => {
        expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0);
        expect(compareVersions('0.3.1', '0.3.1')).toBe(0);
        expect(compareVersions('0.3.0', '0.3.1')).toBeLessThan(0);
        expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBe(0);
        expect(isNewerThanThis('999.0.0')).toBe(true);
        expect(isNewerThanThis(VERSION)).toBe(false);
        expect(isNewerThanThis(undefined)).toBe(false);
    });
});

describe('a newer daemon already running', () => {
    let server: Server | undefined;
    afterEach(() => server?.close());

    /** Answers /health like a Tencil daemon from the future. */
    async function newerDaemon(): Promise<number> {
        const daemon = createServer((_request, response) => {
            response.end(
                JSON.stringify({
                    name: 'tencil',
                    version: '999.0.0',
                    pid: 1,
                    flags: [],
                    projects: [],
                }),
            );
        });
        server = daemon;
        await new Promise<void>(done => daemon.listen(0, '127.0.0.1', done));
        return (daemon.address() as AddressInfo).port;
    }

    it('is left alone by start, init and setup', async () => {
        const port = await newerDaemon();
        const command = { node: process.execPath, cli: '/nowhere/cli.mjs', port };
        expect(await startInBackground(command, '/nowhere')).toEqual({
            status: 'running',
            pid: 1,
            newer: '999.0.0',
        });
        expect(await ensureDaemon(command, '/nowhere')).toMatchObject({ newer: '999.0.0' });
        await expect(enableAutostart(command, '/nowhere')).rejects.toBeInstanceOf(NewerDaemonError);
    });
});
