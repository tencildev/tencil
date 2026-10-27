import { createInterface } from 'node:readline/promises';
import pc from 'picocolors';
import {
    detectAgents,
    PROVIDERS,
    type ProviderName,
    providerLabel,
    savedProvider,
    saveProvider,
} from '../daemon/agents.ts';

/**
 * The agent pins go to on this machine. Asked once: kept from an earlier run
 * or `--provider`, taken without asking when only one agent is installed, and
 * otherwise picked by the user. With nobody to ask it's T3 Code for now, not
 * saved, so the daemon keeps looking for what gets installed later.
 */
export async function chooseProvider(options: {
    yes?: boolean;
    t3Url?: string;
    log: (message: string) => void;
}): Promise<ProviderName> {
    const saved = await savedProvider();
    if (saved) return saved;

    const found = await detectAgents({ t3Url: options.t3Url });
    const installed = PROVIDERS.filter(id => found[id]);
    const hint = () =>
        options.log(
            pc.dim("    Each project can switch agents in the overlay's settings (the gear)."),
        );

    if (installed.length === 1) {
        const provider = installed[0]!;
        await saveProvider(provider);
        options.log(
            `  ${pc.green('✓')} Pins go to ${providerLabel(provider)}, found on this machine.`,
        );
        hint();
        return provider;
    }
    if (options.yes || !process.stdin.isTTY) return 't3code';

    const provider = await ask(installed, options.log);
    await saveProvider(provider);
    options.log(`  ${pc.green('✓')} Pins go to ${providerLabel(provider)}.`);
    hint();
    return provider;
}

async function ask(
    installed: ProviderName[],
    log: (message: string) => void,
): Promise<ProviderName> {
    log(
        installed.length === 0
            ? `  None of ${listOf(PROVIDERS)} was found. Which one will you use?`
            : `  ${listOf(installed)} are here. Which agent should pins go to?`,
    );
    PROVIDERS.forEach((id, index) => {
        log(`    ${pc.cyan(String(index + 1))}  ${providerLabel(id)}`);
    });
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`  Choose ${pc.dim('(1)')} `);
    rl.close();
    const index = Number.parseInt(answer.trim(), 10) - 1;
    return PROVIDERS[index] ?? PROVIDERS[0];
}

function listOf(ids: readonly ProviderName[]): string {
    const labels = ids.map(providerLabel);
    return labels.length > 1
        ? `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`
        : (labels[0] ?? '');
}
