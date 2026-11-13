import { createInterface } from 'node:readline/promises';
import pc from 'picocolors';
import {
    acpAgents,
    detectAgents,
    type MachineAcpAgent,
    type ProviderName,
    providerLabel,
    providerOptions,
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

    const [found, agents] = await Promise.all([
        detectAgents({ t3Url: options.t3Url }),
        acpAgents(),
    ]);
    const installed = Object.keys(found).filter(id => found[id]);
    const label = (id: ProviderName) => providerLabel(id, agents);
    const hint = () =>
        options.log(
            pc.dim("    Each project can switch agents in the overlay's settings (the gear)."),
        );

    if (installed.length === 1) {
        const provider = installed[0]!;
        await saveProvider(provider);
        options.log(`  ${pc.green('✓')} Pins go to ${label(provider)}, found on this machine.`);
        hint();
        return provider;
    }
    if (options.yes || !process.stdin.isTTY) return 't3code';

    const provider = await ask(installed, agents, options.log);
    await saveProvider(provider);
    options.log(`  ${pc.green('✓')} Pins go to ${label(provider)}.`);
    hint();
    return provider;
}

/** The built-in agents, installed or not, and the ACP agents this machine has. */
async function ask(
    installed: ProviderName[],
    agents: MachineAcpAgent[],
    log: (message: string) => void,
): Promise<ProviderName> {
    const choices = providerOptions(agents);
    const listOf = (labels: string[]) =>
        labels.length > 1
            ? `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`
            : (labels[0] ?? '');
    log(
        installed.length === 0
            ? `  None of ${listOf(choices.map(choice => choice.label))} was found. Which one will you use?`
            : `  ${listOf(installed.map(id => providerLabel(id, agents)))} are here. Which agent should pins go to?`,
    );
    choices.forEach((choice, index) => {
        log(`    ${pc.cyan(String(index + 1))}  ${choice.label}`);
    });
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`  Choose ${pc.dim('(1)')} `);
    rl.close();
    const index = Number.parseInt(answer.trim(), 10) - 1;
    return (choices[index] ?? choices[0])!.id;
}
