import type { StepKind, Thread, ThreadStep } from '@tencildev/protocol';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { send } from '../lib/connection.ts';
import { clock, duration, elapsed, summary } from '../lib/steps.ts';
import {
    AgentIcon,
    CheckIcon,
    ChevronIcon,
    CloseIcon,
    FileIcon,
    GlobeIcon,
    PencilIcon,
    SearchIcon,
    StopIcon,
    TerminalIcon,
    ToolIcon,
} from './icons.tsx';

/** Height of one step row plus the gap under it; the rolling window moves by this. */
const ROW_PITCH = 22;

const KIND_ICONS: Record<StepKind, () => preact.JSX.Element> = {
    read: FileIcon,
    search: SearchIcon,
    edit: PencilIcon,
    command: TerminalIcon,
    web: GlobeIcon,
    agent: AgentIcon,
    tool: ToolIcon,
};

/**
 * The agent's tool calls for the latest turn. While it works, a header with a
 * live clock and Stop over a rolling window of the newest calls; once done,
 * one line ("6 steps · 13s") that opens the full list.
 */
export function Activity({ thread, rows = 3 }: { thread: Thread; rows?: number }) {
    const steps = thread.steps ?? [];
    const live = thread.status === 'working' || thread.status === 'starting';
    if (live || thread.status === 'waiting') {
        return <LiveActivity thread={thread} steps={steps} rows={rows} live={live} />;
    }
    if (steps.length === 0) return null;
    return <DoneActivity steps={steps} />;
}

function LiveActivity({
    thread,
    steps,
    rows,
    live,
}: {
    thread: Thread;
    steps: ThreadStep[];
    rows: number;
    live: boolean;
}) {
    const started = turnStart(thread, steps);
    const now = useNow(live);
    const top = steps.filter(step => !step.parentId);
    // One row more than fits, so the oldest has somewhere to fade out to.
    const visible = top.slice(-(rows + 1));
    return (
        <div class={`activity${live ? '' : ' activity-waiting'}`}>
            <div class="activity-head">
                <span class={live ? 'live-dot' : 'waiting-dot'} />
                <span class="activity-title">
                    {live ? (
                        <Shimmer text={thread.status === 'starting' ? 'Starting…' : 'Working…'} />
                    ) : (
                        (thread.statusDetail ?? 'Needs your input')
                    )}
                </span>
                {started !== undefined && (
                    <span class="activity-clock">{clock(now - started)}</span>
                )}
                {live && (
                    <button
                        type="button"
                        class="activity-stop"
                        title="Stop"
                        onClick={event => {
                            event.stopPropagation();
                            send({ type: 'thread.interrupt', threadId: thread.id });
                        }}
                    >
                        <StopIcon />
                    </button>
                )}
                {!live && thread.provider.url && (
                    <a
                        class="activity-open"
                        href={thread.provider.url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={event => event.stopPropagation()}
                    >
                        Open
                    </a>
                )}
            </div>
            {visible.length > 0 && <RollingSteps steps={visible} rows={rows} />}
        </div>
    );
}

/**
 * The newest steps, bottom-aligned in a window `rows` high. When a step
 * arrives the list slides up by one row (FLIP) and the oldest fades out
 * under the top mask, so new work reads as a steady scroll, not a jump.
 */
function RollingSteps({ steps, rows }: { steps: ThreadStep[]; rows: number }) {
    const list = useRef<HTMLOListElement>(null);
    const lastId = steps[steps.length - 1]?.id;
    const previous = useRef(lastId);
    useLayoutEffect(() => {
        const element = list.current;
        if (!element || previous.current === lastId) return;
        const grew = previous.current !== undefined;
        previous.current = lastId;
        if (!grew || steps.length <= rows) return;
        element.animate(
            [{ transform: `translateY(${ROW_PITCH}px)` }, { transform: 'translateY(0)' }],
            { duration: 320, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
        );
    }, [lastId]);
    return (
        <div
            class={`activity-window${steps.length > rows ? ' activity-window-full' : ''}`}
            style={{ '--rows': Math.min(rows, steps.length) }}
        >
            <ol ref={list} class="activity-steps">
                {steps.map(step => (
                    <StepRow key={step.id} step={step} />
                ))}
            </ol>
        </div>
    );
}

function StepRow({ step }: { step: ThreadStep }) {
    const Icon = step.kind ? KIND_ICONS[step.kind] : undefined;
    const running = step.status === 'running';
    return (
        <li
            class={`activity-step step-${step.status}${step.parentId ? ' step-child' : ''}`}
            title={step.detail ? `${step.label}\n${step.detail}` : step.label}
        >
            <span class="activity-icon">
                {step.status === 'failed' ? <CloseIcon /> : Icon ? <Icon /> : <span class="dot" />}
            </span>
            <span class="activity-label">
                {running ? <Shimmer text={step.label} /> : step.label}
            </span>
            <span class="activity-time">{running ? '' : duration(step)}</span>
        </li>
    );
}

/** A finished turn: one quiet line, the whole list behind it. */
function DoneActivity({ steps }: { steps: ThreadStep[] }) {
    const [open, setOpen] = useState(false);
    const top = steps.filter(step => !step.parentId);
    const total = elapsed(steps);
    return (
        <div class={`activity activity-done${open ? ' open' : ''}`}>
            <button
                type="button"
                class="activity-summary"
                aria-expanded={open}
                onClick={() => setOpen(!open)}
            >
                <span class="activity-icon activity-check">
                    <CheckIcon />
                </span>
                <span class="activity-label">{summary(top)}</span>
                {total && <span class="activity-time">· {total}</span>}
                <ChevronIcon />
            </button>
            {open && (
                <ol class="activity-steps activity-all">
                    {steps.map(step => (
                        <StepRow key={step.id} step={step} />
                    ))}
                </ol>
            )}
        </div>
    );
}

/** Per-character color wave; screen readers get the plain label. */
export function Shimmer({ text }: { text: string }) {
    const characters = [...text];
    return (
        <span class="shimmer">
            <span class="sr-only">{text}</span>
            {characters.map((character, index) => (
                <span
                    key={index}
                    aria-hidden="true"
                    style={{ '--i': index, '--n': characters.length }}
                >
                    {character}
                </span>
            ))}
        </span>
    );
}

/** Re-render every second while `active`, for a running clock. */
function useNow(active: boolean): number {
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        if (!active) return;
        setNow(Date.now());
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [active]);
    return active ? now : Date.now();
}

/** When this turn began: the latest comment or reply, else its first step. */
function turnStart(thread: Thread, steps: ThreadStep[]): number | undefined {
    const ask = thread.messages.findLast(message => message.role === 'user');
    const at = ask?.createdAt ?? steps[0]?.startedAt;
    return at ? Date.parse(at) : undefined;
}
