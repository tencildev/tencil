import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import pc from 'picocolors';
import { probeDaemon } from '../../daemon/server.ts';
import { defaultDataDir } from '../../daemon/thread-store.ts';
import { detectFramework, findApps } from '../../init/detect-framework.ts';
import { runInit } from '../../init/run-init.ts';
import { ensureDaemon } from '../../service/autostart.ts';
import { chooseProvider } from '../../service/choose-provider.ts';
import type { DaemonCommand } from '../../service/daemon-command.ts';
import { isServiceInstalled } from '../../service/login-service.ts';
import { prepareProvider } from '../../service/pairing.ts';
import { VERSION } from '../../version.ts';
import { type SetupOptions, setUpMachine } from './setup.ts';

export interface QuickstartOptions extends SetupOptions {
    root: string;
}

/**
 * `npx tencil`: set up this machine if it isn't yet, then add Tencil to the
 * project in the current folder when there is one.
 */
export async function quickstart(
    command: DaemonCommand,
    options: QuickstartOptions,
): Promise<void> {
    const log = (message: string) => console.log(message);
    log(`\n  ${pc.bold('Tencil')} ${pc.dim(`v${VERSION}`)}\n`);

    const provider = await chooseProvider({ ...options, log });
    // Pair (or install Claude Code support) first, so the daemon starts ready.
    await prepareProvider(provider, options.t3Url, log);
    const running = await probeDaemon(command.port);
    if (!running && !isServiceInstalled(command.port)) {
        await setUpMachine(command, options, log);
    } else {
        const result = await ensureDaemon(command, defaultDataDir());
        const verb = result.status === 'running' ? 'is running' : result.status;
        log(
            `  ${pc.green('✓')} Tencil ${verb} on port ${command.port}${result.autostart ? pc.dim(' (starts at login)') : ''}`,
        );
    }

    const framework = await detectFramework(options.root);
    if (framework.kind !== 'unknown' || existsSync(join(options.root, 'package.json'))) {
        const apps = framework.kind === 'unknown' ? await findApps(options.root) : [];
        if (apps.length === 0) {
            return runInit({
                root: options.root,
                yes: options.yes,
                from: options.from,
                port: command.port,
                skipPair: true,
            });
        }
        log(
            `\n  This looks like a monorepo. Run ${pc.cyan('npx tencil')} in the app to add it to:`,
        );
        for (const app of apps)
            log(`    ${pc.bold(relative(options.root, app.dir))} ${pc.dim(app.label)}`);
        log('');
        return;
    }
    log(`
  To add Tencil to a project, run ${pc.cyan('npx tencil')} in its folder (Next.js or Vite).
  Then start its dev server and press ${pc.bold('C')} on the page.
`);
}
