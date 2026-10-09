import type { ProviderModel } from '@tencil/protocol';
import type { ModelSelection } from './protocols/adapter.ts';

export interface WireServerProvider {
    instanceId: string;
    driver?: string;
    displayName?: string;
    enabled: boolean;
    installed: boolean;
    status: string;
    models: Array<{ slug: string; name?: string; isDefault?: boolean; isCustom?: boolean }>;
}

/** The part of T3 Code's server settings that decides which model new threads use. */
export interface WireModelSettings {
    defaultModelSelection?: ModelSelection | null;
    projectSettingsOverrides?: Record<string, { defaultModelSelection?: ModelSelection | null }>;
    /** Once folded, project defaults live in the overrides, not on the project record. */
    projectSettingsFolded?: boolean;
}

export interface ModelSources {
    providers: WireServerProvider[];
    /** Absent on servers that don't send settings with their config. */
    settings?: WireModelSettings;
    projectId: string;
    /** The default stored on the project record (before settings were folded). */
    projectDefault?: ModelSelection | null;
    /** Models of the user's own threads in this project, newest first. */
    recent: ModelSelection[];
}

/**
 * What a new thread runs on when nothing is picked, following T3 Code's
 * composer: the project's default, then the environment's default. T3 Code
 * otherwise reuses the model last used in that window, which only the window
 * knows, so the closest stand-in is the user's most recent thread in this
 * project. Without any of those: the first ready agent and its default model.
 */
export function resolveModelSelection(sources: ModelSources): ModelSelection | undefined {
    const { settings } = sources;
    const usable = usableProviders(sources.providers);
    const candidates = [
        settings?.projectSettingsFolded
            ? settings.projectSettingsOverrides?.[sources.projectId]?.defaultModelSelection
            : sources.projectDefault,
        settings?.defaultModelSelection,
        ...sources.recent,
    ];
    for (const candidate of candidates) {
        if (candidate && runsOn(usable, candidate)) return candidate;
    }
    const provider = usable.find(p => p.status === 'ready') ?? usable[0];
    const model = provider?.models.find(m => m.isDefault) ?? provider?.models[0];
    return provider && model ? { instanceId: provider.instanceId, model: model.slug } : undefined;
}

/** Every model of every agent that can start a thread, in T3 Code's order. */
export function modelOptions(providers: WireServerProvider[]): ProviderModel[] {
    return usableProviders(providers).flatMap(provider =>
        provider.models.map(model => ({
            id: modelId({ instanceId: provider.instanceId, model: model.slug }),
            label: model.name ?? model.slug,
            group: provider.displayName ?? provider.instanceId,
            agent: provider.driver ?? provider.instanceId,
        })),
    );
}

/** A picked model, if its agent can still start threads. */
export function pickedSelection(
    providers: WireServerProvider[],
    id: string | undefined,
): ModelSelection | undefined {
    const selection = id ? parseModelId(id) : undefined;
    return selection && runsOn(usableProviders(providers), selection) ? selection : undefined;
}

/** Instance ids never contain a slash; model slugs may (`anthropic/claude-…`). */
export function modelId(selection: ModelSelection): string {
    return `${selection.instanceId}/${selection.model}`;
}

function parseModelId(id: string): ModelSelection | undefined {
    const slash = id.indexOf('/');
    if (slash <= 0 || slash === id.length - 1) return undefined;
    return { instanceId: id.slice(0, slash), model: id.slice(slash + 1) };
}

function usableProviders(providers: WireServerProvider[]): WireServerProvider[] {
    return providers.filter(
        provider =>
            provider.enabled &&
            provider.installed &&
            provider.status !== 'error' &&
            provider.status !== 'disabled',
    );
}

function runsOn(usable: WireServerProvider[], selection: ModelSelection): boolean {
    return Boolean(selection.model) && usable.some(p => p.instanceId === selection.instanceId);
}
