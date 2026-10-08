import { join } from 'node:path';
import { loadAgentSdk } from '@fixhere/provider-claude-code';
import {
    CredentialStore,
    createLocalPairingCode,
    DEFAULT_T3_URL,
    exchangePairingCredential,
} from '@fixhere/provider-t3code';
import pc from 'picocolors';
import type { ProviderName } from '../daemon/agents.ts';
import { defaultDataDir } from '../daemon/thread-store.ts';

/** Get the agent ready now, so the first page load is ready to go. */
export async function prepareProvider(
    provider: ProviderName,
    t3Url: string | undefined,
    log: (message: string) => void,
): Promise<void> {
    if (provider === 'claude-code') return prepareClaudeCode(log);
    return pairWithLocalT3(t3Url, log);
}

/** Pair with the local T3 Code. */
async function pairWithLocalT3(
    t3Url: string | undefined,
    log: (message: string) => void,
): Promise<void> {
    const store = new CredentialStore();
    const baseUrl = t3Url ?? (await store.lastBaseUrl()) ?? DEFAULT_T3_URL;
    if (await store.get(baseUrl)) return log(`  ${pc.green('✓')} Paired with T3 Code.`);
    const code = await createLocalPairingCode(baseUrl).catch(() => undefined);
    if (!code) {
        log(
            `  ${pc.yellow('!')} T3 Code isn't running, so pairing is skipped. Fixhere pairs on its own once it is.`,
        );
        return;
    }
    try {
        await store.set(baseUrl, await exchangePairingCredential({ baseUrl, credential: code }));
        log(`  ${pc.green('✓')} Paired with T3 Code at ${baseUrl}`);
    } catch (error) {
        log(`  ${pc.yellow('!')} ${error instanceof Error ? error.message : String(error)}`);
    }
}

/** Install the Claude Agent SDK the daemon runs Claude Code with, if Fixhere has none yet. */
async function prepareClaudeCode(log: (message: string) => void): Promise<void> {
    try {
        await loadAgentSdk({
            installDir: join(defaultDataDir(), 'claude-code'),
            onInstall: () => log(pc.dim('  Installing Claude Code support (one time)…')),
        });
        log(`  ${pc.green('✓')} Claude Code is ready. Pins run in your Claude Code login.`);
    } catch (error) {
        log(`  ${pc.yellow('!')} ${error instanceof Error ? error.message : String(error)}`);
    }
}
