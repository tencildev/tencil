import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_PORT } from '../daemon/server.ts';
import { stopDaemon } from './background.ts';
import { type DaemonCommand, daemonArgs } from './daemon-command.ts';

const LABEL = 'dev.fixhere.daemon';

export function launchdPlist(command: DaemonCommand, logPath: string): string {
    const args = [command.node, ...daemonArgs(command)]
        .map(arg => `    <string>${escapeXml(arg)}</string>`)
        .join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(logPath)}</string>
</dict>
</plist>
`;
}

export function systemdUnit(command: DaemonCommand): string {
    return `[Unit]
Description=Fixhere daemon

[Service]
ExecStart=${[command.node, ...daemonArgs(command)].map(arg => `"${arg}"`).join(' ')}
Restart=on-failure

[Install]
WantedBy=default.target
`;
}

export function windowsTaskCommand(command: DaemonCommand): string {
    return [command.node, ...daemonArgs(command)].map(arg => `"${arg}"`).join(' ');
}

const launchAgent = () => join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const systemdUnitPath = () => join(homedir(), '.config', 'systemd', 'user', 'fixhere.service');
const launchdDomain = () => `gui/${process.getuid?.() ?? 501}`;

/** Whether Fixhere is set up to start at login, serving `port`. */
export function isServiceInstalled(port = DEFAULT_PORT): boolean {
    return servicePort(serviceDefinition()) === port;
}

/** The daemon port in a launchd plist, systemd unit or scheduled task definition. */
export function servicePort(definition: string | undefined): number | undefined {
    const match = definition?.match(/--port(?:<\/string>\s*<string>|"?\s+"?|&quot;\s*&quot;)(\d+)/);
    return match?.[1] ? Number(match[1]) : undefined;
}

function serviceDefinition(): string | undefined {
    try {
        switch (process.platform) {
            case 'darwin':
                return readFileSync(launchAgent(), 'utf8');
            case 'linux':
                return readFileSync(systemdUnitPath(), 'utf8');
            case 'win32':
                return execFileSync('schtasks', ['/Query', '/TN', 'Fixhere', '/XML'], {
                    encoding: 'utf8',
                    stdio: ['ignore', 'pipe', 'ignore'],
                });
            default:
                return undefined;
        }
    } catch {
        return undefined;
    }
}

/** Install (or replace) the login service and start the daemon through it. */
export async function installService(command: DaemonCommand, dataDir: string): Promise<string> {
    const logPath = join(dataDir, 'daemon.log');
    mkdirSync(dataDir, { recursive: true });

    // Stop the old service first (launchd would restart its daemon), then any
    // daemon started by hand, so the new one gets the port.
    switch (process.platform) {
        case 'darwin': {
            const plist = launchAgent();
            quietly('launchctl', ['bootout', launchdDomain(), plist]);
            await stopDaemon(command.port);
            mkdirSync(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true });
            writeFileSync(plist, launchdPlist(command, logPath));
            execFileSync('launchctl', ['bootstrap', launchdDomain(), plist]);
            return plist;
        }
        case 'linux': {
            const unit = systemdUnitPath();
            quietly('systemctl', ['--user', 'stop', 'fixhere.service']);
            await stopDaemon(command.port);
            mkdirSync(join(homedir(), '.config', 'systemd', 'user'), { recursive: true });
            writeFileSync(unit, systemdUnit(command));
            execFileSync('systemctl', ['--user', 'daemon-reload']);
            // Keep systemd's "Created symlink…" out of the output; errors still throw.
            execFileSync('systemctl', ['--user', 'enable', '--now', 'fixhere.service'], {
                stdio: ['ignore', 'ignore', 'pipe'],
            });
            return unit;
        }
        case 'win32':
            quietly('schtasks', ['/End', '/TN', 'Fixhere']);
            await stopDaemon(command.port);
            execFileSync('schtasks', [
                '/Create',
                '/F',
                '/SC',
                'ONLOGON',
                '/TN',
                'Fixhere',
                '/TR',
                windowsTaskCommand(command),
            ]);
            execFileSync('schtasks', ['/Run', '/TN', 'Fixhere']);
            return 'Task Scheduler: Fixhere';
        default:
            throw new Error(
                `Login service isn't supported on ${process.platform}; use \`fixhere start\`.`,
            );
    }
}

/** Stop the service's daemon until the next login, without uninstalling it. */
export async function stopService(port = DEFAULT_PORT): Promise<void> {
    switch (process.platform) {
        case 'darwin':
            quietly('launchctl', ['bootout', launchdDomain(), launchAgent()]);
            break;
        case 'linux':
            quietly('systemctl', ['--user', 'stop', 'fixhere.service']);
            break;
        case 'win32':
            quietly('schtasks', ['/End', '/TN', 'Fixhere']);
            break;
    }
    await stopDaemon(port);
}

export async function uninstallService(port = DEFAULT_PORT): Promise<void> {
    switch (process.platform) {
        case 'darwin':
            quietly('launchctl', ['bootout', launchdDomain(), launchAgent()]);
            rmSync(launchAgent(), { force: true });
            break;
        case 'linux':
            quietly('systemctl', ['--user', 'disable', '--now', 'fixhere.service']);
            rmSync(systemdUnitPath(), { force: true });
            quietly('systemctl', ['--user', 'daemon-reload']);
            break;
        case 'win32':
            quietly('schtasks', ['/End', '/TN', 'Fixhere']);
            quietly('schtasks', ['/Delete', '/F', '/TN', 'Fixhere']);
            break;
    }
    await stopDaemon(port);
}

/** Run a command whose failure only means "nothing to do" (not loaded, already gone). */
function quietly(command: string, args: string[]): void {
    try {
        execFileSync(command, args, { stdio: 'ignore' });
    } catch {
        // Nothing to stop or remove.
    }
}

function escapeXml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
