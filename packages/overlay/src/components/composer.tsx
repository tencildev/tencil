import { signal } from '@preact/signals';
import type {
    ElementContext,
    ImageAttachment,
    ProviderThreadSummary,
    Thread,
} from '@tencildev/protocol';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import {
    provider,
    providerModels,
    providerThreads,
    refreshProviderModels,
    refreshProviderThreads,
    refreshThreadModels,
    send,
    settings,
    threadModels,
    threadModelsKey,
    threads,
    upsertLocal,
} from '../lib/connection.ts';
import { buildSelector } from '../lib/element-context.ts';
import { newId } from '../lib/id.ts';
import { boxOf, measureBetween, toSpacing } from '../lib/measure.ts';
import { getHost } from '../lib/overlay-host.ts';
import { popoverPosition, resolveAnchor } from '../lib/position.ts';
import { captureElement } from '../lib/screenshot.ts';
import {
    batchAvailable,
    batchMode,
    batchToggle,
    type Draft,
    draft,
    layoutTick,
    openThreadId,
    queuedThreads,
    rulerOn,
    startPicking,
} from '../lib/state.ts';
import { AgentIcon } from './agent-icons.tsx';
import { CameraIcon, ChevronIcon, CloseIcon, CodeIcon, LayersIcon } from './icons.tsx';
import { timeAgo } from './inbox.tsx';
import { type ModelChoices, ModelMenu, ModelToggle } from './model-menu.tsx';
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
    const [withScreenshot, setWithScreenshot] = useState(false);
    const [busy, setBusy] = useState(false);
    const [menu, setMenu] = useState<'target' | 'model' | null>(null);
    /** A model picked for the continued thread, sent with this comment. */
    const [threadModel, setThreadModel] = useState<string | null>(null);

    const providerReady = provider.value?.state === 'ready';
    const providerId = provider.value?.id;
    useEffect(() => {
        if (!pending || !providerReady) return;
        refreshProviderThreads();
        refreshProviderModels();
    }, [pending, providerReady, providerId]);
    // A thread picked from the previous provider's list can't take the pin.
    useEffect(() => {
        composerTarget.value = null;
    }, [providerId]);
    // A batch always starts its own thread.
    const existing = batchMode.value ? null : composerTarget.value;
    // Another thread, or the next comment, starts from what that thread runs on.
    useEffect(() => {
        setThreadModel(null);
        if (existing && pending && providerReady) {
            refreshThreadModels({ providerThreadId: existing.id });
        }
    }, [existing?.id, pending, providerReady]);

    useLayoutEffect(() => {
        if (ref.current) setHeight(ref.current.offsetHeight);
    });

    if (!pending) return null;
    const point = resolveAnchor(pending.anchor, pending.element);
    if (!point) return null;
    const { left, top, origin } = popoverPosition(point, { width: WIDTH, height });
    const target = provider.value;
    const ready = target?.state === 'ready';
    const batching = batchMode.value;
    const models = existing
        ? continuedModelChoices(target?.id, existing.id, threadModel)
        : modelChoices(target?.id);
    // Only a change goes with the comment; the thread otherwise keeps its model.
    const switchTo =
        existing &&
        threadModel &&
        threadModel !== continuedModelChoices(target?.id, existing.id, null)?.current?.id
            ? threadModel
            : null;

    const submit = async (prompt: string) => {
        setBusy(true);
        try {
            const context = withSpacing(await pending.context, pending);
            const attachments: ImageAttachment[] = [];
            if (withScreenshot) {
                const shot = await captureElement(pending.element, getHost());
                if (shot) attachments.push(shot);
            }
            const id = newId();
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
                ...(existing && switchTo ? { model: switchTo } : {}),
                ...(batching ? { draft: true } : {}),
            });
            if (!ok) return;
            const now = new Date().toISOString();
            const optimistic: Thread = {
                id,
                title: prompt,
                pageUrl: location.href,
                anchor,
                context,
                status: batching ? 'draft' : existing ? 'working' : 'starting',
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
            // Queued: straight on to the next element.
            if (batching) startPicking();
            else openThreadId.value = id;
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
                {target && batching && (
                    <span class="composer-provider composer-batch">
                        → Batch · {queuedThreads.value.length} queued
                    </span>
                )}
                {target && !batching && (
                    <button
                        type="button"
                        class={`composer-provider${menu === 'target' ? ' open' : ''}`}
                        onClick={() => setMenu(menu === 'target' ? null : 'target')}
                        title="Send to a new thread or continue an existing one"
                    >
                        <span class="composer-provider-label">
                            → {existing ? existing.title : `New ${target.label} thread`}
                        </span>
                        <ChevronIcon />
                    </button>
                )}
            </div>
            {pending.measuredTo && rulerOn.value && <MeasuredTo pending={pending} />}
            {menu === 'target' && !batching && (
                <TargetMenu
                    onPick={summary => {
                        composerTarget.value = summary;
                        setMenu(null);
                    }}
                />
            )}
            {menu === 'model' && models && (
                <ModelMenu
                    choices={models}
                    withDefault={!existing}
                    onPick={model => {
                        if (existing) setThreadModel(model);
                        else send({ type: 'model.select', model });
                        setMenu(null);
                    }}
                />
            )}
            <PromptInput
                placeholder={
                    batching
                        ? 'Add a comment to the batch…'
                        : !ready
                          ? 'Waiting for the agent connection…'
                          : existing
                            ? 'Continue the thread with this element…'
                            : 'What should change here?'
                }
                autoFocus
                busy={busy}
                // Queued comments don't need the agent until the batch is sent.
                disabled={!ready && !batching}
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
                {batchAvailable.value && (
                    <button
                        type="button"
                        class={`toggle${batching ? ' toggle-on' : ''}`}
                        onClick={() => {
                            batchToggle.value = !batching;
                            setMenu(null);
                        }}
                        title={
                            batching
                                ? 'Batch on: comments are queued and sent together'
                                : 'Queue comments and send them together'
                        }
                        aria-label="Batch"
                        aria-pressed={batching}
                    >
                        <LayersIcon />
                    </button>
                )}
                {models && (
                    <ModelToggle
                        choices={models}
                        open={menu === 'model'}
                        onToggle={() => setMenu(menu === 'model' ? null : 'model')}
                        title={
                            existing
                                ? 'Model for the rest of this thread'
                                : 'Agent and model for the new thread'
                        }
                    />
                )}
            </PromptInput>
            {!ready && target?.detail && <p class="hint">{target.detail}</p>}
        </div>
    );
}

const SIDE_WORDS = { top: 'above', right: 'right', bottom: 'below', left: 'left' };

/** The spacing measured with Alt, shown so it's clear what goes along with the comment. */
function MeasuredTo({ pending }: { pending: Draft }) {
    const measured = pending.measuredTo!;
    const spacing = spacingFor(pending);
    const values = (['top', 'right', 'bottom', 'left'] as const)
        .filter(side => spacing?.[side] !== undefined)
        .map(side => `${spacing![side]} ${SIDE_WORDS[side]}`);
    return (
        <div class="composer-measure">
            <span
                class="composer-measure-label"
                title={`Spacing to ${measured.label}: ${values.join(', ') || 'none'}`}
            >
                ↔ {measured.parent ? 'Parent ' : ''}
                <span class="composer-measure-target">{measured.label}</span>
                {values.length > 0 && ` · ${values.join(', ')}`}
            </span>
            <button
                type="button"
                class="icon-button"
                title="Don't send the spacing"
                aria-label="Remove spacing"
                onClick={() => {
                    if (draft.value) draft.value = { ...draft.value, measuredTo: undefined };
                }}
            >
                <CloseIcon />
            </button>
        </div>
    );
}

/** Measured now, so the agent gets the layout as it is when the comment is sent. */
function spacingFor(pending: Draft): ElementContext['spacing'] {
    const measured = pending.measuredTo;
    // Turning the ruler off drops what was measured.
    if (
        !measured ||
        !rulerOn.value ||
        !pending.element.isConnected ||
        !measured.element.isConnected
    )
        return;
    const guides = measureBetween(
        boxOf(pending.element.getBoundingClientRect()),
        boxOf(measured.element.getBoundingClientRect()),
    );
    return toSpacing(guides, {
        to: measured.label,
        selector: buildSelector(measured.element),
        ...(measured.parent ? { parent: true } : {}),
    });
}

function withSpacing(context: ElementContext, pending: Draft): ElementContext {
    const spacing = spacingFor(pending);
    return spacing ? { ...context, spacing } : context;
}

function modelChoices(providerId: string | undefined): ModelChoices | undefined {
    const list = providerModels.value;
    if (!list || list.provider !== providerId || list.models.length === 0) return undefined;
    const find = (id: string | undefined) => list.models.find(model => model.id === id);
    // A pick whose agent went away falls back to the default, here and in the provider.
    const picked = find(settings.value?.model);
    const fallback = find(list.defaultModel);
    return {
        models: list.models,
        current: picked ?? fallback,
        picked: picked?.id ?? null,
        fallback,
    };
}

/** What a continued thread can switch to; it runs on what a pin last picked, else its own. */
function continuedModelChoices(
    providerId: string | undefined,
    providerThreadId: string,
    picked: string | null,
): ModelChoices | undefined {
    if (!providerId) return undefined;
    const list = threadModels.value.get(threadModelsKey(providerId, providerThreadId));
    // One model is nothing to switch to.
    if (!list || list.models.length < 2) return undefined;
    const pinned = [...threads.value.values()].find(
        thread =>
            thread.provider.id === providerId &&
            thread.provider.threadId === providerThreadId &&
            thread.model,
    )?.model;
    const find = (id: string | null | undefined) => list.models.find(model => model.id === id);
    const current = find(picked) ?? find(pinned) ?? find(list.current);
    return { models: list.models, current, picked: current?.id ?? null };
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
