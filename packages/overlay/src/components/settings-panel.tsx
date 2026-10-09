import type { ProviderInfo } from '@tencil/protocol';
import { project, provider, send, settings } from '../lib/connection.ts';
import { setBatchAvailable, settingsOpen } from '../lib/state.ts';
import { AgentIcon } from './agent-icons.tsx';
import { CloseIcon, LayersIcon } from './icons.tsx';

/**
 * Per-project settings, opened from the toolbar and drawn next to it: which
 * agent new pins go to, and whether comments are batched.
 */
export function SettingsPanel() {
    if (!settingsOpen.value) return null;
    const current = settings.value;
    const info = provider.value;
    const close = () => {
        settingsOpen.value = false;
    };

    return (
        <section
            class="settings-panel"
            role="dialog"
            aria-label="Project settings"
            onKeyDown={event => {
                if (event.key !== 'Escape') return;
                event.stopPropagation();
                close();
            }}
        >
            <header class="settings-header">
                <div class="settings-heading">
                    <strong>Settings</strong>
                    {project.value && <span class="settings-project">{project.value.name}</span>}
                </div>
                <button type="button" class="icon-button" title="Close (Esc)" onClick={close}>
                    <CloseIcon />
                </button>
            </header>
            {current ? (
                <>
                    <div class="settings-section">
                        <p class="settings-label" id="tencil-provider-label">
                            Agent for new pins
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
                                                send({
                                                    type: 'settings.update',
                                                    provider: option.id,
                                                })
                                            }
                                        />
                                        <AgentIcon agent={option.id} size={14} decorative />
                                        <span class="target-option-title">{option.label}</span>
                                        {selected && info?.id === option.id && (
                                            <span class="target-option-meta">
                                                {stateLabel(info)}
                                            </span>
                                        )}
                                    </label>
                                );
                            })}
                        </fieldset>
                        {info &&
                            info.id === current.provider &&
                            info.state !== 'ready' &&
                            info.detail && <p class="settings-status">{info.detail}</p>}
                        <p class="settings-help">Pins you already made keep their agent.</p>
                    </div>
                    <label class="settings-section settings-switch-row">
                        <span class="settings-switch-text">
                            <span class="settings-label">Batch mode</span>
                            <span class="settings-help">
                                Adds <LayersIcon /> to the comment box to queue comments and send
                                them together.
                            </span>
                        </span>
                        <input
                            type="checkbox"
                            role="switch"
                            class="settings-switch"
                            checked={current.batch}
                            aria-checked={current.batch}
                            onChange={event => setBatchAvailable(event.currentTarget.checked)}
                        />
                    </label>
                </>
            ) : (
                <p class="empty">Connecting…</p>
            )}
        </section>
    );
}

export function stateLabel(info: ProviderInfo): string {
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
