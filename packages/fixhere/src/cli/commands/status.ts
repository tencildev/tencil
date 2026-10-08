import pc from 'picocolors';
import { probeDaemon } from '../../daemon/server.ts';

export async function status(port: number): Promise<void> {
    const health = await probeDaemon(port);
    if (!health) {
        console.log(
            `\n  The Fixhere daemon isn't running. Start it with ${pc.cyan('npx fixhere start')}.\n`,
        );
        process.exitCode = 1;
        return;
    }
    console.log(
        `\n  ${pc.green('●')} Fixhere v${health.version} on port ${port} ${pc.dim(`(pid ${health.pid})`)}`,
    );
    if (health.projects.length === 0)
        console.log(pc.dim('  No projects yet; open a dev page with the overlay.'));
    for (const project of health.projects) {
        const state =
            project.provider.state === 'ready'
                ? pc.green('ready')
                : pc.yellow(project.provider.state);
        console.log(
            `  ${pc.bold(project.name)} ${pc.dim(project.root)}  ${project.provider.label}: ${state}  ${pc.dim(`${project.clients} page(s)`)}`,
        );
    }
    console.log('');
}
