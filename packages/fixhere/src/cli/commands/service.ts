import pc from 'picocolors';
import { defaultDataDir } from '../../daemon/thread-store.ts';
import type { DaemonCommand } from '../../service/daemon-command.ts';
import {
    installService,
    isEphemeralInstall,
    uninstallService,
} from '../../service/login-service.ts';

export async function service(action: string | undefined, command: DaemonCommand): Promise<void> {
    if (action === 'install') {
        if (isEphemeralInstall(command.cli)) {
            throw new Error(
                "Install Fixhere globally first (npm i -g fixhere), then run `fixhere service install`: npx's cache can be cleaned up under a login service.",
            );
        }
        const where = await installService(command, defaultDataDir());
        console.log(
            `\n  ${pc.green('✓')} Fixhere now starts when you log in ${pc.dim(`(${where})`)}\n`,
        );
        return;
    }
    if (action === 'uninstall') {
        await uninstallService(command.port);
        console.log(`\n  ${pc.green('✓')} Removed the login service.\n`);
        return;
    }
    throw new Error('Use `fixhere service install` or `fixhere service uninstall`.');
}
