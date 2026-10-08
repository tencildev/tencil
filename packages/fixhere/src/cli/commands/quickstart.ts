import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import pc from 'picocolors';
import { probeDaemon } from '../../daemon/server.ts';
import { defaultDataDir } from '../../daemon/thread-store.ts';
import { detectFramework, findApps } from '../../init/detect-framework.ts';
import { runInit } from '../../init/run-init.ts';
import { ensureDaemon } from '../../service/autostart.ts';
import type { DaemonCommand } from '../../service/daemon-command.ts';
import { isServiceInstalled } from '../../service/login-service.ts';
import { pairWithLocalT3 } from '../../service/pairing.ts';
import { VERSION } from '../../version.ts';
import { type SetupOptions, setUpMachine } from './setup.ts';

export interface QuickstartOptions extends SetupOptions {
    root: string;
}

/**
 * `npx fixhere`: set up this machine if it isn't yet, then add Fixhere to the
 * project in the current folder when there is one.
 */
export async function quickstart(
    command: DaemonCommand,
    options: QuickstartOptions,
): Promise<void> {
    const log = (message: string) => console.log(message);
    log(`\n  ${pc.bold('Fixhere')} ${pc.dim(`v${VERSION}`)}\n`);

    const running = await probeDaemon(command.port);
    if (!running && !isServiceInstalled(command.port)) {
        await setUpMachine(command, options, log);
    } else {
        const result = await ensureDaemon(command, defaultDataDir());
        const verb = result.status === 'running' ? 'is running' : result.status;
        log(
            `  ${pc.green('✓')} Fixhere ${verb} on port ${command.port}${result.autostart ? pc.dim(' (starts at login)') : ''}`,
        );
    }
    await pairWithLocalT3(options.t3Url, log);

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
            `\n  This looks like a monorepo. Run ${pc.cyan('npx fixhere')} in the app to add it to:`,
        );
        for (const app of apps)
            log(`    ${pc.bold(relative(options.root, app.dir))} ${pc.dim(app.label)}`);
        log('');
        return;
    }
    log(`
  To add Fixhere to a project, run ${pc.cyan('npx fixhere')} in its folder (Next.js or Vite).
  Then start its dev server and press ${pc.bold('C')} on the page.
`);
}
