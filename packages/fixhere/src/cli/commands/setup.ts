import { createInterface } from 'node:readline/promises';
import pc from 'picocolors';
import { defaultDataDir } from '../../daemon/thread-store.ts';
import { enableAutostart } from '../../service/autostart.ts';
import { startInBackground } from '../../service/background.ts';
import type { DaemonCommand } from '../../service/daemon-command.ts';
import { isServiceInstalled, uninstallService } from '../../service/login-service.ts';
import { pairWithLocalT3 } from '../../service/pairing.ts';
import { VERSION } from '../../version.ts';

export interface SetupOptions {
    /** Accept the defaults without asking. */
    yes?: boolean;
    /** Package spec for the login service's copy (a local tarball) instead of npm. */
    from?: string;
    t3Url?: string;
}

/** `fixhere setup`: once per machine. Starts the daemon (at login, by default) and pairs. */
export async function setup(command: DaemonCommand, options: SetupOptions = {}): Promise<void> {
    const log = (message: string) => console.log(message);
    log(`\n  ${pc.bold('Fixhere')} setup ${pc.dim(`v${VERSION}`)}\n`);
    await setUpMachine(command, options, log);
    await pairWithLocalT3(options.t3Url, log);
    log(`
  Next, in each project: ${pc.cyan('npx fixhere')}
  Then start its dev server and press ${pc.bold('C')} on the page.
`);
}

/** Ask about starting at login (yes by default), then start the daemon that way. */
export async function setUpMachine(
    command: DaemonCommand,
    options: SetupOptions,
    log: (message: string) => void,
): Promise<void> {
    const dataDir = defaultDataDir();
    const autostart =
        options.yes || !process.stdin.isTTY
            ? true
            : await confirm('Start Fixhere automatically when you log in?');

    if (autostart) {
        log(pc.dim('  Setting up the login service…'));
        try {
            const where = await enableAutostart(command, dataDir, options.from);
            log(
                `  ${pc.green('✓')} Fixhere is running on port ${command.port} and starts when you log in ${pc.dim(`(${where})`)}`,
            );
            return;
        } catch (error) {
            log(`  ${pc.yellow('!')} ${error instanceof Error ? error.message : String(error)}`);
        }
    } else if (isServiceInstalled(command.port)) {
        await uninstallService(command.port);
    }
    await startInBackground(command, dataDir);
    log(
        `  ${pc.green('✓')} Fixhere is running on port ${command.port}. After a restart, run ${pc.cyan('npx fixhere start')}.`,
    );
}

export async function confirm(question: string): Promise<boolean> {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`  ${question} ${pc.dim('(Y/n)')} `);
    rl.close();
    return !/^n/i.test(answer.trim());
}
