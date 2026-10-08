import { rmSync } from 'node:fs';
import pc from 'picocolors';
import { defaultDataDir } from '../../daemon/thread-store.ts';
import { enableAutostart, runtimeDir } from '../../service/autostart.ts';
import type { DaemonCommand } from '../../service/daemon-command.ts';
import { uninstallService } from '../../service/login-service.ts';

export async function service(
    action: string | undefined,
    command: DaemonCommand,
    from?: string,
): Promise<void> {
    if (action === 'install') {
        const where = await enableAutostart(command, defaultDataDir(), from);
        console.log(
            `\n  ${pc.green('✓')} Tencil now starts when you log in ${pc.dim(`(${where})`)}\n`,
        );
        return;
    }
    if (action === 'uninstall') {
        await uninstallService(command.port);
        rmSync(runtimeDir(defaultDataDir(), command.port), { recursive: true, force: true });
        console.log(`\n  ${pc.green('✓')} Removed the login service.\n`);
        return;
    }
    throw new Error('Use `tencil service install` or `tencil service uninstall`.');
}
