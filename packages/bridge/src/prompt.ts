import type { ElementContext } from '@tencildev/protocol';

const CONTEXT_OPEN = '<tencil-context>';
const CONTEXT_CLOSE = '</tencil-context>';

/**
 * Renders the text sent to the agent: the user's words first, then a fenced
 * block of element context. The block is stripped again before messages are
 * shown in the overlay (`stripContext`).
 */
export function renderPrompt(input: {
    prompt: string;
    pageUrl: string;
    context: ElementContext;
    hasScreenshot: boolean;
}): string {
    const lines = [
        'The user pinned this comment on an element of their running app (via Tencil). Use the context below to locate the code, then make the change in this workspace.',
        '',
        ...contextLines(input.pageUrl, input.context),
    ];
    if (input.hasScreenshot) lines.push('- A screenshot of the element is attached.');
    return `${input.prompt.trim()}\n\n${CONTEXT_OPEN}\n${lines.join('\n')}\n${CONTEXT_CLOSE}`;
}

/**
 * Several queued comments as one message: the comments first, numbered like
 * their pins, then one context block with a section per comment. Stripping
 * the block leaves the numbered comments.
 */
export function renderBatchPrompt(
    comments: Array<{
        number: number;
        prompt: string;
        pageUrl: string;
        context: ElementContext;
        /** 1-based positions of this comment's screenshots among the attachments. */
        screenshots: number[];
    }>,
): string {
    const lines = [
        `The user pinned ${comments.length} comments on elements of their running app (via Tencil). Work through all of them in this workspace, using the context below to locate the code. They're numbered like the pins on the page: refer to them by number (#2) when you report back.`,
    ];
    for (const comment of comments) {
        lines.push('', `#${comment.number}`, ...contextLines(comment.pageUrl, comment.context));
        if (comment.screenshots.length > 0) {
            lines.push(`- Screenshot: attached image ${comment.screenshots.join(', ')}`);
        }
    }
    const text = comments.map(comment => `#${comment.number} ${comment.prompt.trim()}`);
    return `${text.join('\n\n')}\n\n${CONTEXT_OPEN}\n${lines.join('\n')}\n${CONTEXT_CLOSE}`;
}

function contextLines(pageUrl: string, context: ElementContext): string[] {
    const lines = [`- Page: ${pageUrl}`, `- Element: \`${oneLine(context.html)}\``];

    const [component, ...owners] = context.components;
    if (component) {
        const chain = [component, ...owners.slice(0, 4)].map(formatFrame).join(' ← ');
        lines.push(`- Component: ${chain}`);
    }
    lines.push(`- Selector: \`${context.selector}\``);
    if (context.text) lines.push(`- Visible text: "${truncate(oneLine(context.text), 200)}"`);
    if (context.selection)
        lines.push(`- Selected text: "${truncate(oneLine(context.selection), 300)}"`);
    const { rect, viewport } = context;
    lines.push(
        `- Layout: ${Math.round(rect.width)}×${Math.round(rect.height)} at (${Math.round(rect.x)}, ${Math.round(rect.y)}) in a ${viewport.width}×${viewport.height} viewport @${viewport.dpr}x`,
    );
    return lines;
}

export function stripContext(text: string): string {
    const index = text.indexOf(CONTEXT_OPEN);
    return index === -1 ? text : text.slice(0, index).trimEnd();
}

export function titleFor(prompt: string, context: ElementContext): string {
    const firstLine = prompt.trim().split('\n', 1)[0] ?? '';
    const subject = context.components[0]?.name ?? `<${context.tagName}>`;
    return truncate(`${subject}: ${firstLine}`, 80);
}

export function batchTitle(titles: string[]): string {
    return truncate(`${titles.length} comments: ${titles.join(' · ')}`, 80);
}

function formatFrame(frame: ElementContext['components'][number]): string {
    if (frame.library) return `${frame.name} (${frame.library})`;
    if (!frame.source) return frame.name;
    const position = [frame.source.line, frame.source.column].filter(n => n != null).join(':');
    return `${frame.name} (${frame.source.file}${position ? `:${position}` : ''})`;
}

function oneLine(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

function truncate(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
