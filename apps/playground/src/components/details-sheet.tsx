import * as Dialog from '@radix-ui/react-dialog';

/** A modal side sheet, like shadcn's: closes on outside presses, traps focus and locks scroll. */
export function DetailsSheet() {
    return (
        <Dialog.Root>
            <Dialog.Trigger asChild>
                <button type="button" className="button button-ghost">
                    View details
                </button>
            </Dialog.Trigger>
            <Dialog.Portal>
                <Dialog.Overlay className="sheet-overlay" />
                <Dialog.Content className="sheet" aria-describedby={undefined}>
                    <Dialog.Title>Account details</Dialog.Title>
                    <p>Everything about this account in one place.</p>
                    <button type="button" className="button">
                        Approve account
                    </button>
                    <Dialog.Close className="button button-small">Close</Dialog.Close>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
