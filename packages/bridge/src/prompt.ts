import type { BoxModel, ElementContext, Sides, Spacing } from '@tencildev/protocol';

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
    const lines = [
        `- Page: ${page(pageUrl)}`,
        `- Element: \`${page(truncate(oneLine(context.html), 2000))}\``,
    ];

    const [component, ...owners] = context.components;
    if (component) {
        const chain = [component, ...owners.slice(0, 4)].map(formatFrame).join(' ← ');
        lines.push(`- Component: ${page(chain)}`);
    }
    lines.push(`- Selector: \`${page(truncate(context.selector, 500))}\``);
    if (context.text) lines.push(`- Visible text: "${page(truncate(oneLine(context.text), 200))}"`);
    if (context.selection)
        lines.push(`- Selected text: "${page(truncate(oneLine(context.selection), 300))}"`);
    const { rect, viewport } = context;
    lines.push(
        `- Layout: ${Math.round(rect.width)}×${Math.round(rect.height)} at (${Math.round(rect.x)}, ${Math.round(rect.y)}) in a ${viewport.width}×${viewport.height} viewport @${viewport.dpr}x`,
    );
    const box = context.box && boxLine(context.box);
    if (box) lines.push(`- Box: ${box}`);
    if (context.spacing) lines.push(spacingLine(context.spacing));
    return lines;
}

/** Computed spacing in CSS shorthand, px: `padding 12 16, margin 0 0 24, gap 8`. */
function boxLine(box: BoxModel): string | undefined {
    const parts: string[] = [];
    for (const kind of ['padding', 'margin', 'border'] as const) {
        if (box[kind].some(value => value !== 0)) parts.push(`${kind} ${shorthand(box[kind])}`);
    }
    if (box.gap) {
        const { row, column } = box.gap;
        parts.push(`gap ${row === column ? row : `${row} ${column}`}`);
    }
    return parts.length > 0 ? `${parts.join(', ')} (px)` : undefined;
}

function shorthand([top, right, bottom, left]: Sides): string {
    if (left !== right) return `${top} ${right} ${bottom} ${left}`;
    if (top !== bottom) return `${top} ${right} ${bottom}`;
    return top === right ? `${top}` : `${top} ${right}`;
}

const SIDE_WORDS = { top: 'above', right: 'right', bottom: 'below', left: 'left' };

/** What the user measured with Alt: the space on each side of the element. */
function spacingLine(spacing: Spacing): string {
    const sides = (['top', 'right', 'bottom', 'left'] as const)
        .filter(side => spacing[side] !== undefined)
        .map(side => `${spacing[side]}px ${SIDE_WORDS[side]}`);
    const target = `${spacing.parent ? 'its parent ' : ''}\`${page(truncate(spacing.to, 200))}\``;
    const selector = spacing.selector ? ` (\`${page(truncate(spacing.selector, 500))}\`)` : '';
    return `- Measured spacing to ${target}${selector}: ${sides.length > 0 ? sides.join(', ') : 'none'}`;
}

/**
 * Asks the pin's agent to commit what it changed, the way the repository
 * wants commits made. The overlay shows the first line; the rest is context.
 */
export function renderCommitPrompt(files: string[], shared: boolean): string {
    const list = files.map(file => `\`${file}\``).join(', ');
    const lines = [
        'The user clicked Commit on this pin in Tencil. Commit the changes you made for it, the way this repository wants commits made: follow its agent instructions and commit conventions (message format, changesets, sign-off).',
        '',
        shared
            ? `- Files changed while you worked: ${list}. Another agent worked at the same time, so some of these edits may be its own.`
            : `- Files you changed: ${list}`,
        "- Commit only your own edits. Leave other uncommitted work as it is; where a file also has edits that aren't yours, stage just your hunks.",
        "- Let Git hooks run (no --no-verify), and don't push.",
        "- If you can't commit, say why.",
    ];
    return `Commit these changes\n\n${CONTEXT_OPEN}\n${lines.join('\n')}\n${CONTEXT_CLOSE}`;
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

/**
 * Text from the page goes inside the context block as data. It must not be able
 * to close that block early and pass the rest off as the user's words, so the
 * block's tags are defused wherever they appear in it.
 */
function page(text: string): string {
    return text.replace(/<(\/?\s*tencil-context)/gi, '‹$1');
}

function oneLine(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

function truncate(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
