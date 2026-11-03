import { useRef } from 'preact/hooks';
import { pinBlocked, signIn, signInRequired, signingIn } from '../lib/cloud-auth.ts';
import {
    bridgeState,
    cloudUrl,
    isCloud,
    lastError,
    project,
    projectChoices,
    provider,
    reconnect,
    send,
} from '../lib/connection.ts';
import { dock, moveDockBy, startDrag } from '../lib/dock.ts';
import { besideIndicator, nextIndicator } from '../lib/next-devtools.ts';
import { labels } from '../lib/shortcuts.ts';
import {
    draft,
    hidden,
    inboxOpen,
    mode,
    queuedThreads,
    rulerAnchor,
    rulerAvailable,
    rulerOn,
    rulerToggle,
    settingsOpen,
    settingsSection,
    startPicking,
    stopPicking,
    toggleRuler,
    unresolvedCount,
} from '../lib/state.ts';
import { updateAvailable } from './about-section.tsx';
import {
    ArrowUpIcon,
    CommentIcon,
    EyeIcon,
    EyeOffIcon,
    InboxIcon,
    RulerIcon,
    RulerOffIcon,
    SettingsIcon,
} from './icons.tsx';
import { sendQueued } from './pins.tsx';
import { ProjectPicker } from './project-picker.tsx';
import { StatusDot, type Tone } from './status-card.tsx';

export function Toolbar() {
    const status = connectionStatus();
    const keys = labels.value;
    const picking = mode.value === 'picking';
    const ref = useRef<HTMLDivElement>(null);
    return (
        <div
            ref={ref}
            class={`toolbar-wrap dock-${dock.value}`}
            // Next.js's dev tools button sits in a corner too; stand beside it, not on it.
            style={besideIndicator(dock.value, nextIndicator.value)}
        >
            {picking && (
                <div class="toolbar-hint">
                    Click any element to pin a prompt
                    {rulerOn.value && keys.measure && ` · ${keys.measure} to measure`} · Esc to
                    cancel
                </div>
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
            {!picking && !status.hint && rulerAnchor.value && !draft.value && (
                <div class="toolbar-hint">
                    Hold {keys.measure} and hover to measure
                    {keys.comment && ` · ${keys.comment} to comment`} · Esc to clear
                </div>
            )}
            <div class="toolbar">
                <StatusDot tone={status.tone} label={status.title} />
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
                    title={pinBlocked.value ?? withKey('Comment', keys.comment)}
                    disabled={pinBlocked.value !== null}
                    onClick={() => (picking ? stopPicking() : startPicking())}
                >
                    <CommentIcon />
                    <span class="tool-label">Comment</span>
                    {keys.comment && <kbd>{keys.comment}</kbd>}
                </button>
                {rulerAvailable.value && (
                    <button
                        type="button"
                        class={`tool${rulerToggle.value ? '' : ' tool-off'}`}
                        title={
                            rulerToggle.value
                                ? `${withKey('Ruler on', keys.ruler)}${keys.measure ? `: hold ${keys.measure} to measure` : ''}`
                                : withKey('Ruler off', keys.ruler)
                        }
                        aria-label="Ruler"
                        aria-pressed={rulerToggle.value}
                        onClick={toggleRuler}
                    >
                        {rulerToggle.value ? <RulerIcon /> : <RulerOffIcon />}
                    </button>
                )}
                {queuedThreads.value.length > 0 && (
                    <button
                        type="button"
                        class="tool tool-send"
                        title="Send the queued comments to the agent as one thread"
                        disabled={provider.value?.state !== 'ready'}
                        onClick={sendQueued}
                    >
                        <ArrowUpIcon />
                        <span class="tool-label">Send {queuedThreads.value.length}</span>
                    </button>
                )}
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
                    title={withKey(hidden.value ? 'Show pins' : 'Hide pins', keys.hidePins)}
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
                    title="Settings"
                    aria-label={updateAvailable.value ? 'Settings (update available)' : undefined}
                    disabled={!project.value}
                    onClick={() => {
                        settingsOpen.value = !settingsOpen.value;
                        inboxOpen.value = false;
                    }}
                >
                    <SettingsIcon />
                    {updateAvailable.value && <span class="tool-dot" />}
                </button>
            </div>
        </div>
    );
}

/** `Comment (C)`, or just `Comment` when its shortcut is cleared. */
function withKey(label: string, key: string | null): string {
    return key ? `${label} (${key})` : label;
}

interface ConnectionStatus {
    tone: Tone;
    title: string;
    hint?: string;
    action?: { label: string; run: () => void };
}

/** The other agent may well be running; offer it from the status hint. */
const switchAgent = {
    label: 'Switch agent',
    run: () => {
        settingsSection.value = 'agent';
        settingsOpen.value = true;
        inboxOpen.value = false;
    },
};

function connectionStatus(): ConnectionStatus {
    if (bridgeState.value !== 'open') {
        if (isCloud()) {
            return {
                tone: 'error',
                title: 'Tencil Cloud unreachable',
                hint:
                    bridgeState.value === 'connecting'
                        ? undefined
                        : "Can't reach Tencil Cloud. Retrying…",
            };
        }
        return {
            tone: 'error',
            title: 'Tencil daemon offline',
            hint:
                bridgeState.value === 'connecting'
                    ? undefined
                    : 'The Tencil daemon stopped. Start it again with npx tencil start.',
        };
    }
    const required = signInRequired.value;
    if (required) {
        return {
            tone: 'warn',
            title: 'Sign in to Tencil Cloud',
            hint: required.reason ?? 'Sign in with GitHub to pin on this preview',
            action: signingIn.value
                ? undefined
                : { label: 'Sign in', run: () => startSignIn(required.signIn) },
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

function startSignIn(config: NonNullable<typeof signInRequired.value>['signIn']): void {
    signIn(cloudUrl(), config).then(reconnect, (error: unknown) => {
        lastError.value = {
            message: error instanceof Error ? error.message : String(error),
            at: Date.now(),
        };
    });
}
