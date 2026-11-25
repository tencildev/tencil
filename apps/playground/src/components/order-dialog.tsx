import { useRef } from 'react';

/** A native modal `<dialog>`: while it's open, everything outside it is inert. */
export function OrderDialog() {
    const dialog = useRef<HTMLDialogElement>(null);
    return (
        <>
            <button
                type="button"
                className="button button-ghost"
                onClick={() => dialog.current?.showModal()}
            >
                Place order
            </button>
            <dialog ref={dialog} className="dialog" aria-labelledby="order-dialog-title">
                <h2 id="order-dialog-title">Confirm order</h2>
                <p>You are about to order the Pro plan.</p>
                <button type="button" className="button" onClick={() => dialog.current?.close()}>
                    Confirm
                </button>
            </dialog>
        </>
    );
}
