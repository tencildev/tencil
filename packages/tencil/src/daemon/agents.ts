import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import type { ProviderOption } from '@tencildev/protocol';
import { EnsembleClient } from '@tencildev/provider-ensemble';
import { CredentialStore, DEFAULT_T3_URL } from '@tencildev/provider-t3code';
import { z } from 'zod';
import { defaultDataDir } from './thread-store.ts';

export const PROVIDERS = ['t3code', 'claude-code', 'ensemble'] as const;
export type ProviderName = (typeof PROVIDERS)[number];
export const PROVIDER_OPTIONS: ProviderOption[] = [
    { id: 't3code', label: 'T3 Code' },
    { id: 'claude-code', label: 'Claude Code' },
    { id: 'ensemble', label: 'Ensemble' },
];

export const providerLabel = (id: ProviderName) =>
    PROVIDER_OPTIONS.find(option => option.id === id)?.label ?? id;

const SettingsFile = z.object({
    version: z.literal(1),
    /** The agent of projects that haven't picked one in the overlay. */
    provider: z.enum(PROVIDERS).optional(),
});

const settingsPath = (dataDir: string) => join(dataDir, 'settings.json');

/** The agent chosen for this machine (by setup or `--provider`), if any. */
export async function savedProvider(dataDir = defaultDataDir()): Promise<ProviderName | undefined> {
    const raw = await readFile(settingsPath(dataDir), 'utf8').catch(() => undefined);
    if (raw === undefined) return undefined;
    try {
        const parsed = SettingsFile.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data.provider : undefined;
    } catch {
        return undefined;
    }
}

export async function saveProvider(provider: ProviderName, dataDir = defaultDataDir()) {
    const path = settingsPath(dataDir);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(`${path}.tmp`, `${JSON.stringify({ version: 1, provider }, null, 2)}\n`);
    await rename(`${path}.tmp`, path);
}

/**
 * Which agents this machine has: a paired or running T3 Code, an installed
 * Claude Code, a running Ensemble app.
 */
export async function detectAgents(
    options: { t3Url?: string } = {},
): Promise<Record<ProviderName, boolean>> {
    const [t3code, claudeCode, ensemble] = await Promise.all([
        hasT3Code(options.t3Url),
        hasClaudeCode(),
        hasEnsemble(),
    ]);
    return { t3code, 'claude-code': claudeCode, ensemble };
}

/**
 * The agent for projects that haven't picked one: the saved choice, else the
 * first agent found (T3 Code, Claude Code, Ensemble), else T3 Code.
 */
export async function machineProvider(
    options: { dataDir?: string; t3Url?: string } = {},
): Promise<ProviderName> {
    const saved = await savedProvider(options.dataDir);
    if (saved) return saved;
    const found = await detectAgents(options);
    if (found.t3code) return 't3code';
    if (found['claude-code']) return 'claude-code';
    return found.ensemble ? 'ensemble' : 't3code';
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
