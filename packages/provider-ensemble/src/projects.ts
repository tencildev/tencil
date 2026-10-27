import { EnsembleClient, ensembleUrl } from './api.ts';
import { EnsembleCredentialStore } from './auth.ts';

const ROOT_PREFIX = 'ensemble://thread/';

/** The project root Tencil uses for an Ensemble thread: `ensemble://thread/<id>`. */
export function ensembleRoot(threadId: string): string {
    return `${ROOT_PREFIX}${encodeURIComponent(threadId)}`;
}

/** The thread an `ensemble://thread/<id>` root names; undefined for a folder. */
export function ensembleThreadId(root: string): string | undefined {
    return root.startsWith(ROOT_PREFIX)
        ? decodeURIComponent(root.slice(ROOT_PREFIX.length))
        : undefined;
}

export interface EnsembleProjectSummary {
    workspaceRoot: string;
    title: string;
}

export interface EnsembleDiscoveryOptions {
    baseUrl?: string;
    credentials?: EnsembleCredentialStore;
}

/** Open Ensemble threads for the project picker, forwarded ones included; [] until paired. */
export async function listEnsembleProjects(
    options: EnsembleDiscoveryOptions = {},
): Promise<EnsembleProjectSummary[]> {
    const client = await pairedClient(options);
    const threads = (await client?.threads()) ?? [];
    return threads.map(thread => ({ workspaceRoot: ensembleRoot(thread.id), title: thread.title }));
}

/** The root of the Ensemble thread whose dev server listens on `port`, when there is one. */
export async function ensembleProjectForPort(
    port: number,
    options: EnsembleDiscoveryOptions = {},
): Promise<string | undefined> {
    const client = await pairedClient(options);
    const threads = (await client?.threads({ port })) ?? [];
    return threads.length === 1 && threads[0] ? ensembleRoot(threads[0].id) : undefined;
}

async function pairedClient(
    options: EnsembleDiscoveryOptions,
): Promise<EnsembleClient | undefined> {
    const baseUrl = options.baseUrl ?? ensembleUrl();
    const token = await (options.credentials ?? new EnsembleCredentialStore()).get(baseUrl);
    return token ? new EnsembleClient({ baseUrl, token, timeoutMs: 1_500 }) : undefined;
}
