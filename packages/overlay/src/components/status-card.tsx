import { useEffect, useRef, useState } from 'preact/hooks';
import { viewer } from '../lib/cloud-auth.ts';
import {
    bridgeState,
    daemonHost,
    daemonVersion,
    isCloud,
    project,
    projectChoices,
    provider,
} from '../lib/connection.ts';
import { activeCount, queuedThreads } from '../lib/state.ts';
import { TencilLogo } from './icons.tsx';
import { stateLabel } from './settings-panel.tsx';

/** Hover or focus delay before the card shows, so passing over the dot doesn't flash it. */
const OPEN_DELAY_MS = 250;

export type Tone = 'ok' | 'warn' | 'error';

/**
 * The toolbar's status dot. Hovering or focusing it shows a card about the
 * connection: the daemon, the project this page belongs to and its agent.
 */
export function StatusDot({ tone, label }: { tone: Tone; label: string }) {
    const [open, setOpen] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    useEffect(() => () => clearTimeout(timer.current), []);
    const show = (delay: number) => {
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setOpen(true), delay);
    };
    const hide = () => {
        clearTimeout(timer.current);
        setOpen(false);
    };

    return (
        <span class="status" onPointerEnter={() => show(OPEN_DELAY_MS)} onPointerLeave={hide}>
            <button
                type="button"
                class="status-button"
                aria-label={`Tencil status: ${label}`}
                aria-expanded={open}
                aria-describedby={open ? 'tencil-status-card' : undefined}
                onFocus={() => show(0)}
                onBlur={hide}
                // Touch has no hover: a tap toggles it.
                onClick={() => (open ? hide() : show(0))}
            >
                <span class={`status-dot status-${tone}`}>
                    {activeCount.value > 0 && <span class="status-ping" />}
                </span>
            </button>
            {open && <StatusCard tone={tone} />}
        </span>
    );
}

function StatusCard({ tone }: { tone: Tone }) {
    return (
        <div class="status-card" role="tooltip" id="tencil-status-card">
            <div class="status-card-head">
                <TencilLogo size={18} />
                <strong>Tencil</strong>
                {daemonVersion.value && (
                    <span class="status-card-muted">v{daemonVersion.value}</span>
                )}
            </div>
            <StatusRows tone={tone} />
        </div>
    );
}

interface StatusRow {
    label: string;
    value: string;
    /** A dot before the value: green when fine, the toolbar's tone when not. */
    tone?: Tone;
    /** After the value, dimmed. */
    note?: string;
    title?: string;
}

/**
 * What the status card says about the connection: the daemon, the project
 * this page belongs to, its agent. The About page's debug section shows the
 * same rows, and copies them as text.
 */
export function statusRows(tone: Tone = defaultTone()): StatusRow[] {
    const info = provider.value;
    const state = bridgeState.value;
    const queued = queuedThreads.value.length;
    const working = activeCount.value;
    const account = viewer.value;
    const rows: StatusRow[] = [
        {
            label: isCloud() ? 'Tencil Cloud' : 'Daemon',
            tone: state === 'open' ? 'ok' : tone,
            value:
                state === 'open' ? 'Connected' : state === 'connecting' ? 'Connecting…' : 'Offline',
        },
        { label: 'Address', value: daemonHost() },
        {
            label: 'Project',
            value: projectChoices.value ? 'Not picked yet' : (project.value?.name ?? '…'),
            title: project.value?.root,
        },
        info
            ? {
                  label: 'Agent',
                  tone: info.state === 'ready' ? 'ok' : tone,
                  value: info.label,
                  note: stateLabel(info),
              }
            : { label: 'Agent', value: '…' },
    ];
    if (info?.target) rows.push({ label: 'Workspace', value: info.target });
    if (account) {
        rows.push({
            label: 'Signed in',
            value: account.login ? `@${account.login}` : account.name,
            note: account.access === 'read' ? 'view only' : undefined,
        });
    }
    if (working > 0 || queued > 0) {
        rows.push({
            label: 'Pins',
            value: [working > 0 && `${working} working`, queued > 0 && `${queued} queued`]
                .filter(Boolean)
                .join(' · '),
        });
    }
    return rows;
}

/** Outside the toolbar there's no status tone at hand: offline is an error, the rest a warning. */
function defaultTone(): Tone {
    return bridgeState.value === 'open' ? 'warn' : 'error';
}

export function StatusRows({ tone }: { tone?: Tone }) {
    const info = provider.value;
    return (
        <>
            <dl class="status-card-rows">
                {statusRows(tone).map(row => (
                    <div key={row.label} class="status-card-row">
                        <dt>{row.label}</dt>
                        <dd title={row.title}>
                            {row.tone && <span class={`status-card-tone tone-${row.tone}`} />}
                            {row.value}
                            {row.note && <span class="status-card-muted">{row.note}</span>}
                        </dd>
                    </div>
                ))}
            </dl>
            {info && info.state !== 'ready' && info.detail && (
                <p class="status-card-detail">{info.detail}</p>
            )}
        </>
    );
}
