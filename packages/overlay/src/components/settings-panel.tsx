import type { ProviderInfo } from '@tencil/protocol';
import { project, provider, send, settings } from '../lib/connection.ts';
import { settingsOpen } from '../lib/state.ts';
import { CloseIcon } from './icons.tsx';

/** Per-project settings: which agent new pins go to. */
export function SettingsPanel() {
    if (!settingsOpen.value) return null;
    const current = settings.value;
    const info = provider.value;

    return (
        <aside class="inbox settings-panel" aria-label="Project settings">
            <header class="inbox-header">
                <strong class="settings-title">Settings</strong>
                <button
                    type="button"
                    class="icon-button"
                    title="Close"
                    onClick={() => {
                        settingsOpen.value = false;
                    }}
                >
                    <CloseIcon />
                </button>
            </header>
            {current ? (
                <section class="settings-section">
                    <p class="settings-label" id="tencil-provider-label">
                        Agent for new pins
                    </p>
                    <p class="settings-help">
                        For {project.value?.name ?? 'this project'}. Pins you already made keep
                        their agent.
                    </p>
                    <fieldset class="settings-options" aria-labelledby="tencil-provider-label">
                        {current.providers.map(option => {
                            const selected = option.id === current.provider;
                            return (
                                <label
                                    key={option.id}
                                    class={`target-option${selected ? ' selected' : ''}`}
                                >
                                    <input
                                        type="radio"
                                        name="tencil-provider"
                                        class="settings-radio"
                                        checked={selected}
                                        onChange={() =>
                                            send({ type: 'settings.update', provider: option.id })
                                        }
                                    />
                                    <span class="target-option-title">{option.label}</span>
                                    {selected && info?.id === option.id && (
                                        <span class="target-option-meta">{stateLabel(info)}</span>
                                    )}
                                </label>
                            );
                        })}
                    </fieldset>
                    {info &&
                        info.id === current.provider &&
                        info.state !== 'ready' &&
                        info.detail && <p class="settings-status">{info.detail}</p>}
                </section>
            ) : (
                <p class="empty">Connecting…</p>
            )}
        </aside>
    );
}

function stateLabel(info: ProviderInfo): string {
    switch (info.state) {
        case 'ready':
            return 'Ready';
        case 'unauthorized':
            return info.canPair ? 'Not paired' : 'Not signed in';
        case 'unavailable':
            return 'Unavailable';
        default:
            return 'Connecting…';
    }
}
