/**
 * Presses, focus and scrolling that land in the overlay leave the page alone.
 *
 * Modal dialogs, sheets, selects and comboboxes (Radix, shadcn, Base UI and the like)
 * watch the document: a press outside them closes them, focus that moves outside is
 * pulled back, and wheels outside them are cancelled. The overlay is outside every page
 * popup, so the toolbar would close an open sheet or select, Escape would close it too,
 * and the composer couldn't keep focus.
 *
 * Most of these events stop at the host, once the overlay has handled them; its own
 * global listeners run on `window` in the capture phase, before this. Press starts are
 * different: Base UI and Floating UI listen for them on the document in the capture
 * phase, before the event reaches the host. Those stop on `window` instead, and the
 * overlay gets its own copy of `pointerdown` (drags start on it), dispatched inside the
 * shadow root so it never reaches the page.
 */
const STOPPED_AT_HOST = ['touchend', 'click', 'focusin', 'wheel', 'touchmove'] as const;
const STOPPED_ON_WINDOW = ['pointerdown', 'mousedown', 'touchstart'] as const;

export function isolateEvents(host: HTMLElement): () => void {
    const stop = (event: Event) => event.stopPropagation();
    const stopEarly = (event: Event) => {
        if (!event.composedPath().includes(host)) return;
        event.stopImmediatePropagation();
        if (event instanceof PointerEvent && event.type === 'pointerdown') redispatch(event);
    };
    // Focus moving into the overlay is a `focusout` on the page's element, not ours, so
    // it can't be stopped at the host. A focus trap would take that as focus escaping.
    const keepFocus = (event: FocusEvent) => {
        if (event.relatedTarget === host && !event.composedPath().includes(host)) {
            event.stopImmediatePropagation();
        }
    };
    // Some traps (React Native Web's Modal) watch `focus` on the document instead, and
    // pull focus back whenever the active element is outside them, which the host is.
    // `focus` doesn't bubble, so the document sees it before the overlay does: stop it on
    // `window` and replay it inside the shadow root for the overlay's own handlers.
    const keepFocusIn = (event: FocusEvent) => {
        if (!event.isTrusted || !event.composedPath().includes(host)) return;
        event.stopImmediatePropagation();
        const target = event.composedPath()[0];
        target?.dispatchEvent(new FocusEvent('focus', { relatedTarget: event.relatedTarget }));
    };
    // Dialogs listen for Escape in the capture phase, before the host, but leave it
    // alone once it's handled. Escape in the overlay is always the overlay's.
    const claimEscape = (event: KeyboardEvent) => {
        if (event.key === 'Escape' && event.composedPath().includes(host)) event.preventDefault();
    };

    for (const type of STOPPED_AT_HOST) host.addEventListener(type, stop);
    for (const type of STOPPED_ON_WINDOW) window.addEventListener(type, stopEarly, true);
    window.addEventListener('focusout', keepFocus, true);
    window.addEventListener('focus', keepFocusIn, true);
    window.addEventListener('keydown', claimEscape, true);
    return () => {
        for (const type of STOPPED_AT_HOST) host.removeEventListener(type, stop);
        for (const type of STOPPED_ON_WINDOW) window.removeEventListener(type, stopEarly, true);
        window.removeEventListener('focusout', keepFocus, true);
        window.removeEventListener('focus', keepFocusIn, true);
        window.removeEventListener('keydown', claimEscape, true);
    };
}

/** Hands a stopped `pointerdown` to the overlay element it was meant for, and only to it. */
function redispatch(event: PointerEvent) {
    const target = event.composedPath()[0];
    if (!target) return;
    const copy = new PointerEvent(event.type, {
        bubbles: true,
        cancelable: true,
        composed: false,
        clientX: event.clientX,
        clientY: event.clientY,
        screenX: event.screenX,
        screenY: event.screenY,
        button: event.button,
        buttons: event.buttons,
        detail: event.detail,
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        isPrimary: event.isPrimary,
        width: event.width,
        height: event.height,
        pressure: event.pressure,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
    });
    if (!target.dispatchEvent(copy)) event.preventDefault();
}
