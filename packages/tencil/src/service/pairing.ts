import { join } from 'node:path';
import { type AcpAgent, checkAgent } from '@tencildev/provider-acp';
import { loadAgentSdk } from '@tencildev/provider-claude-code';
import { codexProblem } from '@tencildev/provider-codex';
import { EnsembleClient, EnsembleCredentialStore } from '@tencildev/provider-ensemble';
import {
    CredentialStore,
    createLocalPairingCode,
    DEFAULT_T3_URL,
    exchangePairingCredential,
} from '@tencildev/provider-t3code';
import pc from 'picocolors';
import { acpAgents, type ProviderName } from '../daemon/agents.ts';
import { defaultDataDir } from '../daemon/thread-store.ts';

/** Get the agent ready now, so the first page load is ready to go. */
export async function prepareProvider(
    provider: ProviderName,
    t3Url: string | undefined,
    log: (message: string) => void,
): Promise<void> {
    if (provider === 'claude-code') return prepareClaudeCode(log);
    if (provider === 'codex') return checkCodex(log);
    if (provider === 'ensemble') return checkEnsemble(log);
    const agent = (await acpAgents()).find(candidate => candidate.id === provider);
    if (agent) return checkAcpAgent(agent, log);
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
        const running = await fetch(new URL('/.well-known/t3/environment', baseUrl), {
            signal: AbortSignal.timeout(3_000),
        }).then(
            response => response.ok,
            () => false,
        );
        log(
            running
                ? `  ${pc.yellow('!')} Couldn't pair with T3 Code automatically. Press Pair in the overlay, or run ${pc.cyan('npx tencil connect')} with a pairing link from T3 Code.`
                : `  ${pc.yellow('!')} T3 Code isn't running, so pairing is skipped. Tencil pairs on its own once it is.`,
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

/** Install the Claude Agent SDK the daemon runs Claude Code with, if Tencil has none yet. */
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

/** Pins run from the user's own Codex install and login, so say what's missing, don't install it. */
async function checkCodex(log: (message: string) => void): Promise<void> {
    const problem = await codexProblem();
    log(
        problem
            ? `  ${pc.yellow('!')} ${problem.replace(/`([^`]+)`/g, (_, command) => pc.cyan(command))}`
            : `  ${pc.green('✓')} Codex is ready. Pins run in your Codex login.`,
    );
}

/**
 * An ACP agent runs from the user's own install and login: start it once to
 * see it answers. Whether it's signed in only shows on the first pin.
 */
async function checkAcpAgent(agent: AcpAgent, log: (message: string) => void): Promise<void> {
    const { problem, about } = await checkAgent(agent);
    const command = (text: string) => text.replace(/`([^`]+)`/g, (_, part) => pc.cyan(part));
    if (problem) return log(`  ${pc.yellow('!')} ${command(problem)}`);
    log(
        `  ${pc.green('✓')} ${agent.label} is ready${about ? pc.dim(` (${about})`) : ''}. Pins run in your ${agent.label} login.`,
    );
    if (agent.login) log(pc.dim(`    Not signed in yet? ${agent.login}`));
}

/** Ask the user once to allow Tencil in Ensemble, unless Tencil's token still works. */
async function checkEnsemble(log: (message: string) => void): Promise<void> {
    const client = new EnsembleClient();
    if (!(await client.isRunning())) {
        log(
            `  ${pc.yellow('!')} Ensemble isn't running. Open the Ensemble app, then press Pair in the overlay.`,
        );
        return;
    }
    const credentials = new EnsembleCredentialStore();
    const token = await credentials.get(client.baseUrl);
    const allowed =
        token !== undefined &&
        (await new EnsembleClient({ baseUrl: client.baseUrl, token }).threads().then(
            () => true,
            () => false,
        ));
    try {
        if (!allowed) {
            log('  Allow Tencil in the Ensemble app (one time)…');
            await credentials.set(client.baseUrl, await client.connect());
        }
        log(
            `  ${pc.green('✓')} Connected to Ensemble. Pins go to the Ensemble thread serving each page.`,
        );
    } catch (error) {
        log(`  ${pc.yellow('!')} ${error instanceof Error ? error.message : String(error)}`);
    }
}
