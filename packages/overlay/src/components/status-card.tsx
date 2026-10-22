import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { viewer } from '../lib/cloud-auth.ts';
import {
    bridgeState,
    daemonHost,
    daemonVersion,
    isCloud,
    originBlocked,
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
    const info = provider.value;
    const state = bridgeState.value;
    const queued = queuedThreads.value.length;
    const working = activeCount.value;
    return (
        <div class="status-card" role="tooltip" id="tencil-status-card">
            <div class="status-card-head">
                <TencilLogo size={18} />
                <strong>Tencil</strong>
                {daemonVersion.value && (
                    <span class="status-card-muted">v{daemonVersion.value}</span>
                )}
            </div>
            <dl class="status-card-rows">
                <Row label={isCloud() ? 'Tencil Cloud' : 'Daemon'}>
                    <span class={`status-card-tone tone-${state === 'open' ? 'ok' : tone}`} />
                    {state === 'open'
                        ? 'Connected'
                        : originBlocked.value
                          ? 'Site not allowed'
                          : state === 'connecting'
                            ? 'Connecting…'
                            : 'Offline'}
                </Row>
                <Row label="Address">{daemonHost()}</Row>
                <Row label="Project">
                    {projectChoices.value ? (
                        'Not picked yet'
                    ) : project.value ? (
                        <span title={project.value.root}>{project.value.name}</span>
                    ) : (
                        '…'
                    )}
                </Row>
                <Row label="Agent">
                    {info ? (
                        <>
                            <span
                                class={`status-card-tone tone-${info.state === 'ready' ? 'ok' : tone}`}
                            />
                            {info.label}
                            <span class="status-card-muted">{stateLabel(info)}</span>
                        </>
                    ) : (
                        '…'
                    )}
                </Row>
                {info?.target && <Row label="Workspace">{info.target}</Row>}
                {viewer.value && (
                    <Row label="Signed in">
                        {viewer.value.login ? `@${viewer.value.login}` : viewer.value.name}
                        {viewer.value.access === 'read' && (
                            <span class="status-card-muted">view only</span>
                        )}
                    </Row>
                )}
                {(working > 0 || queued > 0) && (
                    <Row label="Pins">
                        {[working > 0 && `${working} working`, queued > 0 && `${queued} queued`]
                            .filter(Boolean)
                            .join(' · ')}
                    </Row>
                )}
            </dl>
            {info && info.state !== 'ready' && info.detail && (
                <p class="status-card-detail">{info.detail}</p>
            )}
        </div>
    );
}

function Row({ label, children }: { label: string; children: ComponentChildren }) {
    return (
        <div class="status-card-row">
            <dt>{label}</dt>
            <dd>{children}</dd>
        </div>
    );
}
