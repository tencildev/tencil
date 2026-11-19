/**
 * Presses, focus and scrolling that land in the overlay leave the page alone.
 *
 * Modal dialogs and sheets (Radix, shadcn and the like) watch the document: a press
 * outside them closes them, focus that moves outside is pulled back, and wheels outside
 * them are cancelled. The overlay is outside every page dialog, so the toolbar would
 * close an open sheet, Escape would close it too, and the composer couldn't keep focus. These events stop at the
 * host, once the overlay has handled them; its own global listeners run on `window` in
 * the capture phase, before this.
 */
const STOPPED_AT_HOST = [
    'pointerdown',
    'mousedown',
    'touchstart',
    'touchend',
    'click',
    'focusin',
    'wheel',
    'touchmove',
] as const;

export function isolateEvents(host: HTMLElement): () => void {
    const stop = (event: Event) => event.stopPropagation();
    // Focus moving into the overlay is a `focusout` on the page's element, not ours, so
    // it can't be stopped at the host. A focus trap would take that as focus escaping.
    const keepFocus = (event: FocusEvent) => {
        if (event.relatedTarget === host && !event.composedPath().includes(host)) {
            event.stopImmediatePropagation();
        }
    };
    // Dialogs listen for Escape in the capture phase, before the host, but leave it
    // alone once it's handled. Escape in the overlay is always the overlay's.
    const claimEscape = (event: KeyboardEvent) => {
        if (event.key === 'Escape' && event.composedPath().includes(host)) event.preventDefault();
    };

    for (const type of STOPPED_AT_HOST) host.addEventListener(type, stop);
    window.addEventListener('focusout', keepFocus, true);
    window.addEventListener('keydown', claimEscape, true);
    return () => {
        for (const type of STOPPED_AT_HOST) host.removeEventListener(type, stop);
        window.removeEventListener('focusout', keepFocus, true);
        window.removeEventListener('keydown', claimEscape, true);
    };
}
