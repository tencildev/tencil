import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import type { ProviderOption } from '@tencildev/protocol';
import { ACP_PRESETS, type AcpAgent, isInstalled } from '@tencildev/provider-acp';
import { findCodex } from '@tencildev/provider-codex';
import { EnsembleClient } from '@tencildev/provider-ensemble';
import { CredentialStore, DEFAULT_T3_URL } from '@tencildev/provider-t3code';
import { z } from 'zod';
import { defaultDataDir } from './thread-store.ts';

/** The agents Tencil has a provider of its own for. */
export const BUILT_IN_PROVIDERS = ['t3code', 'claude-code', 'codex', 'ensemble'] as const;
type BuiltInProvider = (typeof BUILT_IN_PROVIDERS)[number];
/** A built-in agent, or an ACP agent by its id: a preset like `devin`, or one from settings.json. */
export type ProviderName = BuiltInProvider | (string & {});

const BUILT_IN_OPTIONS: ProviderOption[] = [
    { id: 't3code', label: 'T3 Code' },
    { id: 'claude-code', label: 'Claude Code' },
    { id: 'codex', label: 'Codex' },
    { id: 'ensemble', label: 'Ensemble' },
];

/** An ACP agent as this machine has it. */
export interface MachineAcpAgent extends AcpAgent {
    /** Its program is on the PATH, or where its command says. */
    installed: boolean;
    /** settings.json adds it or changes its command. */
    configured: boolean;
}

const AGENT_ID = /^[a-z0-9][a-z0-9-]*$/;

const SettingsFile = z.object({
    version: z.literal(1),
    /** The agent of projects that haven't picked one in the overlay. */
    provider: z.string().optional(),
    /**
     * ACP agents by id: a preset's command changed (`devin acp --model opus`),
     * or an agent of the user's own, with a label.
     */
    acp: z
        .record(z.string(), z.object({ label: z.string().optional(), command: z.string().min(1) }))
        .optional(),
});
type SettingsFile = z.infer<typeof SettingsFile>;

const settingsPath = (dataDir: string) => join(dataDir, 'settings.json');

async function readSettings(dataDir: string): Promise<SettingsFile | undefined> {
    const raw = await readFile(settingsPath(dataDir), 'utf8').catch(() => undefined);
    if (raw === undefined) return undefined;
    try {
        const parsed = SettingsFile.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data : undefined;
    } catch {
        return undefined;
    }
}

/**
 * The ACP agents Tencil knows: its presets, with the commands settings.json
 * gives them, then the agents settings.json adds.
 */
export async function acpAgents(dataDir = defaultDataDir()): Promise<MachineAcpAgent[]> {
    const configured = (await readSettings(dataDir))?.acp ?? {};
    const presets = ACP_PRESETS.map(preset => {
        const own = configured[preset.id];
        return { ...preset, ...own, label: own?.label ?? preset.label, configured: !!own };
    });
    const added = Object.entries(configured)
        .filter(([id]) => AGENT_ID.test(id) && !isBuiltIn(id))
        .filter(([id]) => !ACP_PRESETS.some(preset => preset.id === id))
        .map(([id, own]) => ({
            id,
            label: own.label ?? id,
            command: own.command,
            configured: true,
        }));
    return [...presets, ...added].map(agent => ({ ...agent, installed: isInstalled(agent) }));
}

/**
 * What a project can send pins to: the built-in agents, and the ACP agents this
 * machine has or settings.json names. `include` adds one, e.g. the machine's
 * choice, even when it isn't installed (yet).
 */
export function providerOptions(agents: MachineAcpAgent[], include?: string): ProviderOption[] {
    return [
        ...BUILT_IN_OPTIONS,
        ...agents
            .filter(agent => agent.installed || agent.configured || agent.id === include)
            .map(({ id, label }) => ({ id, label })),
    ];
}

/** Every id `--provider` takes. */
export function knownProviders(agents: MachineAcpAgent[]): string[] {
    return [...BUILT_IN_PROVIDERS, ...agents.map(agent => agent.id)];
}

export function providerLabel(id: ProviderName, agents: MachineAcpAgent[] = []): string {
    return (
        BUILT_IN_OPTIONS.find(option => option.id === id)?.label ??
        agents.find(agent => agent.id === id)?.label ??
        id
    );
}

function isBuiltIn(id: string): id is BuiltInProvider {
    return (BUILT_IN_PROVIDERS as readonly string[]).includes(id);
}

/** The agent chosen for this machine (by setup or `--provider`), if any. */
export async function savedProvider(dataDir = defaultDataDir()): Promise<ProviderName | undefined> {
    const provider = (await readSettings(dataDir))?.provider;
    if (!provider) return undefined;
    return knownProviders(await acpAgents(dataDir)).includes(provider) ? provider : undefined;
}

/** Saves the machine's agent, keeping the rest of settings.json. */
export async function saveProvider(provider: ProviderName, dataDir = defaultDataDir()) {
    const path = settingsPath(dataDir);
    const current = await readFile(path, 'utf8')
        .then(raw => JSON.parse(raw) as unknown)
        .catch(() => undefined);
    const rest = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
        `${path}.tmp`,
        `${JSON.stringify({ ...rest, version: 1, provider }, null, 2)}\n`,
    );
    await rename(`${path}.tmp`, path);
}

/**
 * Which agents this machine has: a paired or running T3 Code, an installed
 * Claude Code, Codex's CLI or desktop app, a running Ensemble app, and the ACP
 * agents on the PATH.
 */
export async function detectAgents(
    options: { t3Url?: string; dataDir?: string } = {},
): Promise<Record<ProviderName, boolean>> {
    const [t3code, claudeCode, ensemble, agents] = await Promise.all([
        hasT3Code(options.t3Url),
        hasClaudeCode(),
        hasEnsemble(),
        acpAgents(options.dataDir),
    ]);
    return {
        t3code,
        'claude-code': claudeCode,
        codex: findCodex() !== undefined,
        ensemble,
        ...Object.fromEntries(agents.map(agent => [agent.id, agent.installed])),
    };
}

/**
 * The agent for projects that haven't picked one: the saved choice, else the
 * first agent found (T3 Code, Claude Code, Codex, Ensemble, then the ACP
 * agents), else T3 Code.
 */
export async function machineProvider(
    options: { dataDir?: string; t3Url?: string } = {},
): Promise<ProviderName> {
    const saved = await savedProvider(options.dataDir);
    if (saved) return saved;
    const found = await detectAgents(options);
    return Object.keys(found).find(id => found[id]) ?? 't3code';
}

async function hasT3Code(t3Url: string | undefined): Promise<boolean> {
    const store = new CredentialStore();
    const baseUrl = t3Url ?? (await store.lastBaseUrl()) ?? DEFAULT_T3_URL;
    if (await store.get(baseUrl)) return true;
    try {
        const response = await fetch(new URL('/.well-known/t3/environment', baseUrl), {
            signal: AbortSignal.timeout(800),
        });
        return response.ok;
    } catch {
        return false;
    }
}

/** Ensemble's app, running now; finding it needs no token. */
function hasEnsemble(): Promise<boolean> {
    return new EnsembleClient().isRunning();
}

/** `claude` on the PATH, or its config folder (login services get a bare PATH). */
async function hasClaudeCode(): Promise<boolean> {
    const names = process.platform === 'win32' ? ['claude.exe', 'claude.cmd'] : ['claude'];
    const candidates = [
        process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'),
        ...(process.env.PATH ?? '')
            .split(delimiter)
            .filter(Boolean)
            .flatMap(dir => names.map(name => join(dir, name))),
    ];
    const found = await Promise.all(
        candidates.map(path =>
            access(path).then(
                () => true,
                () => false,
            ),
        ),
    );
    return found.includes(true);
}
