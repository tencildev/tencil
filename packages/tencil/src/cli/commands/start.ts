import pc from 'picocolors';
import { defaultDataDir } from '../../daemon/thread-store.ts';
import { ensureDaemon } from '../../service/autostart.ts';
import type { DaemonCommand } from '../../service/daemon-command.ts';
import { VERSION } from '../../version.ts';

export async function start(command: DaemonCommand): Promise<void> {
    const result = await ensureDaemon(command, defaultDataDir());
    const verb = result.status === 'running' ? 'is running' : result.status;
    console.log(`
  ${pc.green('●')} ${pc.bold('Tencil')} ${verb} ${pc.dim(`(v${VERSION}, port ${command.port})`)}

  Open a project's dev server and press ${pc.bold('C')} on the page. Projects need the
  overlay loaded once: run ${pc.cyan('npx tencil')} in the project.${
      result.autostart
          ? ''
          : `\n  ${pc.dim(`Start it automatically at login: ${pc.cyan('npx tencil setup')}`)}`
  }
`);
}
