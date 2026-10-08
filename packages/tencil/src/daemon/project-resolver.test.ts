import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    type Exec,
    ProjectResolver,
    parseLsofCwd,
    parseNetstat,
    parsePids,
    parseSs,
    projectFromCommandLine,
    projectRoot,
} from './project-resolver.ts';

const tmp = (prefix: string) => realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));

/** A fake app folder: <root>/apps/web with package.json files. */
function monorepo() {
    const root = tmp('tencil-repo-');
    mkdirSync(join(root, 'apps', 'web', 'src'), { recursive: true });
    writeFileSync(join(root, 'package.json'), '{}');
    writeFileSync(join(root, 'apps', 'web', 'package.json'), '{}');
    return { root, app: join(root, 'apps', 'web') };
}

describe('output parsing', () => {
    it('reads PIDs from lsof -t', () => {
        expect(parsePids('3594\n3600\n3594\n')).toEqual([3594, 3600]);
    });

    it('reads the cwd from lsof -Fn', () => {
        expect(parseLsofCwd('p3594\nfcwd\nn/Users/me/Code/eyes/apps/frontend\n')).toBe(
            '/Users/me/Code/eyes/apps/frontend',
        );
    });

    it("reads PIDs from ss when lsof isn't installed", () => {
        expect(
            parseSs(
                'LISTEN 0 511 *:5173 *:* users:(("node",pid=4242,fd=23),("node",pid=4242,fd=24))',
            ),
        ).toEqual([4242]);
    });

    it('finds listening PIDs in netstat -ano', () => {
        const output = `
  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       4120
  TCP    [::]:3000              [::]:0                 LISTENING       4120
  TCP    127.0.0.1:30001        0.0.0.0:0              LISTENING       999
  TCP    127.0.0.1:3000         127.0.0.1:51234        ESTABLISHED     4120`;
        expect(parseNetstat(output, 3000)).toEqual([4120]);
    });

    it("derives the project from a dev server's command line", () => {
        expect(
            projectFromCommandLine(
                'node /Users/me/Code/eyes/apps/frontend/node_modules/.bin/next dev',
            ),
        ).toBe('/Users/me/Code/eyes/apps/frontend');
        expect(
            projectFromCommandLine(
                '"C:\\Program Files\\nodejs\\node.exe" C:\\work\\shop\\node_modules\\vite\\bin\\vite.js',
            ),
        ).toBe('C:\\work\\shop');
        expect(projectFromCommandLine('next-server (v16.3.6)')).toBeUndefined();
    });

    it('walks up to the nearest package.json', () => {
        const { app } = monorepo();
        expect(projectRoot(join(app, 'src'))).toBe(app);
    });
});

describe('ProjectResolver', () => {
    const fakeExec =
        (cwd: string, command = ''): Exec =>
        async (bin, args) => {
            if (bin === 'lsof' && args.includes('-t')) return '4242\n';
            if (bin === 'lsof') return `p4242\nfcwd\nn${cwd}\n`;
            if (bin === 'ps') return command;
            throw new Error(`unexpected ${bin}`);
        };

    it("maps a page to its dev server's folder via the port", async () => {
        const { app } = monorepo();
        const resolver = new ProjectResolver({
            dataDir: tmp('tencil-data-'),
            exec: fakeExec(app),
            platform: 'darwin',
        });
        expect(await resolver.resolve('http://localhost:5173/pricing')).toBe(app);
    });

    it("falls back to the command line when the cwd isn't a project", async () => {
        const { app } = monorepo();
        const resolver = new ProjectResolver({
            dataDir: tmp('tencil-data-'),
            exec: fakeExec('/', `node ${join(app, 'node_modules', '.bin', 'vite')}`),
            platform: 'darwin',
        });
        expect(await resolver.resolve('http://localhost:5173/')).toBe(app);
    });

    it('returns nothing when no process can be found, and remembers picks', async () => {
        const { app } = monorepo();
        const dataDir = tmp('tencil-data-');
        const none: Exec = async () => '';
        const resolver = new ProjectResolver({ dataDir, exec: none, platform: 'darwin' });
        expect(await resolver.resolve('http://localhost:8080/')).toBeUndefined();

        await resolver.remember('http://localhost:8080/some/page', app);
        const later = new ProjectResolver({ dataDir, exec: none, platform: 'darwin' });
        expect(await later.resolve('http://localhost:8080/other')).toBe(app);
    });
});
