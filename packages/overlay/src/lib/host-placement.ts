/**
 * Keeps the overlay's host where the page lets it be used.
 *
 * Frameworks occasionally wipe <body> children during hydration; the host goes back.
 * A native modal dialog (`showModal()`) makes everything outside it inert, the host
 * included, so while one is open the host lives inside the topmost one and returns to
 * <body> once it closes.
 */
export function keepHostPlaced(host: HTMLElement): () => void {
    // Open modal dialogs in the order they opened; the last one is on top.
    let opened: Element[] = [];

    const place = () => {
        const modals = openModals();
        opened = opened.filter(dialog => modals.includes(dialog));
        for (const dialog of modals) if (!opened.includes(dialog)) opened.push(dialog);
        const parent = opened.at(-1) ?? document.body;
        if (parent && host.parentNode !== parent) parent.append(host);
    };

    const observer = new MutationObserver(place);
    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['open'],
    });
    place();
    return () => observer.disconnect();
}

function openModals(): Element[] {
    try {
        return [...document.querySelectorAll('dialog:modal')];
    } catch {
        // Browsers without `:modal` keep the host on <body>.
        return [];
    }
}
