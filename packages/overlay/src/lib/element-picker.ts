import type { Anchor } from '@tencildev/protocol';
import { captureArea } from './area.ts';
import { threads } from './connection.ts';
import { captureContext, quickLabel } from './element-context.ts';
import { offsetsIn } from './position.ts';
import { holding, matches, recording, shortcuts } from './shortcuts.ts';
import {
    currentPage,
    dockHidden,
    draft,
    hidden,
    hovered,
    inboxOpen,
    layoutTick,
    marquee,
    measuring,
    mode,
    openThreadId,
    pageKey,
    rulerAnchor,
    rulerAvailable,
    rulerOn,
    setDockHidden,
    settingsOpen,
    startPicking,
    stopPicking,
    toggleRuler,
} from './state.ts';

/** How far the pointer moves, pressed, before a click becomes a dragged box. */
const DRAG_THRESHOLD = 5;
/** Room a pin needs from the window's edges (twice that on the right, where it's drawn). */
const PIN_EDGE = 24;

const BLOCKED_WHILE_PICKING = [
    'pointerdown',
    'pointerup',
    'mousedown',
    'mouseup',
    'dblclick',
    'contextmenu',
    'auxclick',
] as const;

/**
 * Global listeners: hover tracking + click capture in comment mode, the
 * shortcuts from `shortcuts.ts` (comment, ruler, hide pins, hide the dock),
 * the held key to measure (with the ruler on, anywhere on the page), and
 * layout invalidation for anchored UI. Everything is attached in the capture
 * phase so the page never sees comment-mode or measuring clicks.
 */
export function installPicker(host: HTMLElement): () => void {
    const isOurs = (event: Event) => event.composedPath().includes(host);

    const elementAt = (x: number, y: number): Element | null => {
        for (const element of document.elementsFromPoint(x, y)) {
            if (element === host || host.contains(element)) return null;
            if (element === document.documentElement) continue;
            return element;
        }
        return null;
    };

    // With the ruler on, hovering with the measure key held measures, comment open or not.
    const capturing = () => mode.value === 'picking' || (measuring.value && rulerOn.value);

    let pointer: { x: number; y: number; ours: boolean } | null = null;
    /** Where the pointer went down on the page while picking; a drag from there draws a box. */
    let press: { x: number; y: number } | null = null;
    /** A box was just dragged: the click the browser fires after it isn't a pick. */
    let swallowClick = false;
    const cancelDrag = () => {
        press = null;
        if (marquee.value) marquee.value = null;
    };
    /** The element last measured against the ruler's anchor; `C` sends the spacing to it. */
    let measuredFromAnchor: Element | null = null;
    const track = () => {
        if (!capturing()) {
            if (hovered.value) hovered.value = null;
            return;
        }
        hovered.value = !pointer || pointer.ours ? null : elementAt(pointer.x, pointer.y);
        const anchor = rulerAnchor.value?.element;
        if (anchor && hovered.value && hovered.value !== anchor) {
            measuredFromAnchor = hovered.value;
        }
    };

    const openDraft = (
        element: Element,
        offsets: Pick<Anchor, 'offsetX' | 'offsetY'>,
        measuredTo?: { element: Element; parent: boolean },
    ) => {
        stopPicking();
        rulerAnchor.value = null;
        draft.value = {
            element,
            label: quickLabel(element),
            anchor: {
                // Filled in once context resolves; the live element reference drives layout until then.
                selector: '',
                ...offsets,
            },
            context: captureContext(element),
            ...(measuredTo
                ? { measuredTo: { ...measuredTo, label: quickLabel(measuredTo.element) } }
                : {}),
        };
    };

    /** Comment on everything under the dragged box. */
    const openAreaDraft = (box: NonNullable<typeof marquee.value>) => {
        const capture = captureArea(box, host);
        if (!capture) return;
        const { root, parts, area } = capture;
        const rect = root.getBoundingClientRect();
        // Top right, so the comment box opens beside the area, nudged inside the window.
        const corner = {
            x: Math.max(PIN_EDGE, Math.min(box.right, window.innerWidth - PIN_EDGE * 2)),
            y: Math.max(PIN_EDGE, box.top),
        };
        stopPicking();
        rulerAnchor.value = null;
        const context = captureContext(root);
        draft.value = {
            element: root,
            label: quickLabel(root),
            anchor: { selector: '', ...offsetsIn(root, corner) },
            context: Promise.all([context, area]).then(([resolved, described]) => ({
                ...resolved,
                area: described,
            })),
            area: {
                offset: {
                    left: box.left - rect.left,
                    top: box.top - rect.top,
                    right: box.right - rect.left,
                    bottom: box.bottom - rect.top,
                },
                parts,
            },
        };
    };

    /** Dragging while picking: the box follows the pointer, and letting go comments on it. */
    const dragTo = (event: PointerEvent): boolean => {
        if (!press || mode.value !== 'picking') {
            cancelDrag();
            return false;
        }
        // Released outside the window: the pointerup never came.
        if (event.buttons === 0) {
            finishDrag();
            return true;
        }
        const dx = event.clientX - press.x;
        const dy = event.clientY - press.y;
        if (!marquee.value && Math.hypot(dx, dy) < DRAG_THRESHOLD) return false;
        marquee.value = {
            left: Math.min(press.x, event.clientX),
            top: Math.min(press.y, event.clientY),
            right: Math.max(press.x, event.clientX),
            bottom: Math.max(press.y, event.clientY),
        };
        if (hovered.value) hovered.value = null;
        return true;
    };

    const finishDrag = () => {
        const box = marquee.value;
        cancelDrag();
        if (!box) return;
        swallowClick = true;
        openAreaDraft(box);
    };

    const onPointerMove = (event: PointerEvent) => {
        pointer = { x: event.clientX, y: event.clientY, ours: isOurs(event) };
        if (dragTo(event)) return;
        measuring.value = holding(shortcuts.value.measure, event);
        track();
    };

    // Pressing or releasing the measure key redraws right away, without moving the mouse.
    const onMeasureKey = (event: KeyboardEvent) => {
        if (recording.value || event.key !== shortcuts.value.measure) return;
        measuring.value = event.type === 'keydown';
        // Windows browsers focus their menu bar when Alt is released.
        if (rulerOn.value) event.preventDefault();
        track();
    };
    const onBlur = () => {
        cancelDrag();
        measuring.value = false;
        track();
    };

    const block = (event: Event) => {
        // A new press: the click after a drag never came (released outside the window).
        if (event.type === 'pointerdown') swallowClick = false;
        // Clicking the page dismisses an open pin (the page still gets the click).
        if (!capturing() && event.type === 'pointerdown' && !isOurs(event)) {
            settingsOpen.value = false;
            // Docked (unpinned) threads stay open while you use the page.
            const open = openThreadId.value ? threads.value.get(openThreadId.value) : undefined;
            if (open?.anchor) openThreadId.value = null;
            return;
        }
        if (!capturing() || isOurs(event)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (mode.value !== 'picking') return;
        if (event.type === 'pointerdown') {
            const { button, clientX, clientY } = event as PointerEvent;
            press = button === 0 ? { x: clientX, y: clientY } : null;
        } else if (event.type === 'pointerup') {
            if (marquee.value) finishDrag();
            else press = null;
        }
    };

    const onClick = (event: MouseEvent) => {
        // Picking already stopped when the box was let go: the page mustn't get this click.
        if (swallowClick && !isOurs(event)) {
            swallowClick = false;
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
        }
        if (!capturing() || isOurs(event)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const element = elementAt(event.clientX, event.clientY);
        if (!element) return;
        const offsets = offsetsIn(element, { x: event.clientX, y: event.clientY });
        if (mode.value !== 'picking') {
            const open = draft.value;
            if (open) {
                // Measure-click: measure the open comment's element against this one.
                draft.value = {
                    ...open,
                    measuredTo:
                        element === open.element
                            ? undefined
                            : { element, label: quickLabel(element), parent: false },
                };
            } else {
                // Measure-click: measure from this element; again to let go of it.
                const same = rulerAnchor.value?.element === element;
                rulerAnchor.value = same ? null : { element, offsets };
                measuredFromAnchor = null;
                // The blocked click can't take focus off the toolbar; do it so `C` works.
                const focused = host.shadowRoot?.activeElement;
                if (focused instanceof HTMLElement) focused.blur();
            }
            return;
        }
        const parent = element.parentElement;
        // Measure-click while picking: measure against the parent, as the guides showed.
        const measureParent =
            holding(shortcuts.value.measure, event) &&
            rulerOn.value &&
            parent &&
            parent !== document.documentElement;
        openDraft(element, offsets, measureParent ? { element: parent, parent: true } : undefined);
    };

    const onKeyDown = (event: KeyboardEvent) => {
        if (recording.value) return;
        const keys = shortcuts.value;
        if (matches(keys.hideDock, event) && !isTyping(event)) {
            event.preventDefault();
            setDockHidden(!dockHidden.value);
            return;
        }
        // Panels handle their own keys; a focused toolbar button (after a click, or
        // closing settings) shouldn't turn the shortcuts off.
        if ((isOurs(event) && !onToolbar(event)) || dockHidden.value) return;
        if (event.key === 'Escape') {
            if (marquee.value) {
                // Letting go after this mustn't pick what's under the pointer.
                cancelDrag();
                swallowClick = true;
            } else if (mode.value === 'picking') stopPicking();
            else if (draft.value) draft.value = null;
            else if (rulerAnchor.value) rulerAnchor.value = null;
            else if (openThreadId.value) openThreadId.value = null;
            else if (inboxOpen.value) inboxOpen.value = false;
            else return;
            event.preventDefault();
            return;
        }
        if (isTyping(event)) return;
        if (matches(keys.ruler, event) && rulerAvailable.value) {
            event.preventDefault();
            toggleRuler();
            return;
        }
        if (matches(keys.hidePins, event)) {
            event.preventDefault();
            hidden.value = !hidden.value;
            if (hidden.value) stopPicking();
            return;
        }
        if (matches(keys.comment, event)) {
            event.preventDefault();
            hidden.value = false;
            const anchor = rulerAnchor.value;
            if (mode.value === 'picking') stopPicking();
            else if (anchor?.element.isConnected && !draft.value) {
                // Comment on what the ruler selected, with the spacing it last measured.
                const other = measuredFromAnchor?.isConnected ? measuredFromAnchor : null;
                openDraft(
                    anchor.element,
                    anchor.offsets,
                    other ? { element: other, parent: false } : undefined,
                );
            } else startPicking();
        }
    };

    let frame = 0;
    const invalidate = () => {
        if (frame) return;
        frame = requestAnimationFrame(() => {
            frame = 0;
            layoutTick.value++;
        });
    };
    const mutations = new MutationObserver(records => {
        if (records.every(record => host.contains(record.target) || record.target === host)) return;
        invalidate();
    });
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true });

    // SPA navigations don't fire an event we can rely on everywhere; poll cheaply.
    const navigation = setInterval(() => {
        const key = pageKey(location.href);
        if (key !== currentPage.value) {
            currentPage.value = key;
            draft.value = null;
            rulerAnchor.value = null;
            openThreadId.value = null;
        }
    }, 400);

    window.addEventListener('pointermove', onPointerMove, { capture: true, passive: true });
    for (const type of BLOCKED_WHILE_PICKING) window.addEventListener(type, block, true);
    window.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keydown', onMeasureKey, true);
    window.addEventListener('keyup', onMeasureKey, true);
    window.addEventListener('blur', onBlur);
    window.addEventListener('scroll', invalidate, { capture: true, passive: true });
    window.addEventListener('resize', invalidate, { passive: true });

    return () => {
        window.removeEventListener('pointermove', onPointerMove, true);
        for (const type of BLOCKED_WHILE_PICKING) window.removeEventListener(type, block, true);
        window.removeEventListener('click', onClick, true);
        window.removeEventListener('keydown', onKeyDown, true);
        window.removeEventListener('keydown', onMeasureKey, true);
        window.removeEventListener('keyup', onMeasureKey, true);
        window.removeEventListener('blur', onBlur);
        window.removeEventListener('scroll', invalidate, true);
        window.removeEventListener('resize', invalidate);
        mutations.disconnect();
        clearInterval(navigation);
        cancelAnimationFrame(frame);
    };
}

function onToolbar(event: KeyboardEvent): boolean {
    const target = event.composedPath()[0];
    return target instanceof Element && target.closest('.toolbar') !== null;
}

function isTyping(event: KeyboardEvent): boolean {
    const target = event.composedPath()[0];
    if (!(target instanceof HTMLElement)) return false;
    return (
        target.isContentEditable ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
    );
}
