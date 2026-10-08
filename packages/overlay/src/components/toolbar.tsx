import { useRef } from 'preact/hooks';
import { bridgeState, project, projectChoices, provider, send } from '../lib/connection.ts';
import { dock, moveDockBy, startDrag } from '../lib/dock.ts';
import {
    activeCount,
    hidden,
    inboxOpen,
    mode,
    settingsOpen,
    startPicking,
    stopPicking,
    unresolvedCount,
} from '../lib/state.ts';
import { CommentIcon, EyeIcon, EyeOffIcon, InboxIcon, SettingsIcon } from './icons.tsx';
import { ProjectPicker } from './project-picker.tsx';

export function Toolbar() {
    const status = connectionStatus();
    const picking = mode.value === 'picking';
    const ref = useRef<HTMLDivElement>(null);
    return (
        <div ref={ref} class={`toolbar-wrap dock-${dock.value}`}>
            {picking && (
                <div class="toolbar-hint">Click any element to pin a prompt · Esc to cancel</div>
            )}
            {!picking && projectChoices.value && <ProjectPicker />}
            {!picking && !projectChoices.value && status.hint && (
                <div class={`toolbar-hint hint-${status.tone}`}>
                    {status.hint}
                    {status.action && (
                        <button type="button" class="hint-action" onClick={status.action.run}>
                            {status.action.label}
                        </button>
                    )}
                </div>
            )}
            <div class="toolbar">
                <span class={`status-dot status-${status.tone}`} title={status.title}>
                    {activeCount.value > 0 && <span class="status-ping" />}
                </span>
                <button
                    type="button"
                    class="divider"
                    aria-label="Move toolbar (drag, or use arrow keys)"
                    title="Drag to move"
                    onPointerDown={event => ref.current && startDrag(event, ref.current)}
                    onKeyDown={event => {
                        if (ref.current && moveDockBy(event.key, ref.current))
                            event.preventDefault();
                    }}
                />
                <button
                    type="button"
                    class={`tool${picking ? ' tool-active' : ''}`}
                    title="Comment (C)"
                    onClick={() => (picking ? stopPicking() : startPicking())}
                >
                    <CommentIcon />
                    <span class="tool-label">Comment</span>
                    <kbd>C</kbd>
                </button>
                <button
                    type="button"
                    class={`tool${inboxOpen.value ? ' tool-active' : ''}`}
                    title="Pins"
                    onClick={() => {
                        inboxOpen.value = !inboxOpen.value;
                        settingsOpen.value = false;
                    }}
                >
                    <InboxIcon />
                    {unresolvedCount.value > 0 && (
                        <span class="badge">{unresolvedCount.value}</span>
                    )}
                </button>
                <button
                    type="button"
                    class="tool"
                    title={hidden.value ? 'Show pins' : 'Hide pins'}
                    onClick={() => {
                        hidden.value = !hidden.value;
                        if (hidden.value) stopPicking();
                    }}
                >
                    {hidden.value ? <EyeOffIcon /> : <EyeIcon />}
                </button>
                <button
                    type="button"
                    class={`tool${settingsOpen.value ? ' tool-active' : ''}`}
                    title="Project settings"
                    disabled={!project.value}
                    onClick={() => {
                        settingsOpen.value = !settingsOpen.value;
                        inboxOpen.value = false;
                    }}
                >
                    <SettingsIcon />
                </button>
            </div>
        </div>
    );
}

interface ConnectionStatus {
    tone: 'ok' | 'warn' | 'error';
    title: string;
    hint?: string;
    action?: { label: string; run: () => void };
}

/** The other agent may well be running; offer it from the status hint. */
const switchAgent = {
    label: 'Switch agent',
    run: () => {
        settingsOpen.value = true;
        inboxOpen.value = false;
    },
};

function connectionStatus(): ConnectionStatus {
    if (bridgeState.value !== 'open') {
        return {
            tone: 'error',
            title: 'Tencil daemon offline',
            hint:
                bridgeState.value === 'connecting'
                    ? undefined
                    : 'The Tencil daemon stopped. Start it again with npx tencil start.',
        };
    }
    if (projectChoices.value) return { tone: 'warn', title: "Pick this page's project" };
    const info = provider.value;
    if (!info) return { tone: 'warn', title: 'Connecting…' };
    switch (info.state) {
        case 'ready':
            return { tone: 'ok', title: `${info.label}${info.target ? ` · ${info.target}` : ''}` };
        case 'unauthorized':
            return info.canPair
                ? {
                      tone: 'warn',
                      title: `${info.label}: not paired`,
                      hint: `Not paired with ${info.label}`,
                      action: { label: 'Pair', run: () => send({ type: 'provider.pair' }) },
                  }
                : {
                      tone: 'warn',
                      title: `${info.label}: not signed in`,
                      hint: info.detail ?? `Sign in to ${info.label}`,
                      action: switchAgent,
                  };
        case 'unavailable':
            return {
                tone: 'error',
                title: info.detail ?? `${info.label} unavailable`,
                hint: info.detail ?? `${info.label} is unavailable`,
                action: switchAgent,
            };
        default:
            return { tone: 'warn', title: `Connecting to ${info.label}…` };
    }
}
