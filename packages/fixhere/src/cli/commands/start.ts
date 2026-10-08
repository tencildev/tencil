import pc from 'picocolors';
import { defaultDataDir } from '../../daemon/thread-store.ts';
import { startInBackground } from '../../service/background.ts';
import type { DaemonCommand } from '../../service/daemon-command.ts';
import { VERSION } from '../../version.ts';

export async function start(command: DaemonCommand): Promise<void> {
    const result = await startInBackground(command, defaultDataDir());
    const verb =
        result.status === 'running'
            ? 'is running'
            : result.status === 'restarted'
              ? 'restarted'
              : 'started';
    console.log(`
  ${pc.green('●')} ${pc.bold('Fixhere')} ${verb} ${pc.dim(`(v${VERSION}, port ${command.port})`)}

  Open a project's dev server and press ${pc.bold('C')} on the page. Projects need the
  overlay loaded once: run ${pc.cyan('npx fixhere init')} in the project.
  ${pc.dim(`Start it automatically at login: ${pc.cyan('npx fixhere service install')}`)}
`);
}
