import { useEffect, useRef } from 'preact/hooks';
import { viewedImage } from '../lib/state.ts';
import { CloseIcon } from './icons.tsx';

/** An image from a thread at full size, over the page. Escape, the scrim or × closes it. */
export function ImageViewer() {
    const image = viewedImage.value;
    const close = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (!image) return;
        close.current?.focus();
        // Wherever focus is: the page's own Escape handling never sees it.
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopImmediatePropagation();
            viewedImage.value = null;
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [image?.src]);
    if (!image) return null;
    const dismiss = () => {
        viewedImage.value = null;
    };
    return (
        <>
            <div class="image-viewer-scrim" onClick={dismiss} />
            <div
                class="image-viewer"
                role="dialog"
                aria-modal="true"
                aria-label={image.alt}
                onClick={event => {
                    if (event.target === event.currentTarget) dismiss();
                }}
                onKeyDown={event => {
                    // The close button is all there is to focus.
                    if (event.key === 'Tab') event.preventDefault();
                }}
            >
                <img src={image.src} alt={image.alt} />
                <button
                    ref={close}
                    type="button"
                    class="icon-button image-viewer-close"
                    aria-label="Close image"
                    onClick={dismiss}
                >
                    <CloseIcon />
                </button>
            </div>
        </>
    );
}
