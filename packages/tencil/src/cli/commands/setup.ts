import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import pc from 'picocolors';
import { probeDaemon } from '../../daemon/server.ts';
import { defaultDataDir } from '../../daemon/thread-store.ts';
import { planInit } from '../../init/run-init.ts';
import { enableAutostart } from '../../service/autostart.ts';
import { startInBackground } from '../../service/background.ts';
import { chooseProvider } from '../../service/choose-provider.ts';
import type { DaemonCommand } from '../../service/daemon-command.ts';
import { isServiceInstalled, uninstallService } from '../../service/login-service.ts';
import { prepareProvider } from '../../service/pairing.ts';
import { isNewerThanThis, updateNotice } from '../../service/versions.ts';
import { VERSION } from '../../version.ts';
import { newerDaemonLine, printUpdateNotice } from '../format.ts';

export interface SetupOptions {
    /** Accept the defaults without asking. */
    yes?: boolean;
    /** Package spec for the login service's copy (a local tarball) instead of npm. */
    from?: string;
    t3Url?: string;
    /** The folder setup runs in, to say what's next for that project. */
    root?: string;
}

/** `tencil setup`: once per machine. Starts the daemon (at login, by default) and pairs. */
export async function setup(command: DaemonCommand, options: SetupOptions = {}): Promise<void> {
    const log = (message: string) => console.log(message);
    log(`\n  ${pc.bold('Tencil')} setup ${pc.dim(`v${VERSION}`)}\n`);
    const notice = updateNotice();
    const provider = await chooseProvider({ ...options, log });
    // Pair (or install Claude Code support) first, so the daemon starts ready.
    await prepareProvider(provider, options.t3Url, log);
    await setUpMachine(command, options, log);
    log(await nextSteps(options.root));
    await printUpdateNotice(notice, log);
}

/** What to do next, for the folder setup ran in. */
export async function nextSteps(root: string | undefined): Promise<string> {
    const plan =
        root && existsSync(join(root, 'package.json'))
            ? await planInit(root).catch(() => undefined)
            : undefined;
    const name = pc.bold(basename(root ?? ''));
    const devServer = `start its dev server and press ${pc.bold('C')} on the page.`;
    if (plan && plan.framework.kind !== 'unknown') {
        return plan.edits.length === 0 && plan.manual.length === 0
            ? `\n  ${pc.green('✓')} ${name} already loads Tencil: ${devServer}\n  To add Tencil to another project, run ${pc.cyan('npx tencil')} in its folder.\n`
            : `\n  Next, add Tencil to ${name}: ${pc.cyan('npx tencil')}\n  Then ${devServer}\n`;
    }
    return `\n  Next, in each project: ${pc.cyan('npx tencil')}\n  Then ${devServer}\n`;
}

/** Ask about starting at login (yes by default), then start the daemon that way. */
export async function setUpMachine(
    command: DaemonCommand,
    options: SetupOptions,
    log: (message: string) => void,
): Promise<void> {
    const dataDir = defaultDataDir();
    const running = await probeDaemon(command.port);
    if (running && isNewerThanThis(running.version)) {
        log(newerDaemonLine(running.version, command.port));
        return;
    }
    const autostart =
        options.yes || !process.stdin.isTTY
            ? true
            : await confirm('Start Tencil automatically when you log in?');

    if (autostart) {
        log(pc.dim('  Setting up the login service…'));
        try {
            const where = await enableAutostart(command, dataDir, options.from);
            log(
                `  ${pc.green('✓')} Tencil is running on port ${command.port} and starts when you log in ${pc.dim(`(${where})`)}`,
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
        `  ${pc.green('✓')} Tencil is running on port ${command.port}. After a restart, run ${pc.cyan('npx tencil start')}.`,
    );
}

export async function confirm(question: string): Promise<boolean> {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`  ${question} ${pc.dim('(Y/n)')} `);
    rl.close();
    return !/^n/i.test(answer.trim());
}
