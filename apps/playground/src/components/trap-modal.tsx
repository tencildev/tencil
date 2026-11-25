import { useEffect, useRef, useState } from 'react';

/**
 * A modal that traps focus like React Native Web's `Modal`: it listens for `focus` on
 * the document and moves focus back inside whenever the active element is outside it.
 */
export function TrapModal() {
    const [open, setOpen] = useState(false);
    const card = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const trapFocus = () => {
            const element = card.current;
            if (element && !element.contains(document.activeElement)) {
                element.querySelector<HTMLElement>('button')?.focus();
            }
        };
        document.addEventListener('focus', trapFocus, true);
        trapFocus();
        return () => document.removeEventListener('focus', trapFocus, true);
    }, [open]);

    return (
        <>
            <button type="button" className="button button-ghost" onClick={() => setOpen(true)}>
                Finish round
            </button>
            {open && (
                <div className="sheet-overlay trap-overlay">
                    <div
                        ref={card}
                        className="dialog trap-card"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="trap-modal-title"
                    >
                        <h2 id="trap-modal-title">Did they finish?</h2>
                        <button type="button" className="button" onClick={() => setOpen(false)}>
                            Yes
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}
