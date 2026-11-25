import type { ProviderModel } from '@tencildev/protocol';
import { Fragment } from 'preact';
import { AgentIcon } from './agent-icons.tsx';
import { ChevronIcon } from './icons.tsx';

export interface ModelChoices {
    models: ProviderModel[];
    /** The model it runs on: the picked one, else the default. */
    current?: ProviderModel;
    /** The picked id; null when nothing is picked and the default applies. */
    picked: string | null;
    /** New threads only: what "Default" runs on. A thread has no default to go back to. */
    fallback?: ProviderModel;
}

/** The toolbar button that opens the menu, labeled with the current model. */
export function ModelToggle({
    choices,
    open,
    title,
    onToggle,
}: {
    choices: ModelChoices;
    open: boolean;
    title: string;
    onToggle: () => void;
}) {
    return (
        <button
            type="button"
            class={`toggle model-toggle${open ? ' open' : ''}`}
            onClick={onToggle}
            title={title}
            aria-expanded={open}
        >
            <AgentIcon agent={choices.current?.agent} size={12} />
            <span class="model-toggle-label">{choices.current?.label ?? 'Default model'}</span>
            <ChevronIcon />
        </button>
    );
}

/** Models grouped by agent; `withDefault` adds the entry that goes back to the default. */
export function ModelMenu({
    choices,
    withDefault,
    onPick,
}: {
    choices: ModelChoices;
    withDefault?: boolean;
    onPick: (model: string | null) => void;
}) {
    const groups = new Map<string, ProviderModel[]>();
    for (const model of choices.models) {
        groups.set(model.group, [...(groups.get(model.group) ?? []), model]);
    }
    const selected = withDefault ? choices.picked : (choices.current?.id ?? null);
    return (
        <div class="target-menu" role="listbox">
            {withDefault && (
                <button
                    type="button"
                    role="option"
                    aria-selected={selected === null}
                    class={`target-option${selected === null ? ' selected' : ''}`}
                    onClick={() => onPick(null)}
                >
                    <span class="target-option-title">Default</span>
                    {choices.fallback && (
                        <span class="target-option-meta">{choices.fallback.label}</span>
                    )}
                </button>
            )}
            {[...groups].map(([group, models]) => (
                <Fragment key={group}>
                    <p class="menu-group">
                        <AgentIcon agent={models[0]?.agent} size={11} />
                        {group}
                    </p>
                    {models.map(model => (
                        <button
                            key={model.id}
                            type="button"
                            role="option"
                            aria-selected={selected === model.id}
                            class={`target-option${selected === model.id ? ' selected' : ''}`}
                            onClick={() => onPick(model.id)}
                        >
                            <span class="target-option-title">{model.label}</span>
                        </button>
                    ))}
                </Fragment>
            ))}
        </div>
    );
}
