import type { BoxModel, ElementContext, Sides, Spacing } from '@tencildev/protocol';

const CONTEXT_OPEN = '<tencil-context>';
const CONTEXT_CLOSE = '</tencil-context>';

/** A message people left on a pin, for the agent: who said what. */
export interface TeamComment {
    name: string;
    text: string;
}

/**
 * Renders the text sent to the agent: the user's words first, then a fenced
 * block of element context. The block is stripped again before messages are
 * shown in the overlay (`stripContext`). A pin handed over from a discussion
 * (`@tencil`) brings what the team said in the block, so the user's words stay
 * the message they tagged.
 */
export function renderPrompt(input: {
    prompt: string;
    pageUrl: string;
    context: ElementContext;
    hasScreenshot: boolean;
    discussion?: TeamComment[];
}): string {
    const discussion = input.discussion ?? [];
    const lines =
        discussion.length > 0
            ? [
                  'The user handed you a discussion their team had on an element of their running app (via Tencil). Their message above is what to do; use the discussion and the context below to locate the code, then make the change in this workspace.',
                  '',
                  'Your team discussed this element:',
                  ...transcriptLines(discussion),
                  '',
              ]
            : [
                  'The user pinned this comment on an element of their running app (via Tencil). Use the context below to locate the code, then make the change in this workspace.',
                  '',
              ];
    lines.push(...contextLines(input.pageUrl, input.context));
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

/**
 * A follow-up on a pin with comments: the user's words, then what the team said
 * since the agent's last turn, in the block so the overlay shows only the former.
 */
export function renderFollowUp(text: string, comments: TeamComment[]): string {
    if (comments.length === 0) return text;
    const lines = ['Since your last turn the team said:', ...transcriptLines(comments)];
    return `${text.trim()}\n\n${CONTEXT_OPEN}\n${lines.join('\n')}\n${CONTEXT_CLOSE}`;
}

/** One line per comment, its own lines indented under the name. */
function transcriptLines(comments: TeamComment[]): string[] {
    return comments.map(
        ({ name, text }) => `${page(oneLine(name))}: ${page(text.trim()).replace(/\n/g, '\n  ')}`,
    );
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
