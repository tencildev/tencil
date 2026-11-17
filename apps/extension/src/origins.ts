/** The page's origin, or nothing for pages Tencil can't load into (`chrome:`, `file:`). */
export function originOf(url: string): string | undefined {
    try {
        const { protocol, origin } = new URL(url);
        return protocol === 'http:' || protocol === 'https:' ? origin : undefined;
    } catch {
        return undefined;
    }
}
