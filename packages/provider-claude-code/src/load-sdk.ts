import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

export type AgentSdk = Pick<
    typeof import('@anthropic-ai/claude-agent-sdk'),
    'query' | 'listSessions' | 'getSessionMessages' | 'getSessionInfo'
>;

const PACKAGE = '@anthropic-ai/claude-agent-sdk';
/** The range this provider is written against; installs stay inside it. */
export const SDK_RANGE = '^0.3.293';

const run = promisify(execFile);

/**
 * The Agent SDK ships Claude Code itself (a ~250 MB binary), so `fixhere`
 * doesn't depend on it. Use a copy next to Fixhere when there is one,
 * otherwise install it once into `installDir`.
 */
export async function loadAgentSdk(options: {
    installDir: string;
    onInstall?: () => void;
}): Promise<AgentSdk> {
    try {
        return await import(PACKAGE);
    } catch {}
    const entry = join(options.installDir, 'node_modules', ...PACKAGE.split('/'), 'sdk.mjs');
    if (!existsSync(entry)) {
        options.onInstall?.();
        await installAgentSdk(options.installDir);
    }
    return import(pathToFileURL(entry).href);
}

export async function installAgentSdk(installDir: string): Promise<void> {
    await mkdir(installDir, { recursive: true });
    const manifest = join(installDir, 'package.json');
    if (!existsSync(manifest)) {
        await writeFile(manifest, `${JSON.stringify({ private: true }, null, 4)}\n`);
    }
    try {
        await run(
            'npm',
            ['install', `${PACKAGE}@${SDK_RANGE}`, '--no-audit', '--no-fund', '--loglevel=error'],
            // npm is a .cmd shim on Windows.
            { cwd: installDir, shell: process.platform === 'win32', timeout: 10 * 60_000 },
        );
    } catch (error) {
        const stderr = (error as { stderr?: string }).stderr?.trim();
        throw new Error(
            `Couldn't install Claude Code support (${PACKAGE})${stderr ? `: ${stderr.split('\n').at(-1)}` : ''}`,
        );
    }
}
