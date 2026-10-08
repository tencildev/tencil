import pc from 'picocolors';
import { VERSION } from '../version.ts';

export function time(): string {
    return new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}

/** When an older Tencil (a stale npx cache) finds a newer daemon running, it leaves it alone. */
export function newerDaemonLine(newer: string, port: number): string {
    return `  ${pc.yellow('!')} Tencil ${newer} is already running on port ${port}. This is ${VERSION}, which is older, so it's left alone: use ${pc.cyan('npx tencil@latest')}.`;
}

/** Print the update notice, if the registry answered in time. */
export async function printUpdateNotice(
    notice: Promise<string | undefined>,
    log: (message: string) => void,
): Promise<void> {
    const text = await notice;
    if (text) log(`  ${pc.cyan('↑')} ${text}\n`);
}
