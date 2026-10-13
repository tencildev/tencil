import type { Delivery, Thread, ThreadMessage, ThreadStep } from '@tencildev/protocol';
import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { pinBlocked } from '../lib/cloud-auth.ts';
import { providerLabel, send, threads } from '../lib/connection.ts';
import { popoverPosition, resolveAnchor } from '../lib/position.ts';
import { inboxOpen, layoutTick, openThreadId, pinDrag, queuedThreads } from '../lib/state.ts';
import {
    CheckIcon,
    ChevronIcon,
    CloseIcon,
    CodeIcon,
    ExternalIcon,
    StopIcon,
    TrashIcon,
    UndoIcon,
} from './icons.tsx';
import { Markdown } from './markdown.tsx';
import { pinNumbers, sendQueued } from './pins.tsx';
import { PromptInput } from './prompt-input.tsx';

const WIDTH = 380;

export function ThreadPanel() {
    layoutTick.value;
    const id = openThreadId.value;
    const thread = id ? threads.value.get(id) : undefined;
    const ref = useRef<HTMLDivElement>(null);
    const [height, setHeight] = useState(320);

    useLayoutEffect(() => {
        if (ref.current) setHeight(ref.current.offsetHeight);
    });

    if (!thread) return null;
    // Pinned threads float beside their pin (also mid-drag); unpinned ones dock to the right edge.
    const drag = pinDrag.value;
    const point =
        drag?.threadId === thread.id
            ? drag.point
            : thread.anchor
              ? resolveAnchor(thread.anchor)
              : null;
    const placement = point
        ? popoverPosition(point, { width: WIDTH, height })
        : {
              left: window.innerWidth - WIDTH - (inboxOpen.value ? 372 : 16),
              top: 16,
              origin: 'top right',
          };
    const { left, top, origin } = placement;

    return (
        <div
            ref={ref}
            class={`popover thread${point ? '' : ' thread-docked'}`}
            style={{
                left: `${left}px`,
                top: `${top}px`,
                width: `${WIDTH}px`,
                transformOrigin: origin,
            }}
        >
            <Header thread={thread} />
            {thread.status === 'draft' ? (
                <QueuedComment thread={thread} />
            ) : (
                <>
                    <Messages key={thread.id} thread={thread} />
                    <RunStatus key={thread.id} thread={thread} />
                    <PromptInput
                        placeholder={
                            pinBlocked.value ??
                            (thread.provider.threadId ? 'Reply…' : 'Waiting for the agent…')
                        }
                        disabled={!thread.provider.threadId || pinBlocked.value !== null}
                        onSubmit={text => {
                            send({ type: 'thread.reply', threadId: thread.id, text });
                        }}
                        onCancel={() => {
                            openThreadId.value = null;
                        }}
                    />
                </>
            )}
        </div>
    );
}

/** A comment waiting for its batch: rewrite it here, or send the batch. */
function QueuedComment({ thread }: { thread: Thread }) {
    const comment = thread.messages[0]?.text ?? '';
    const count = queuedThreads.value.length;
    return (
        <>
            <div class="status-line status-queued">
                {thread.statusDetail ? (
                    <span class="status-error">Couldn't send: {thread.statusDetail}</span>
                ) : (
                    `Queued with ${count === 1 ? 'no other comments' : `${count - 1} other ${count === 2 ? 'comment' : 'comments'}`}`
                )}
                <button type="button" class="stop" onClick={sendQueued}>
                    Send {count === 1 ? 'it' : `all ${count}`} now
                </button>
            </div>
            <PromptInput
                key={`${thread.id}:${comment}`}
                initialText={comment}
                placeholder="What should change here?"
                onSubmit={text => {
                    if (text !== comment)
                        send({ type: 'thread.edit', threadId: thread.id, prompt: text });
                    openThreadId.value = null;
                }}
                onCancel={() => {
                    openThreadId.value = null;
                }}
            />
        </>
    );
}

function Header({ thread }: { thread: Thread }) {
    const context = thread.context;
    const component = context?.components[0];
    const source = component?.source;
    return (
        <div class="thread-header">
            <div class="thread-heading">
                {context ? (
                    <>
                        <span class="thread-number">#{pinNumbers.value.get(thread.id)}</span>
                        <span class="chip" title={context.selector}>
                            <CodeIcon />
                            {component?.name ?? `<${context.tagName}>`}
                        </span>
                        {source && (
                            <span class="thread-source" title={source.file}>
                                {source.file.split('/').pop()}
                                {source.line ? `:${source.line}` : ''}
                            </span>
                        )}
                    </>
                ) : (
                    <span class="thread-title" title={thread.title}>
                        {thread.title}
                    </span>
                )}
            </div>
            <div class="thread-tools">
                {thread.provider.url && (
                    <a
                        class="icon-button"
                        href={thread.provider.url}
                        target="_blank"
                        rel="noreferrer"
                        title={`Open in ${providerLabel(thread.provider.id)}`}
                    >
                        <ExternalIcon />
                    </a>
                )}
                {thread.status !== 'draft' && (
                    <button
                        type="button"
                        class="icon-button"
                        title={thread.resolved ? 'Reopen' : 'Resolve'}
                        onClick={() => {
                            send({
                                type: 'thread.resolve',
                                threadId: thread.id,
                                resolved: !thread.resolved,
                            });
                            // Resolving is the last step; reopening means more to do here.
                            if (!thread.resolved) openThreadId.value = null;
                        }}
                    >
                        {thread.resolved ? <UndoIcon /> : <CheckIcon />}
                    </button>
                )}
                <button
                    type="button"
                    class="icon-button"
                    title="Delete pin (keeps the agent thread)"
                    onClick={() => {
                        send({ type: 'thread.delete', threadId: thread.id });
                        openThreadId.value = null;
                    }}
                >
                    <TrashIcon />
                </button>
                <button
                    type="button"
                    class="icon-button"
                    title="Close (Esc)"
                    onClick={() => {
                        openThreadId.value = null;
                    }}
                >
                    <CloseIcon />
                </button>
            </div>
        </div>
    );
}

function Messages({ thread }: { thread: Thread }) {
    const ref = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    /** Follow new output until the user scrolls up to read. */
    const following = useRef(true);
    const [scrolled, setScrolled] = useState(false);
    const last = thread.messages[thread.messages.length - 1];

    // Sending a reply brings the conversation back to the bottom.
    useLayoutEffect(() => {
        if (last?.role === 'user') following.current = true;
    }, [last?.id]);

    // Open at the latest message and stay there while answers stream, render and animate in.
    useLayoutEffect(() => {
        const element = ref.current;
        const list = listRef.current;
        if (!element || !list) return;
        const follow = () => {
            if (following.current) element.scrollTop = element.scrollHeight;
        };
        follow();
        const observer = new ResizeObserver(follow);
        observer.observe(element);
        observer.observe(list);
        return () => observer.disconnect();
    }, []);

    return (
        <div
            ref={ref}
            class="messages"
            data-scrolled={scrolled || undefined}
            onScroll={event => {
                const element = event.currentTarget;
                following.current =
                    element.scrollHeight - element.scrollTop - element.clientHeight < 24;
                setScrolled(element.scrollTop > 4);
            }}
        >
            <div ref={listRef} class="messages-list">
                {thread.messages.map(message =>
                    message.role === 'user' ? (
                        <div key={message.id} class="message message-user">
                            {message.text}
                        </div>
                    ) : (
                        <AssistantMessage key={message.id} message={message} />
                    ),
                )}
            </div>
        </div>
    );
}

/** Only messages that were streaming when they mounted animate; history renders still. */
function AssistantMessage({ message }: { message: ThreadMessage }) {
    const [animate] = useState(message.streaming);
    return (
        <div class="message message-assistant">
            <Markdown text={message.text} animate={animate} />
        </div>
    );
}

/** Per-character color wave; screen readers get the plain label. */
function Shimmer({ text }: { text: string }) {
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

/** The status line, and the turn's steps behind it when the provider reports them. */
function RunStatus({ thread }: { thread: Thread }) {
    const [open, setOpen] = useState(false);
    const steps = thread.steps ?? [];
    const toggle = steps.length > 0 ? { open, onToggle: () => setOpen(!open) } : undefined;
    const working = thread.status === 'working';
    return (
        <>
            {open && steps.length > 0 && <StepList steps={steps} follow={working} />}
            <StatusLine thread={thread} steps={toggle} />
            {toggle && !working && (
                <div class="status-line">
                    <StepsToggle {...toggle}>
                        {steps.filter(step => !step.parentId).length} steps
                        {elapsed(steps) ? ` · ${elapsed(steps)}` : ''}
                    </StepsToggle>
                </div>
            )}
            {thread.delivery && !working && <DeliveryLine delivery={thread.delivery} />}
        </>
    );
}

interface Toggle {
    open: boolean;
    onToggle: () => void;
}

function StepsToggle({ open, onToggle, children }: Toggle & { children: ComponentChildren }) {
    return (
        <button
            type="button"
            class={`steps-toggle${open ? ' open' : ''}`}
            aria-expanded={open}
            title={open ? 'Hide steps' : 'Show steps'}
            onClick={onToggle}
        >
            {children}
            <ChevronIcon />
        </button>
    );
}

function StepList({ steps, follow }: { steps: ThreadStep[]; follow: boolean }) {
    const ref = useRef<HTMLOListElement>(null);
    const atEnd = useRef(true);
    // Stay at the newest step while it's working, unless the user scrolled up.
    useLayoutEffect(() => {
        const element = ref.current;
        if (element && follow && atEnd.current) element.scrollTop = element.scrollHeight;
    });
    return (
        <ol
            ref={ref}
            class="steps"
            onScroll={event => {
                const element = event.currentTarget;
                atEnd.current =
                    element.scrollHeight - element.scrollTop - element.clientHeight < 16;
            }}
        >
            {steps.map(step => (
                <li
                    key={step.id}
                    class={`step step-${step.status}${step.parentId ? ' step-child' : ''}`}
                    title={step.detail ? `${step.label}\n${step.detail}` : step.label}
                >
                    <span class="step-mark">
                        {step.status === 'running' ? (
                            <span class="live-dot" />
                        ) : step.status === 'done' ? (
                            <CheckIcon />
                        ) : step.status === 'failed' ? (
                            <CloseIcon />
                        ) : (
                            '–'
                        )}
                    </span>
                    <span class="step-label">
                        {step.label}
                        {step.detail && <span class="step-detail">{step.detail}</span>}
                    </span>
                    {step.endedAt && <span class="step-time">{duration(step)}</span>}
                </li>
            ))}
        </ol>
    );
}

/** The step being worked on: the newest one still running (a tool call over the agent). */
function currentStep(steps: ThreadStep[]): ThreadStep | undefined {
    return steps.findLast(step => step.status === 'running');
}

function duration(step: ThreadStep): string {
    if (!step.endedAt) return '';
    return formatSeconds((Date.parse(step.endedAt) - Date.parse(step.startedAt)) / 1000);
}

/** From the first step's start to the last one's end. */
function elapsed(steps: ThreadStep[]): string {
    const first = steps[0];
    const ends = steps.map(step => step.endedAt).filter((end): end is string => !!end);
    if (!first || ends.length === 0) return '';
    const last = ends.reduce((a, b) => (a > b ? a : b));
    return formatSeconds((Date.parse(last) - Date.parse(first.startedAt)) / 1000);
}

function formatSeconds(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 1) return '';
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ${String(Math.round(seconds % 60)).padStart(2, '0')}s`;
}

function StatusLine({ thread, steps }: { thread: Thread; steps?: Toggle }) {
    if (thread.status === 'starting') {
        return (
            <div class="status-line">
                <span class="live-dot" />
                <Shimmer text={`Starting a thread in ${providerLabel(thread.provider.id)}…`} />
            </div>
        );
    }
    if (thread.status === 'working') {
        return (
            <div class="status-line">
                <span class="live-dot" />
                {steps ? (
                    <StepsToggle {...steps}>
                        <Shimmer text={`${currentStep(thread.steps ?? [])?.label ?? 'Working'}…`} />
                    </StepsToggle>
                ) : (
                    <Shimmer text="Working…" />
                )}
                <button
                    type="button"
                    class="stop"
                    onClick={() => send({ type: 'thread.interrupt', threadId: thread.id })}
                >
                    <StopIcon /> Stop
                </button>
            </div>
        );
    }
    if (thread.status === 'waiting') {
        return (
            <div class="status-line status-waiting">
                {thread.statusDetail ?? 'Waiting for input'}
                {thread.provider.url && (
                    <a href={thread.provider.url} target="_blank" rel="noreferrer">
                        Open
                    </a>
                )}
            </div>
        );
    }
    if (thread.status === 'error') {
        return (
            <div class="status-line status-error">
                {thread.statusDetail ?? 'Something went wrong'}
            </div>
        );
    }
    return null;
}

/** Tencil Cloud: where the change is between the agent and the redeployed preview. */
export function DeliveryLine({ delivery }: { delivery: Delivery }) {
    const pr = delivery.pullRequest;
    const prLink = pr && (
        <a href={pr.url} target="_blank" rel="noreferrer">
            {pr.opened ? `Opened #${pr.number}` : `#${pr.number}`}
        </a>
    );
    const commit = delivery.commit && (
        <a class="delivery-commit" href={delivery.commit.url} target="_blank" rel="noreferrer">
            {delivery.commit.sha.slice(0, 7)}
        </a>
    );
    switch (delivery.status) {
        case 'queued':
            return (
                <div class="status-line delivery">
                    <span class="live-dot" />
                    <Shimmer
                        text={
                            delivery.queuePosition
                                ? `Waiting, ${delivery.queuePosition} ahead on this branch`
                                : 'Waiting for the branch…'
                        }
                    />
                </div>
            );
        case 'pushed':
            return (
                <div class="status-line delivery">
                    <span>Pushed {commit}</span>
                    {prLink}
                </div>
            );
        case 'deploying':
            return (
                <div class="status-line delivery">
                    <span class="live-dot" />
                    <Shimmer text="Deploying the preview…" />
                    {prLink}
                </div>
            );
        case 'live':
            return (
                <div class="status-line delivery delivery-live">
                    <span>Live {commit}</span>
                    {delivery.previewUrl ? (
                        // Same tab: the new preview shows the same pins.
                        <a href={delivery.previewUrl}>Open the new preview</a>
                    ) : (
                        prLink
                    )}
                </div>
            );
        case 'deploy-failed':
            return (
                <div class="status-line delivery status-error">
                    <span>Preview deploy failed {commit}</span>
                    {delivery.logsUrl ? (
                        <a href={delivery.logsUrl} target="_blank" rel="noreferrer">
                            Logs
                        </a>
                    ) : (
                        prLink
                    )}
                </div>
            );
        case 'no-changes':
            return <div class="status-line delivery">No changes needed, nothing pushed</div>;
        case 'failed':
            return (
                <div class="status-line delivery status-error">
                    <span class="delivery-detail" title={delivery.detail}>
                        Couldn't push{delivery.detail ? `: ${delivery.detail}` : ''}
                    </span>
                    {prLink}
                </div>
            );
    }
}
