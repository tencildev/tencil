import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isPackageInstall, runtimeCli, runtimeDir, runtimeInstallArgs } from './autostart.ts';
import {
    launchdPlist,
    serviceNames,
    servicePort,
    systemdUnit,
    windowsTaskCommand,
} from './login-service.ts';

const command = {
    node: '/usr/local/bin/node',
    cli: '/usr/local/lib/node_modules/fixhere/dist/cli.mjs',
    port: 4747,
    args: ['--model', 'codex:gpt-test'],
};

describe('login service definitions', () => {
    it('runs the daemon with the chosen flags under launchd', () => {
        const plist = launchdPlist(command, '/Users/me/.config/fixhere/daemon.log');
        expect(plist).toContain('<string>dev.fixhere.daemon</string>');
        expect(plist).toContain('<string>daemon</string>');
        expect(plist).toContain('<string>codex:gpt-test</string>');
        expect(plist).toContain('<key>KeepAlive</key>');
    });

    it('writes a systemd user unit and a Windows task command', () => {
        expect(systemdUnit(command)).toContain(
            'ExecStart="/usr/local/bin/node" "/usr/local/lib/node_modules/fixhere/dist/cli.mjs" "daemon" "--port" "4747"',
        );
        expect(windowsTaskCommand(command)).toContain('"daemon" "--port" "4747" "--model"');
    });

    it('names a service on another port apart, so it never replaces the default one', () => {
        expect(serviceNames(4747)).toEqual({
            label: 'dev.fixhere.daemon',
            unit: 'fixhere.service',
            task: 'Fixhere',
        });
        expect(serviceNames(4790)).toEqual({
            label: 'dev.fixhere.daemon.4790',
            unit: 'fixhere-4790.service',
            task: 'Fixhere 4790',
        });
        expect(launchdPlist({ ...command, port: 4790 }, '/tmp/d.log')).toContain(
            '<string>dev.fixhere.daemon.4790</string>',
        );
        expect(runtimeDir('/data')).toBe(join('/data', 'runtime'));
        expect(runtimeDir('/data', 4790)).toBe(join('/data', 'runtime-4790'));
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
            isPackageInstall('/Users/me/.npm/_npx/abc123/node_modules/fixhere/dist/cli.mjs'),
        ).toBe(true);
        expect(isPackageInstall(command.cli)).toBe(true);
        expect(isPackageInstall('C:\\work\\app\\node_modules\\fixhere\\dist\\cli.mjs')).toBe(true);
        expect(isPackageInstall('/Users/me/Code/fixhere/packages/fixhere/dist/cli.mjs')).toBe(
            false,
        );
    });

    it('installs that copy into the data folder with npm', () => {
        expect(runtimeInstallArgs('/Users/me/.config/fixhere', 'fixhere@0.1.2')).toEqual([
            'install',
            '--prefix',
            join('/Users/me/.config/fixhere', 'runtime'),
            'fixhere@0.1.2',
            '--no-audit',
            '--no-fund',
            '--loglevel=error',
        ]);
        expect(runtimeCli('/Users/me/.config/fixhere')).toBe(
            join(
                '/Users/me/.config/fixhere',
                'runtime',
                'node_modules',
                'fixhere',
                'dist',
                'cli.mjs',
            ),
        );
    });
});
