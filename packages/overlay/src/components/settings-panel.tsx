import type { ProviderInfo } from '@tencildev/protocol';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { forgetToken, viewer } from '../lib/cloud-auth.ts';
import {
    cloudUrl,
    isCloud,
    project,
    provider,
    reconnect,
    send,
    settings,
} from '../lib/connection.ts';
import { getHost } from '../lib/overlay-host.ts';
import { labels } from '../lib/shortcuts.ts';
import {
    dockHidden,
    type SettingsSection,
    setBatchAvailable,
    setDockHidden,
    setGitActions,
    setRulerAvailable,
    settingsOpen,
    settingsSection,
} from '../lib/state.ts';
import { setTheme, type Theme, theme } from '../lib/theme.ts';
import { AboutSection, updateAvailable } from './about-section.tsx';
import { AgentIcon } from './agent-icons.tsx';
import { CloseIcon, LayersIcon, RulerIcon, TencilLogo } from './icons.tsx';
import { ProjectOverview } from './project-overview.tsx';
import { ShortcutsPage } from './shortcuts-page.tsx';

interface Page {
    id: SettingsSection;
    label: string;
}

const AGENT_PAGE: Page = { id: 'agent', label: 'Agent' };

/**
 * Settings, in a dialog over the page. Pages are grouped by where they're
 * saved: the project's (shared by everyone on its pins), this browser's, and
 * Tencil itself.
 */
export function SettingsPanel() {
    const panel = useRef<HTMLElement>(null);
    useDialogFocus(panel);

    const projectPages: Page[] = [
        { id: 'overview', label: 'Project' },
        AGENT_PAGE,
        { id: 'tools', label: 'Tools' },
    ];
    const browserPages: Page[] = [
        { id: 'appearance', label: 'Appearance' },
        { id: 'shortcuts', label: 'Shortcuts' },
        { id: 'dock', label: 'Dock' },
        ...(viewer.value ? [{ id: 'account', label: 'Account' } as const] : []),
    ];
    const tencilPages: Page[] = isCloud() ? [] : [{ id: 'about', label: 'About' }];
    const pages = [...projectPages, ...browserPages, ...tencilPages];
    const current = pages.find(page => page.id === settingsSection.value) ?? AGENT_PAGE;
    const close = () => {
        settingsOpen.value = false;
    };
    const select = (id: SettingsSection) => {
        settingsSection.value = id;
    };

    return (
        <>
            <div class="settings-scrim" onClick={close} />
            <section
                ref={panel}
                class="settings-panel"
                role="dialog"
                aria-modal="true"
                aria-label="Settings"
                onKeyDown={event => {
                    if (event.key === 'Escape') {
                        event.stopPropagation();
                        close();
                    } else if (event.key === 'Tab' && panel.current) {
                        trapTab(event, panel.current);
                    }
                }}
            >
                <nav
                    class="settings-nav"
                    aria-label="Settings pages"
                    onKeyDown={event => {
                        const step =
                            event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
                        if (!step) return;
                        event.preventDefault();
                        const index = pages.indexOf(current);
                        const next = pages[(index + step + pages.length) % pages.length];
                        if (!next) return;
                        select(next.id);
                        const button = panel.current?.querySelector<HTMLElement>(
                            `[data-page="${next.id}"]`,
                        );
                        button?.focus();
                    }}
                >
                    <strong class="settings-title">
                        <TencilLogo size={18} />
                        Settings
                    </strong>
                    <NavGroup pages={projectPages} current={current.id} onSelect={select} />
                    <NavGroup
                        title="You"
                        pages={browserPages}
                        current={current.id}
                        onSelect={select}
                    />
                    {tencilPages.length > 0 && (
                        <NavGroup
                            title="Tencil"
                            pages={tencilPages}
                            current={current.id}
                            onSelect={select}
                        />
                    )}
                </nav>
                <div class="settings-page">
                    <header class="settings-header">
                        <div class="settings-heading">
                            <h2>
                                {current.id === 'overview'
                                    ? (project.value?.name ?? current.label)
                                    : current.label}
                            </h2>
                            <span class="settings-scope">{scope(current.id)}</span>
                        </div>
                        <button
                            type="button"
                            class="icon-button"
                            title="Close (Esc)"
                            aria-label="Close settings"
                            onClick={close}
                        >
                            <CloseIcon />
                        </button>
                    </header>
                    <div class="settings-body">
                        <PageContent id={current.id} />
                    </div>
                </div>
            </section>
        </>
    );
}

function NavGroup({
    title,
    pages,
    current,
    onSelect,
}: {
    /** Left out where the first page already names the group. */
    title?: string;
    pages: Page[];
    current: SettingsSection;
    onSelect: (id: SettingsSection) => void;
}) {
    return (
        <div class="settings-nav-group">
            {title && <p class="settings-nav-title">{title}</p>}
            {pages.map(page => {
                const dot = page.id === 'about' && updateAvailable.value;
                return (
                    <button
                        key={page.id}
                        type="button"
                        data-page={page.id}
                        class={`settings-nav-item${page.id === current ? ' active' : ''}${page.id === 'overview' ? ' settings-nav-project' : ''}`}
                        aria-current={page.id === current ? 'page' : undefined}
                        aria-label={dot ? `${page.label} (update available)` : undefined}
                        // One tab stop for the list; arrow keys move within it.
                        tabIndex={page.id === current ? 0 : -1}
                        onClick={() => onSelect(page.id)}
                    >
                        <span class="settings-nav-label">{page.label}</span>
                        {dot && <span class="settings-nav-dot" />}
                    </button>
                );
            })}
        </div>
    );
}

function scope(id: SettingsSection): string {
    switch (id) {
        case 'overview':
            return project.value?.root ?? '';
        case 'agent':
        case 'tools':
            return project.value
                ? `Saved for ${project.value.name}, for everyone using its pins`
                : 'Saved for this project';
        case 'appearance':
        case 'shortcuts':
            // Tencil Cloud has no daemon to save them on.
            return isCloud()
                ? 'Saved in this browser'
                : 'Saved on this computer, for all your projects';
        case 'dock':
            return 'Saved in this browser, for this site';
        case 'account':
            return 'Saved in this browser';
        default:
            return 'Runs on this machine, for all your projects';
    }
}

function PageContent({ id }: { id: SettingsSection }) {
    switch (id) {
        case 'overview':
            return <ProjectOverview />;
        case 'agent':
            return <AgentPage />;
        case 'tools':
            return <ToolsPage />;
        case 'appearance':
            return <AppearancePage />;
        case 'shortcuts':
            return <ShortcutsPage />;
        case 'dock':
            return <DockPage />;
        case 'account':
            return <AccountPage />;
        default:
            return <AboutSection />;
    }
}

function AgentPage() {
    const current = settings.value;
    const info = provider.value;
    if (!current) return <p class="empty">Connecting…</p>;
    return (
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
                                    send({ type: 'settings.update', provider: option.id })
                                }
                            />
                            <AgentIcon agent={option.id} size={14} decorative />
                            <span class="target-option-title">{option.label}</span>
                            {selected && info?.id === option.id && (
                                <span class="target-option-meta">{stateLabel(info)}</span>
                            )}
                        </label>
                    );
                })}
            </fieldset>
            {info && info.id === current.provider && info.state !== 'ready' && info.detail && (
                <p class="settings-status">{info.detail}</p>
            )}
            <p class="settings-help">Pins you already made keep their agent.</p>
        </div>
    );
}

function ToolsPage() {
    const current = settings.value;
    if (!current) return <p class="empty">Connecting…</p>;
    return (
        <>
            <SwitchRow
                label="Batch mode"
                checked={current.batch}
                onChange={setBatchAvailable}
                help={
                    <>
                        Adds <LayersIcon /> to the comment box to queue comments and send them
                        together.
                    </>
                }
            />
            <SwitchRow
                label="Ruler"
                checked={current.ruler}
                onChange={setRulerAvailable}
                help={
                    <>
                        Adds <RulerIcon /> to the toolbar.
                        {labels.value.measure &&
                            ` With it on, hold ${labels.value.measure} to measure spacing on the page.`}
                    </>
                }
            />
            {current.git !== undefined && (
                <SwitchRow
                    label="Git actions"
                    checked={current.git}
                    onChange={setGitActions}
                    help="Once an agent changes files, its pin offers Commit and Revert. Commit asks the agent to commit its edits, following your repository's rules. Revert undoes just its edits and keeps the rest of your work."
                />
            )}
        </>
    );
}

const THEMES: { id: Theme; label: string }[] = [
    { id: 'dark', label: 'Dark' },
    { id: 'light', label: 'Light' },
    { id: 'system', label: 'System' },
];

function AppearancePage() {
    return (
        <div class="settings-section settings-switch-row">
            <span class="settings-switch-text">
                <span class="settings-label" id="tencil-theme-label">
                    Theme
                </span>
                <span class="settings-help">
                    Panels and the comment box. System follows your computer's setting.
                </span>
            </span>
            <fieldset class="segmented settings-segmented" aria-labelledby="tencil-theme-label">
                {THEMES.map(option => (
                    <label key={option.id} class={theme.value === option.id ? 'active' : undefined}>
                        <input
                            type="radio"
                            name="tencil-theme"
                            checked={theme.value === option.id}
                            onChange={() => setTheme(option.id)}
                        />
                        {option.label}
                    </label>
                ))}
            </fieldset>
        </div>
    );
}

function DockPage() {
    return (
        <SwitchRow
            label="Hide the dock"
            checked={dockHidden.value}
            onChange={setDockHidden}
            help={
                <>
                    Hides the toolbar, pins and panels on this site. Press{' '}
                    <kbd>{labels.value.hideDock}</kbd> anywhere on the page to bring them back, or
                    to hide them again.
                </>
            }
        />
    );
}

function AccountPage() {
    const account = viewer.value;
    if (!account) return null;
    return (
        <div class="settings-section settings-account">
            <span class="settings-help">
                Signed in to Tencil Cloud as{' '}
                <strong>{account.login ? `@${account.login}` : account.name}</strong>
            </span>
            <button
                type="button"
                class="hint-action"
                onClick={() => {
                    forgetToken(cloudUrl());
                    reconnect();
                }}
            >
                Sign out
            </button>
        </div>
    );
}

function SwitchRow({
    label,
    help,
    checked,
    onChange,
}: {
    label: string;
    help: ComponentChildren;
    checked: boolean;
    onChange: (on: boolean) => void;
}) {
    return (
        <label class="settings-section settings-switch-row">
            <span class="settings-switch-text">
                <span class="settings-label">{label}</span>
                <span class="settings-help">{help}</span>
            </span>
            <input
                type="checkbox"
                role="switch"
                class="settings-switch"
                checked={checked}
                aria-checked={checked}
                onChange={event => onChange(event.currentTarget.checked)}
            />
        </label>
    );
}

/** Focus moves into the dialog when it opens and back to what opened it when it closes. */
function useDialogFocus(panel: { current: HTMLElement | null }): void {
    useEffect(() => {
        const opener = getHost().shadowRoot?.activeElement;
        panel.current?.querySelector<HTMLElement>('.settings-nav-item.active')?.focus();
        return () => {
            if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
        };
    }, []);
}

/** Tab and Shift+Tab wrap around inside the dialog instead of leaving it for the page. */
function trapTab(event: KeyboardEvent, panel: HTMLElement): void {
    const focusable = [
        ...panel.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ),
    ].filter(element => element.tabIndex >= 0);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = getHost().shadowRoot?.activeElement;
    if (event.shiftKey && active === first) {
        event.preventDefault();
        last?.focus();
    } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first?.focus();
    }
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
