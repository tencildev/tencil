import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    type Exec,
    isDockerForwarder,
    isGitRoot,
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

    it("recognises Docker's port forwarders", () => {
        expect(
            isDockerForwarder(
                '/Applications/Docker.app/Contents/MacOS/com.docker.backend services',
            ),
        ).toBe(true);
        expect(
            isDockerForwarder(
                '/usr/bin/docker-proxy -proto tcp -host-ip 0.0.0.0 -host-port 8130 -container-ip 172.18.0.3 -container-port 80',
            ),
        ).toBe(true);
        expect(
            isDockerForwarder(
                '"C:\\Program Files\\Docker\\Docker\\resources\\com.docker.backend.exe"',
            ),
        ).toBe(true);
        expect(
            isDockerForwarder(
                '/Applications/OrbStack.app/Contents/Frameworks/OrbStack Helper.app/Contents/MacOS/OrbStack Helper vmgr',
            ),
        ).toBe(true);
        expect(isDockerForwarder('/opt/homebrew/bin/limactl hostagent colima')).toBe(true);
        expect(isDockerForwarder('node /Users/me/shop/node_modules/.bin/vite')).toBe(false);
        expect(isDockerForwarder('/Users/me/bin/docker-proxy-tests')).toBe(false);
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

    /** A port published by Docker: `ps` shows the forwarder, `docker ps` the compose label. */
    const dockerExec =
        (forwarder: string, label: string, calls: string[] = []): Exec =>
        async (bin, args) => {
            calls.push(bin);
            if (bin === 'lsof' && args.includes('-t')) return '50164\n';
            if (bin === 'lsof') return 'p50164\nfcwd\nn/var/lib/docker\n';
            if (bin === 'ps') return forwarder;
            if (bin === 'docker') {
                expect(args).toEqual([
                    'ps',
                    '--filter',
                    'publish=8130',
                    '--format',
                    '{{.Label "com.docker.compose.project.working_dir"}}',
                ]);
                return `${label}\n`;
            }
            throw new Error(`unexpected ${bin}`);
        };

    it('maps a port published by Docker Desktop to the compose project', async () => {
        const { app } = monorepo();
        const resolver = new ProjectResolver({
            dataDir: tmp('tencil-data-'),
            exec: dockerExec(
                '/Applications/Docker.app/Contents/MacOS/com.docker.backend services',
                app,
            ),
            platform: 'darwin',
        });
        expect(await resolver.resolve('http://localhost:8130/')).toBe(app);
    });

    it('maps a port published through docker-proxy to the compose project', async () => {
        const { app } = monorepo();
        const resolver = new ProjectResolver({
            dataDir: tmp('tencil-data-'),
            exec: dockerExec('/usr/bin/docker-proxy -proto tcp -host-port 8130', app),
            platform: 'darwin',
        });
        expect(await resolver.resolve('http://localhost:8130/')).toBe(app);
    });

    it("asks Docker on Linux when root's docker-proxy is hidden from lsof", async () => {
        const { app } = monorepo();
        const exec: Exec = async (bin, args) => {
            if (bin === 'lsof') return '';
            return dockerExec('', app)(bin, args);
        };
        const resolver = new ProjectResolver({
            dataDir: tmp('tencil-data-'),
            exec,
            platform: 'linux',
        });
        expect(await resolver.resolve('http://localhost:8130/')).toBe(app);
    });

    it('returns nothing for a container without compose labels, or without Docker', async () => {
        const forwarder = '/usr/bin/docker-proxy -proto tcp -host-port 8130';
        const unlabelled = new ProjectResolver({
            dataDir: tmp('tencil-data-'),
            exec: dockerExec(forwarder, ''),
            platform: 'linux',
        });
        expect(await unlabelled.resolve('http://localhost:8130/')).toBeUndefined();

        const noDocker: Exec = async (bin, args) => {
            if (bin === 'docker') throw new Error('spawn docker ENOENT');
            return dockerExec(forwarder, '')(bin, args);
        };
        const missing = new ProjectResolver({
            dataDir: tmp('tencil-data-'),
            exec: noDocker,
            platform: 'darwin',
        });
        expect(await missing.resolve('http://localhost:8130/')).toBeUndefined();
    });

    it("doesn't ask Docker about an ordinary dev server", async () => {
        const { app } = monorepo();
        const calls: string[] = [];
        const exec: Exec = async (bin, args) => {
            calls.push(bin);
            return fakeExec(app)(bin, args);
        };
        const resolver = new ProjectResolver({
            dataDir: tmp('tencil-data-'),
            exec,
            platform: 'darwin',
        });
        expect(await resolver.resolve('http://localhost:5173/')).toBe(app);
        expect(calls).not.toContain('docker');
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

    // A Laravel app on Sail: Docker listens on the page's port, not a process in the project.
    const docker = fakeExec('/Users/me/Library/Containers/com.docker.docker/Data');

    it('prefers the repository root from the loader over the port', async () => {
        const { root, app } = monorepo();
        mkdirSync(join(root, '.git'));
        const resolver = new ProjectResolver({
            dataDir: tmp('tencil-data-'),
            exec: fakeExec(app),
            platform: 'darwin',
        });
        expect(await resolver.resolve('http://localhost:8130/', root)).toBe(root);
    });

    it('refuses a claimed root without .git and falls back to the port', async () => {
        const { root, app } = monorepo();
        const resolver = new ProjectResolver({
            dataDir: tmp('tencil-data-'),
            exec: fakeExec(app),
            platform: 'darwin',
        });
        expect(await resolver.resolve('http://localhost:5173/', root)).toBe(app);
        expect(await resolver.resolve('http://localhost:5173/', 'relative/path')).toBe(app);
        expect(await resolver.resolve('http://localhost:5173/', join(root, 'missing'))).toBe(app);
    });

    it('resolves a worktree, whose .git is a file, to the worktree itself', async () => {
        const main = monorepo().root;
        mkdirSync(join(main, '.git'));
        const worktree = monorepo().root;
        writeFileSync(join(worktree, '.git'), `gitdir: ${join(main, '.git', 'worktrees', 'x')}\n`);
        const resolver = new ProjectResolver({
            dataDir: tmp('tencil-data-'),
            exec: docker,
            platform: 'darwin',
        });
        expect(isGitRoot(worktree)).toBe(true);
        expect(await resolver.resolve('http://localhost:8130/', worktree)).toBe(worktree);
    });

    it('prefers the dev server on the port over an earlier pick for the address', async () => {
        const { app } = monorepo();
        const earlier = monorepo().app;
        const dataDir = tmp('tencil-data-');
        const resolver = new ProjectResolver({ dataDir, exec: fakeExec(app), platform: 'darwin' });
        await resolver.remember('http://localhost:5173/', earlier);
        expect(await resolver.resolve('http://localhost:5173/')).toBe(app);
    });

    it('prefers the repository root from the loader over an earlier pick', async () => {
        const { root } = monorepo();
        mkdirSync(join(root, '.git'));
        const earlier = monorepo().app;
        const dataDir = tmp('tencil-data-');
        const resolver = new ProjectResolver({ dataDir, exec: docker, platform: 'darwin' });
        await resolver.remember('http://localhost:8130/', earlier);
        expect(await resolver.resolve('http://localhost:8130/', root)).toBe(root);
    });

    it("falls back to the pick when the port can't be traced to a project", async () => {
        const picked = monorepo().app;
        const dataDir = tmp('tencil-data-');
        const resolver = new ProjectResolver({ dataDir, exec: docker, platform: 'darwin' });
        await resolver.remember('http://localhost:8130/', picked);
        expect(await resolver.resolve('http://localhost:8130/')).toBe(picked);
    });

    it('sees IPv6 listeners on Windows', async () => {
        const { app } = monorepo();
        const exec: Exec = async (bin, args) => {
            if (bin === 'netstat') {
                expect(args).toEqual(['-ano']);
                return '  TCP    [::1]:5173             [::]:0                 LISTENING       4242\n';
            }
            if (bin === 'powershell')
                return `node ${join(app, 'node_modules', 'vite', 'bin', 'vite.js')}`;
            throw new Error(`unexpected ${bin}`);
        };
        const resolver = new ProjectResolver({
            dataDir: tmp('tencil-data-'),
            exec,
            platform: 'win32',
        });
        expect(await resolver.resolve('http://localhost:5173/')).toBe(app);
    });
});
