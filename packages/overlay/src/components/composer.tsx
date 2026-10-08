import type { ImageAttachment, ProviderThreadSummary, Thread } from '@fixhere/protocol';
import { signal } from '@preact/signals';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import {
    provider,
    providerThreads,
    refreshProviderThreads,
    send,
    upsertLocal,
} from '../lib/connection.ts';
import { getHost } from '../lib/overlay-host.ts';
import { popoverPosition, resolveAnchor } from '../lib/position.ts';
import { captureElement } from '../lib/screenshot.ts';
import { draft, layoutTick, openThreadId } from '../lib/state.ts';
import { AgentIcon } from './agent-icons.tsx';
import { CameraIcon, ChevronIcon, CodeIcon } from './icons.tsx';
import { timeAgo } from './inbox.tsx';
import { PromptInput } from './prompt-input.tsx';

const WIDTH = 340;

/**
 * Where new pins go: a fresh thread (null) or an existing one. Sticky across
 * pins so a review session can keep feeding the same conversation.
 */
const composerTarget = signal<ProviderThreadSummary | null>(null);

export function Composer() {
    layoutTick.value;
    const pending = draft.value;
    const ref = useRef<HTMLDivElement>(null);
    const [height, setHeight] = useState(140);
    const [withScreenshot, setWithScreenshot] = useState(true);
    const [busy, setBusy] = useState(false);
    const [picking, setPicking] = useState(false);

    const providerReady = provider.value?.state === 'ready';
    useEffect(() => {
        if (pending && providerReady) refreshProviderThreads();
    }, [pending, providerReady]);

    useLayoutEffect(() => {
        if (ref.current) setHeight(ref.current.offsetHeight);
    });

    if (!pending) return null;
    const point = resolveAnchor(pending.anchor, pending.element);
    if (!point) return null;
    const { left, top, origin } = popoverPosition(point, { width: WIDTH, height });
    const target = provider.value;
    const ready = target?.state === 'ready';
    const existing = composerTarget.value;

    const submit = async (prompt: string) => {
        setBusy(true);
        try {
            const context = await pending.context;
            const attachments: ImageAttachment[] = [];
            if (withScreenshot) {
                const shot = await captureElement(pending.element, getHost());
                if (shot) attachments.push(shot);
            }
            const id = crypto.randomUUID();
            const anchor = { ...pending.anchor, selector: context.selector };
            const ok = send({
                type: 'thread.create',
                id,
                pageUrl: location.href,
                prompt,
                anchor,
                context,
                attachments,
                ...(existing ? { providerThreadId: existing.id } : {}),
            });
            if (!ok) return;
            const now = new Date().toISOString();
            const optimistic: Thread = {
                id,
                title: prompt,
                pageUrl: location.href,
                anchor,
                context,
                status: existing ? 'working' : 'starting',
                resolved: false,
                messages: [
                    {
                        id: `local:${id}`,
                        role: 'user',
                        text: prompt,
                        streaming: false,
                        createdAt: now,
                    },
                ],
                provider: {
                    id: target?.id ?? 'unknown',
                    ...(existing ? { threadId: existing.id, url: existing.url } : {}),
                },
                createdAt: now,
                updatedAt: now,
            };
            upsertLocal(optimistic);
            draft.value = null;
            openThreadId.value = id;
        } finally {
            setBusy(false);
        }
    };

    return (
        <div
            ref={ref}
            class="popover composer"
            style={{
                left: `${left}px`,
                top: `${top}px`,
                width: `${WIDTH}px`,
                transformOrigin: origin,
            }}
        >
            <div class="composer-target">
                <span class="chip">
                    <CodeIcon />
                    {pending.label}
                </span>
                {target && (
                    <button
                        type="button"
                        class={`composer-provider${picking ? ' open' : ''}`}
                        onClick={() => setPicking(!picking)}
                        title="Send to a new thread or continue an existing one"
                    >
                        <span class="composer-provider-label">
                            → {existing ? existing.title : `New ${target.label} thread`}
                        </span>
                        <ChevronIcon />
                    </button>
                )}
            </div>
            {picking && (
                <TargetMenu
                    onPick={summary => {
                        composerTarget.value = summary;
                        setPicking(false);
                    }}
                />
            )}
            <PromptInput
                placeholder={
                    !ready
                        ? 'Waiting for the agent connection…'
                        : existing
                          ? 'Continue the thread with this element…'
                          : 'What should change here?'
                }
                autoFocus
                busy={busy}
                disabled={!ready}
                onSubmit={submit}
                onCancel={() => {
                    draft.value = null;
                }}
            >
                <button
                    type="button"
                    class={`toggle${withScreenshot ? ' toggle-on' : ''}`}
                    onClick={() => setWithScreenshot(!withScreenshot)}
                    title={withScreenshot ? 'Screenshot attached' : 'No screenshot'}
                    aria-pressed={withScreenshot}
                >
                    <CameraIcon />
                </button>
            </PromptInput>
            {!ready && target?.detail && <p class="hint">{target.detail}</p>}
        </div>
    );
}

function TargetMenu({ onPick }: { onPick: (summary: ProviderThreadSummary | null) => void }) {
    const list = providerThreads.value;
    const current = composerTarget.value?.id ?? null;
    return (
        <div class="target-menu" role="listbox">
            <button
                type="button"
                role="option"
                aria-selected={current === null}
                class={`target-option${current === null ? ' selected' : ''}`}
                onClick={() => onPick(null)}
            >
                <span class="target-option-title">New thread</span>
            </button>
            {list === null && <p class="target-empty">Loading threads…</p>}
            {list?.map(summary => (
                <button
                    key={summary.id}
                    type="button"
                    role="option"
                    aria-selected={current === summary.id}
                    class={`target-option${current === summary.id ? ' selected' : ''}`}
                    onClick={() => onPick(summary)}
                >
                    <span class={`thread-dot thread-dot-${summary.status}`} />
                    <span class="target-option-title">{summary.title}</span>
                    <AgentIcon agent={summary.agent} size={12} />
                    <span class="target-option-meta">{timeAgo(summary.updatedAt)}</span>
                </button>
            ))}
        </div>
    );
}
