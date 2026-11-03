import { signal } from '@preact/signals';
import type { Member } from '@tencildev/protocol';
import { AGENT_HANDLE } from '@tencildev/protocol/mentions';

/** Pins are conversations among people (Tencil Cloud's `ready.comments`). */
export const commentsOn = signal(false);
/** Who can be mentioned, from `ready`. */
export const members = signal<Member[]>([]);

export const COMMENT_PLACEHOLDER = 'Comment, or @tencil to hand it to the agent';

/** A row of the `@` popup: the agent first, then people. */
export interface Suggestion {
    handle: string;
    name: string;
    avatarUrl?: string;
    agent?: boolean;
}

const MAX_SUGGESTIONS = 6;
const HANDLE_CHAR = /[A-Za-z0-9._-]/;

/**
 * The `@token` the caret is in, if any: where its `@` is and what follows it
 * up to the caret. Like `mentionsOf`, an `@` right after a word character
 * (an email address) doesn't count.
 */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
    let start = caret;
    while (start > 0 && HANDLE_CHAR.test(text[start - 1]!)) start--;
    if (start === 0 || text[start - 1] !== '@') return null;
    const at = start - 1;
    if (at > 0 && /\w/.test(text[at - 1]!)) return null;
    return { start: at, query: text.slice(start, caret) };
}

/** The agent, then the members whose handle or name matches what was typed. */
export function suggestionsFor(query: string, people: Member[]): Suggestion[] {
    const q = query.toLowerCase();
    const matches = (value: string) => value.toLowerCase().includes(q);
    const agent: Suggestion = { handle: AGENT_HANDLE, name: 'Tencil', agent: true };
    const found = people
        .filter(member => member.handle.toLowerCase() !== AGENT_HANDLE)
        .filter(member => matches(member.handle) || matches(member.name))
        // Handles that start with the query first.
        .sort(
            (a, b) =>
                Number(!a.handle.toLowerCase().startsWith(q)) -
                Number(!b.handle.toLowerCase().startsWith(q)),
        )
        .map(({ handle, name, avatarUrl }) => ({ handle, name, avatarUrl }));
    return [...(matches(AGENT_HANDLE) ? [agent] : []), ...found].slice(0, MAX_SUGGESTIONS);
}

/** Replace the `@token` from `start` to the caret with `@handle `. */
export function insertMention(
    text: string,
    start: number,
    caret: number,
    handle: string,
): { text: string; caret: number } {
    let end = caret;
    while (end < text.length && HANDLE_CHAR.test(text[end]!)) end++;
    const inserted = `@${handle} `;
    const rest = text.slice(end).replace(/^ /, '');
    return { text: `${text.slice(0, start)}${inserted}${rest}`, caret: start + inserted.length };
}

/**
 * Text split into plain runs and the mentions of known handles (`@tencil` and
 * the members), for highlighting. Handles compare case-insensitively.
 */
export function mentionParts(
    text: string,
    handles: ReadonlySet<string>,
): Array<{ text: string; mention?: 'agent' | 'member' }> {
    const parts: Array<{ text: string; mention?: 'agent' | 'member' }> = [];
    let last = 0;
    for (const match of text.matchAll(/(?<!\w)@([A-Za-z0-9][A-Za-z0-9._-]*)/g)) {
        const handle = match[1]!.replace(/[.-]+$/, '');
        const lower = handle.toLowerCase();
        const kind = lower === AGENT_HANDLE ? 'agent' : handles.has(lower) ? 'member' : undefined;
        if (!kind) continue;
        const index = match.index;
        if (index > last) parts.push({ text: text.slice(last, index) });
        parts.push({ text: `@${handle}`, mention: kind });
        last = index + handle.length + 1;
    }
    if (last < text.length) parts.push({ text: text.slice(last) });
    return parts;
}

/** Initials for an avatar without a picture: "Ada Lovelace" → "AL". */
export function initials(name: string): string {
    const words = name.trim().split(/\s+/).filter(Boolean);
    const letters = words.length > 1 ? [words[0]!, words.at(-1)!] : words;
    return letters.map(word => [...word][0]!.toUpperCase()).join('') || '?';
}
