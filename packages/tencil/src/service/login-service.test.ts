import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isPackageInstall, runtimeCli, runtimeDir, runtimeInstallArgs } from './autostart.ts';
import {
    launchdPlist,
    serviceEnvironment,
    serviceNames,
    servicePort,
    systemdUnit,
    windowsTaskCommand,
} from './login-service.ts';

const command = {
    node: '/usr/local/bin/node',
    cli: '/usr/local/lib/node_modules/tencil/dist/cli.mjs',
    port: 4747,
    args: ['--model', 'codex:gpt-test'],
};

describe('login service definitions', () => {
    it('runs the daemon with the chosen flags under launchd', () => {
        const plist = launchdPlist(command, '/Users/me/.config/tencil/daemon.log');
        expect(plist).toContain('<string>dev.tencil.daemon</string>');
        expect(plist).toContain('<string>daemon</string>');
        expect(plist).toContain('<string>codex:gpt-test</string>');
        expect(plist).toContain('<key>KeepAlive</key>');
    });

    it('writes a systemd user unit and a Windows task command', () => {
        expect(systemdUnit(command)).toContain(
            'ExecStart="/usr/local/bin/node" "/usr/local/lib/node_modules/tencil/dist/cli.mjs" "daemon" "--port" "4747"',
        );
        expect(windowsTaskCommand(command)).toContain('"daemon" "--port" "4747" "--model"');
    });

    it('names a service on another port apart, so it never replaces the default one', () => {
        expect(serviceNames(4747)).toEqual({
            label: 'dev.tencil.daemon',
            unit: 'tencil.service',
            task: 'Tencil',
        });
        expect(serviceNames(4790)).toEqual({
            label: 'dev.tencil.daemon.4790',
            unit: 'tencil-4790.service',
            task: 'Tencil 4790',
        });
        expect(launchdPlist({ ...command, port: 4790 }, '/tmp/d.log')).toContain(
            '<string>dev.tencil.daemon.4790</string>',
        );
        expect(runtimeDir('/data')).toBe(join('/data', 'runtime'));
        expect(runtimeDir('/data', 4790)).toBe(join('/data', 'runtime-4790'));
    });

    it("gives the service the shell's node and npm, without npx's temporary folders", () => {
        const separator = process.platform === 'win32' ? ';' : ':';
        const env = serviceEnvironment(
            { ...command, node: join('/nvm', 'v22', 'bin', 'node') },
            {
                PATH: [
                    '/Users/me/.npm/_npx/abc/node_modules/.bin',
                    '/app/node_modules/.bin',
                    '/opt/homebrew/bin',
                    '/usr/bin',
                ].join(separator),
                XDG_CONFIG_HOME: '/custom/config',
            },
        );
        expect(env.PATH?.split(separator)).toEqual([
            join('/nvm', 'v22', 'bin'),
            '/opt/homebrew/bin',
            '/usr/bin',
        ]);
        expect(env.XDG_CONFIG_HOME).toBe('/custom/config');
        expect(serviceEnvironment(command, { PATH: '/usr/bin' })).not.toHaveProperty(
            'XDG_CONFIG_HOME',
        );

        const plist = launchdPlist(command, '/tmp/d.log', { PATH: '/nvm/bin:/usr/bin' });
        expect(plist).toContain('<key>EnvironmentVariables</key>');
        expect(plist).toContain('<key>PATH</key>\n    <string>/nvm/bin:/usr/bin</string>');
        expect(systemdUnit(command, { PATH: '/nvm/bin:/usr/bin' })).toContain(
            'Environment="PATH=/nvm/bin:/usr/bin"\nExecStart=',
        );
    });

    it('reads the daemon port back from each definition', () => {
        const plist = launchdPlist({ ...command, port: 4800 }, '/tmp/daemon.log');
        expect(servicePort(plist)).toBe(4800);
        expect(servicePort(systemdUnit(command))).toBe(4747);
        expect(servicePort(`<Arguments>${windowsTaskCommand(command)}</Arguments>`)).toBe(4747);
        expect(servicePort(undefined)).toBeUndefined();
    });
});

describe('login service copy', () => {
    it('gives package installs (npx, projects, global) their own copy', () => {
        expect(
            isPackageInstall('/Users/me/.npm/_npx/abc123/node_modules/tencil/dist/cli.mjs'),
        ).toBe(true);
        expect(isPackageInstall(command.cli)).toBe(true);
        expect(isPackageInstall('C:\\work\\app\\node_modules\\tencil\\dist\\cli.mjs')).toBe(true);
        expect(isPackageInstall('/Users/me/Code/tencil/packages/tencil/dist/cli.mjs')).toBe(false);
    });

    it('installs that copy into the data folder with npm', () => {
        expect(runtimeInstallArgs('/Users/me/.config/tencil', 'tencil@0.1.2')).toEqual([
            'install',
            '--prefix',
            join('/Users/me/.config/tencil', 'runtime'),
            'tencil@0.1.2',
            '--no-audit',
            '--no-fund',
            '--loglevel=error',
        ]);
        expect(runtimeCli('/Users/me/.config/tencil')).toBe(
            join(
                '/Users/me/.config/tencil',
                'runtime',
                'node_modules',
                'tencil',
                'dist',
                'cli.mjs',
            ),
        );
    });
});
