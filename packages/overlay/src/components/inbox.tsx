import type { ProviderProject, ProviderThreadSummary, Thread } from '@tencil/protocol';
import { useEffect, useState } from 'preact/hooks';
import {
    bridgeState,
    openProviderThread,
    provider,
    providerProject,
    providerThreads,
    refreshProviderThreads,
    threads,
} from '../lib/connection.ts';
import {
    currentPage,
    inboxOpen,
    openThreadId,
    pageKey,
    showResolved,
    sortedThreads,
} from '../lib/state.ts';
import { AgentIcon } from './agent-icons.tsx';
import { CloseIcon } from './icons.tsx';
import { pinNumbers, pinVariant } from './pins.tsx';

/** Survives the full reload when jumping to a pin on another page. */
export const PENDING_OPEN_KEY = 'tencil:open';

type Scope = 'page' | 'all' | 'provider';

export function Inbox() {
    const [scope, setScope] = useState<Scope>('page');
    const label = provider.value?.label ?? 'Agent';

    const ready = bridgeState.value === 'open' && provider.value?.state === 'ready';
    const providerId = provider.value?.id;
    // Re-request once the bridge or provider (re)connects, or the project switches provider.
    useEffect(() => {
        if (ready && inboxOpen.value && scope === 'provider') refreshProviderThreads();
    }, [scope, inboxOpen.value, ready, providerId]);

    if (!inboxOpen.value) return null;

    return (
        <aside class="inbox">
            <header class="inbox-header">
                <div class="segmented">
                    <button
                        type="button"
                        class={scope === 'page' ? 'active' : ''}
                        onClick={() => setScope('page')}
                    >
                        This page
                    </button>
                    <button
                        type="button"
                        class={scope === 'all' ? 'active' : ''}
                        onClick={() => setScope('all')}
                    >
                        All pins
                    </button>
                    <button
                        type="button"
                        class={scope === 'provider' ? 'active' : ''}
                        onClick={() => setScope('provider')}
                    >
                        {label}
                    </button>
                </div>
                <button
                    type="button"
                    class="icon-button"
                    title="Close"
                    onClick={() => {
                        inboxOpen.value = false;
                    }}
                >
                    <CloseIcon />
                </button>
            </header>
            {scope === 'provider' ? <ProviderList label={label} /> : <PinList scope={scope} />}
        </aside>
    );
}

function PinList({ scope }: { scope: 'page' | 'all' }) {
    const list = sortedThreads.value
        .filter(thread => showResolved.value || !thread.resolved)
        .filter(
            thread =>
                scope === 'all' ||
                (thread.anchor && thread.pageUrl && pageKey(thread.pageUrl) === currentPage.value),
        );
    return (
        <>
            <label class="inbox-filter">
                <input
                    type="checkbox"
                    checked={showResolved.value}
                    onChange={event => {
                        showResolved.value = (event.target as HTMLInputElement).checked;
                    }}
                />
                Show resolved
            </label>
            <div class="inbox-list">
                {list.length === 0 ? (
                    <p class="empty">
                        No pins yet. Press <kbd>C</kbd> and click anything on the page.
                    </p>
                ) : (
                    list.map(thread => <InboxItem key={thread.id} thread={thread} />)
                )}
            </div>
        </>
    );
}

/** Every thread the provider has for this project, so existing work can continue here. */
function ProviderList({ label }: { label: string }) {
    const list = providerThreads.value;
    if (!list) {
        return <p class="empty">Loading {label} threads…</p>;
    }
    if (list.length === 0) {
        return <p class="empty">No {label} threads in this project yet.</p>;
    }
    return (
        <div class="inbox-list inbox-list-provider">
            {list.map(summary => (
                <ProviderItem key={summary.id} summary={summary} />
            ))}
        </div>
    );
}

/** Mirrors a row in T3 Code's sidebar: project, title, then branch / PR / agent. */
function ProviderItem({ summary }: { summary: ProviderThreadSummary }) {
    const project = providerProject.value;
    const pins = [...threads.value.values()].filter(
        thread => thread.provider.threadId === summary.id && thread.anchor,
    ).length;
    const open = () => {
        const id = openProviderThread(summary);
        if (id) openThreadId.value = id;
    };
    return (
        <button type="button" class="inbox-item provider-item" onClick={open}>
            <span class="provider-item-project">
                {project && <ProjectIcon project={project} />}
                <span class="provider-item-project-name">{project?.name}</span>
                {summary.status === 'working' || summary.status === 'waiting' ? (
                    <span class={`provider-item-state state-${summary.status}`}>
                        {summaryLabel(summary.status)}
                    </span>
                ) : summary.background === 'monitoring' ? (
                    <span class="provider-item-state state-monitoring">Monitoring</span>
                ) : (
                    <span class="provider-item-time">{timeAgo(summary.updatedAt)}</span>
                )}
            </span>
            <span class="provider-item-title">{summary.title}</span>
            {(summary.branch || summary.pullRequest || summary.agent || pins > 0) && (
                <span class="provider-item-meta">
                    {summary.branch && <span class="provider-item-branch">{summary.branch}</span>}
                    {summary.pullRequest && (
                        <span class="provider-item-pr">#{summary.pullRequest.number}</span>
                    )}
                    {pins > 0 && (
                        <span class="provider-item-pins">
                            {pins} pin{pins === 1 ? '' : 's'}
                        </span>
                    )}
                    <AgentIcon agent={summary.agent} />
                </span>
            )}
        </button>
    );
}

export function ProjectIcon({ project }: { project: ProviderProject }) {
    if (project.emoji) return <span class="project-icon project-icon-emoji">{project.emoji}</span>;
    if (project.iconUrl) return <img class="project-icon" src={project.iconUrl} alt="" />;
    return <span class="project-icon project-icon-letter">{project.name.slice(0, 1)}</span>;
}

function InboxItem({ thread }: { thread: Thread }) {
    const pinned = Boolean(thread.anchor && thread.pageUrl);
    const samePage = !pinned || pageKey(thread.pageUrl!) === currentPage.value;
    const last = [...thread.messages].reverse().find(message => message.role === 'assistant');
    const open = () => {
        if (!samePage) {
            sessionStorage.setItem(PENDING_OPEN_KEY, thread.id);
            location.href = thread.pageUrl!;
            return;
        }
        openThreadId.value = thread.id;
        revealAnchor(thread);
    };
    return (
        <button
            type="button"
            class={`inbox-item${openThreadId.value === thread.id ? ' active' : ''}`}
            onClick={open}
        >
            {pinned ? (
                <span class={`pin pin-static pin-${pinVariant(thread)}`}>
                    <span class="pin-body">{pinNumbers.value.get(thread.id)}</span>
                </span>
            ) : (
                <span class={`thread-dot thread-dot-${thread.status}`} />
            )}
            <span class="inbox-item-body">
                <span class="inbox-item-title">{thread.title}</span>
                <span class="inbox-item-meta">
                    {!pinned && <span>Not pinned · </span>}
                    {pinned && !samePage && <span>{new URL(thread.pageUrl!).pathname} · </span>}
                    {statusLabel(thread)} · {timeAgo(thread.updatedAt)}
                </span>
                {last && <span class="inbox-item-preview">{last.text.slice(0, 140)}</span>}
            </span>
        </button>
    );
}

export function revealAnchor(thread: Thread): void {
    if (!thread.anchor) return;
    try {
        document
            .querySelector(thread.anchor.selector)
            ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } catch {
        // Invalid selector from an older page version; the panel still opens.
    }
}

function statusLabel(thread: Thread): string {
    if (thread.resolved) return 'Resolved';
    switch (thread.status) {
        case 'starting':
            return 'Starting';
        case 'working':
            return 'Working';
        case 'waiting':
            return 'Needs input';
        case 'error':
            return 'Error';
        default:
            return 'Done';
    }
}

export function summaryLabel(status: ProviderThreadSummary['status']): string {
    switch (status) {
        case 'working':
            return 'Working';
        case 'waiting':
            return 'Needs input';
        case 'error':
            return 'Error';
        default:
            return 'Idle';
    }
}

export function timeAgo(iso: string): string {
    const seconds = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86_400)}d ago`;
}
