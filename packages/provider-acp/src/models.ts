import type { ConfigSelectGroup, ConfigSelectOption, SessionConfigOption } from './protocol.ts';

/** The models an agent offers, as the `model` setting of its sessions lists them. */
export interface AgentModels {
    /** The setting's id, which `session/set_config_option` takes. */
    configId: string;
    choices: Array<{ value: string; name: string; group?: string }>;
    /** What a new session runs on until another model is picked. */
    defaultModel?: string;
}

/**
 * Keeps what an agent said about its models, so the model picker has them
 * before a project's first session: across projects, and across restarts.
 */
export interface ModelCache {
    get(): Promise<AgentModels | undefined>;
    set(models: AgentModels): void;
}

/**
 * A session's model setting and the model it's on, when the agent has one: a
 * `select` in the `model` category, or else one called `model`.
 */
export function modelSetting(
    configOptions: unknown,
): { models: AgentModels; current?: string } | undefined {
    if (!Array.isArray(configOptions)) return undefined;
    const settings = configOptions.filter(isSelect);
    const setting =
        settings.find(candidate => candidate.category === 'model') ??
        settings.find(candidate => candidate.id === 'model');
    if (!setting) return undefined;
    const choices = (setting.options ?? [])
        .flatMap(entry =>
            isGroup(entry)
                ? entry.options.map(choice => ({ ...pick(choice), group: entry.name }))
                : [pick(entry)],
        )
        .filter(choice => typeof choice.value === 'string' && choice.value !== '');
    if (choices.length === 0) return undefined;
    const current = typeof setting.currentValue === 'string' ? setting.currentValue : undefined;
    return { models: { configId: setting.id, choices: byProvider(choices) }, current };
}

/**
 * A flat list whose every name is `provider/model` (OpenCode's) is grouped by
 * the provider, so a long list reads like the agent's own picker.
 */
function byProvider(choices: AgentModels['choices']): AgentModels['choices'] {
    const named = choices.every(choice => !choice.group && /^[^/]+\/./.test(choice.name));
    if (!named) return choices;
    return choices.map(({ value, name }) => {
        const slash = name.indexOf('/');
        return { value, name: name.slice(slash + 1), group: name.slice(0, slash) };
    });
}

function isSelect(value: unknown): value is SessionConfigOption {
    const setting = value as SessionConfigOption | null;
    return (
        typeof setting?.id === 'string' &&
        setting.type === 'select' &&
        Array.isArray(setting.options)
    );
}

function isGroup(entry: ConfigSelectOption | ConfigSelectGroup): entry is ConfigSelectGroup {
    return Array.isArray((entry as ConfigSelectGroup).options);
}

function pick({ value, name }: ConfigSelectOption): { value: string; name: string } {
    return { value, name: typeof name === 'string' && name ? name : value };
}
