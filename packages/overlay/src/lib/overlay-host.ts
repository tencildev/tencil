let current: HTMLElement | undefined;

/** The overlay's shadow host; excluded from hit-testing and screenshots. */
export function setHost(host: HTMLElement): void {
    current = host;
}

export function getHost(): HTMLElement {
    if (!current) throw new Error('Fixhere overlay is not mounted');
    return current;
}
