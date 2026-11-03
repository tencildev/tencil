/** The handle that hands a pin's discussion to the agent: `@tencil`. */
export const AGENT_HANDLE = 'tencil';

/**
 * `@handle` tokens not preceded by a word character, so `ann@example.com`
 * isn't one. A handle starts with a letter or digit and may hold `.`, `_`
 * and `-`; a trailing `.` or `-` is punctuation (`thanks @ann.`).
 */
const MENTION = /(?<!\w)@([A-Za-z0-9][A-Za-z0-9._-]*)/g;

/** The handles a text mentions, lowercased, each once, in order. */
export function mentionsOf(text: string): string[] {
    const handles = new Set<string>();
    for (const match of text.matchAll(MENTION)) {
        const handle = match[1]!.replace(/[.-]+$/, '').toLowerCase();
        if (handle) handles.add(handle);
    }
    return [...handles];
}

/** Whether the text hands the pin to the agent. */
export function mentionsAgent(text: string): boolean {
    return mentionsOf(text).includes(AGENT_HANDLE);
}
