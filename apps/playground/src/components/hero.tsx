import { DetailsSheet } from './details-sheet.tsx';
import { OrderDialog } from './order-dialog.tsx';
import { TimezoneSelect } from './timezone-select.tsx';
import { TrapModal } from './trap-modal.tsx';

export function Hero() {
    return (
        <section className="hero">
            <h1>Ship your product faster</h1>
            <p>Acme gives your team everything it needs to go from idea to production.</p>
            <div className="hero-actions">
                <button type="button" className="button">
                    Get started
                </button>
                <button type="button" className="button button-ghost">
                    Book a demo
                </button>
                <DetailsSheet />
                <OrderDialog />
                <TrapModal />
                <TimezoneSelect />
            </div>
        </section>
    );
}
