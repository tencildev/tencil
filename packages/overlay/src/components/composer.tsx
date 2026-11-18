import { signal } from '@preact/signals';
import type {
    ElementContext,
    ImageAttachment,
    ProviderMachine,
    ProviderModel,
    ProviderThreadSummary,
    Thread,
} from '@tencildev/protocol';
import { Fragment } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import {
    provider,
    providerMachines,
    providerModels,
    providerThreads,
    refreshProviderMachines,
    refreshProviderModels,
    refreshProviderThreads,
    send,
    settings,
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
import { CameraIcon, ChevronIcon, CloseIcon, CodeIcon, LayersIcon, MachineIcon } from './icons.tsx';
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
    const [withScreenshot, setWithScreenshot] = useState(false);
    const [busy, setBusy] = useState(false);
    const [menu, setMenu] = useState<'target' | 'model' | 'machine' | null>(null);

    const providerReady = provider.value?.state === 'ready';
    const providerId = provider.value?.id;
    useEffect(() => {
        if (!pending || !providerReady) return;
        refreshProviderThreads();
        refreshProviderModels();
        refreshProviderMachines();
    }, [pending, providerReady, providerId]);
    // A thread picked from the previous provider's list can't take the pin.
    useEffect(() => {
        composerTarget.value = null;
    }, [providerId]);

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
    // A batch always starts its own thread.
    const existing = batching ? null : composerTarget.value;
    // A continued thread keeps its own machine and model; only new threads can pick them.
    const machines = existing ? undefined : machineChoices(target?.id);
    // Models are this machine's; another machine runs its project's default.
    const elsewhere = machines?.current && machines.current.id !== machines.fallback?.id;
    const models = existing || elsewhere ? undefined : modelChoices(target?.id);

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
            {menu === 'machine' && machines && (
                <MachineMenu
                    choices={machines}
                    onPick={machine => {
                        send({ type: 'machine.select', machine });
                        setMenu(null);
                    }}
                />
            )}
            {menu === 'model' && models && (
                <ModelMenu
                    choices={models}
                    onPick={model => {
                        send({ type: 'model.select', model });
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
                {machines && (
                    <button
                        type="button"
                        class={`toggle machine-toggle${menu === 'machine' ? ' open' : ''}`}
                        onClick={() => setMenu(menu === 'machine' ? null : 'machine')}
                        title="Machine the new thread runs on"
                    >
                        <MachineIcon />
                        <span class="model-toggle-label">
                            {machines.current?.label ?? 'This machine'}
                        </span>
                        <ChevronIcon />
                    </button>
                )}
                {models && (
                    <button
                        type="button"
                        class={`toggle model-toggle${menu === 'model' ? ' open' : ''}`}
                        onClick={() => setMenu(menu === 'model' ? null : 'model')}
                        title="Agent and model for the new thread"
                    >
                        <AgentIcon agent={models.current?.agent} size={12} />
                        <span class="model-toggle-label">
                            {models.current?.label ?? 'Default model'}
                        </span>
                        <ChevronIcon />
                    </button>
                )}
            </PromptInput>
            {!ready && target?.detail && <p class="hint">{target.detail}</p>}
            {elsewhere && !batching && (
                <p class="hint">
                    Runs in this repository on {machines?.current?.label}, with its default model.
                    Screenshots stay here.
                </p>
            )}
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

interface ModelChoices {
    models: ProviderModel[];
    /** The model new threads run on: the picked one, else the provider's default. */
    current?: ProviderModel;
    picked: string | null;
    fallback?: ProviderModel;
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

interface MachineChoices {
    machines: ProviderMachine[];
    /** The machine new threads run on: the picked one, else the provider's default. */
    current?: ProviderMachine;
    picked: string | null;
    fallback?: ProviderMachine;
}

/**
 * Offered when there's more than one machine, or when a machine is still picked
 * that's gone: new threads fail rather than run elsewhere, so it must stay changeable.
 */
function machineChoices(providerId: string | undefined): MachineChoices | undefined {
    const list = providerMachines.value;
    if (!list || list.provider !== providerId || list.machines.length === 0) return undefined;
    const saved = settings.value?.machine;
    const fallback = list.machines.find(machine => machine.id === list.defaultMachine);
    const pickedId = saved && saved !== fallback?.id ? saved : null;
    const missing = pickedId && !list.machines.some(machine => machine.id === pickedId);
    const machines = missing
        ? [
              ...list.machines,
              { id: pickedId, label: 'Picked machine', reachable: false, detail: 'Not linked now' },
          ]
        : list.machines;
    if (machines.length < 2) return undefined;
    return {
        machines,
        current: machines.find(machine => machine.id === pickedId) ?? fallback,
        picked: pickedId,
        fallback,
    };
}

function MachineMenu({
    choices,
    onPick,
}: {
    choices: MachineChoices;
    onPick: (machine: string | null) => void;
}) {
    return (
        <div class="target-menu" role="listbox">
            {choices.machines.map(machine => {
                const isDefault = machine.id === choices.fallback?.id;
                const selected = isDefault
                    ? choices.picked === null
                    : choices.picked === machine.id;
                return (
                    <button
                        key={machine.id}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        disabled={!machine.reachable}
                        title={machine.detail}
                        class={`target-option${selected ? ' selected' : ''}`}
                        onClick={() => onPick(isDefault ? null : machine.id)}
                    >
                        <span class="target-option-icon">
                            <MachineIcon />
                        </span>
                        <span class="target-option-title">{machine.label}</span>
                        {isDefault && machine.label !== 'This machine' && (
                            <span class="target-option-meta">This machine</span>
                        )}
                        {!machine.reachable && (
                            <span class="target-option-meta">
                                {/expired/i.test(machine.detail ?? '')
                                    ? 'Link expired'
                                    : /not linked/i.test(machine.detail ?? '')
                                      ? 'Not linked'
                                      : 'Offline'}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}

function ModelMenu({
    choices,
    onPick,
}: {
    choices: ModelChoices;
    onPick: (model: string | null) => void;
}) {
    const groups = new Map<string, ProviderModel[]>();
    for (const model of choices.models) {
        groups.set(model.group, [...(groups.get(model.group) ?? []), model]);
    }
    return (
        <div class="target-menu" role="listbox">
            <button
                type="button"
                role="option"
                aria-selected={choices.picked === null}
                class={`target-option${choices.picked === null ? ' selected' : ''}`}
                onClick={() => onPick(null)}
            >
                <span class="target-option-title">Default</span>
                {choices.fallback && (
                    <span class="target-option-meta">{choices.fallback.label}</span>
                )}
            </button>
            {[...groups].map(([group, models]) => (
                <Fragment key={group}>
                    <p class="menu-group">
                        <AgentIcon agent={models[0]?.agent} size={11} />
                        {group}
                    </p>
                    {models.map(model => (
                        <button
                            key={model.id}
                            type="button"
                            role="option"
                            aria-selected={choices.picked === model.id}
                            class={`target-option${choices.picked === model.id ? ' selected' : ''}`}
                            onClick={() => onPick(model.id)}
                        >
                            <span class="target-option-title">{model.label}</span>
                        </button>
                    ))}
                </Fragment>
            ))}
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
