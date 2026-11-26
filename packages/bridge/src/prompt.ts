import type { Area, AreaNode, BoxModel, ElementContext, Sides, Spacing } from '@tencildev/protocol';

const CONTEXT_OPEN = '<tencil-context>';
const CONTEXT_CLOSE = '</tencil-context>';

/** What the user wrote in Tencil's settings to go with every pin. */
export interface PinInstructions {
    /** For every project on this machine (or account). */
    global?: string;
    /** For this project only. */
    project?: string;
}

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
    instructions?: PinInstructions;
}): string {
    const lines = [
        `The user pinned this comment on ${input.context.area ? 'an area' : 'an element'} of their running app (via Tencil). Use the context below to locate the code, then make the change in this workspace.`,
        ...deployedNote([input.pageUrl]),
        '',
        ...contextLines(input.pageUrl, input.context),
    ];
    if (input.hasScreenshot) {
        lines.push(`- A screenshot of the ${input.context.area ? 'area' : 'element'} is attached.`);
    }
    lines.push(...instructionLines(input.instructions));
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
    instructions?: PinInstructions,
): string {
    const lines = [
        `The user pinned ${comments.length} comments on elements of their running app (via Tencil). Work through all of them in this workspace, using the context below to locate the code. They're numbered like the pins on the page: refer to them by number (#2) when you report back.`,
        ...deployedNote(comments.map(comment => comment.pageUrl)),
    ];
    for (const comment of comments) {
        lines.push('', `#${comment.number}`, ...contextLines(comment.pageUrl, comment.context));
        if (comment.screenshots.length > 0) {
            lines.push(`- Screenshot: attached image ${comment.screenshots.join(', ')}`);
        }
    }
    lines.push(...instructionLines(instructions));
    const text = comments.map(comment => `#${comment.number} ${comment.prompt.trim()}`);
    return `${text.join('\n\n')}\n\n${CONTEXT_OPEN}\n${lines.join('\n')}\n${CONTEXT_CLOSE}`;
}

function contextLines(pageUrl: string, context: ElementContext): string[] {
    const lines = [
        `- Page: ${page(pageUrl)}${isDeployed(pageUrl) ? ' (deployed site, not a local dev server)' : ''}`,
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
    if (context.area) lines.push(...areaLines(context.area));
    return lines;
}

const MAX_GAP_LINES = 12;

/**
 * A dragged box: what it touches as an indented tree, numbered so the space
 * between neighbours can point at the elements that make it.
 */
function areaLines(area: Area): string[] {
    const { rect } = area;
    const lines = [
        `- Area: the user dragged a box over the page, ${Math.round(rect.width)}×${Math.round(rect.height)} at (${Math.round(rect.x)}, ${Math.round(rect.y)}), and the comment is about what's in it. The element above is the smallest one holding all of it. What the box touches, outermost first (indented by nesting; "inside" is how much of each element is within the box):`,
    ];
    area.nodes.forEach((node, index) => {
        lines.push(`${'  '.repeat(node.depth + 1)}[${index + 1}] ${areaNodeLine(node)}`);
    });
    if (area.omitted) {
        lines.push(
            `  …and ${area.omitted} more element${area.omitted === 1 ? '' : 's'} too small or too deep to list`,
        );
    }
    const gaps = areaGaps(area.nodes).slice(0, MAX_GAP_LINES);
    if (gaps.length > 0) {
        lines.push('- Space between neighbours in the area:', ...gaps.map(gap => `  - ${gap}`));
    }
    return lines;
}

function areaNodeLine(node: AreaNode): string {
    const parts = [`\`${page(truncate(oneLine(node.html), 300))}\``];
    if (node.component) parts.push(page(formatFrame(node.component)));
    parts.push(
        `${Math.round(node.rect.width)}×${Math.round(node.rect.height)}, ${Math.round(node.inside * 100)}% inside`,
    );
    if (node.layout) parts.push(page(node.layout));
    const box = node.box && boxLine(node.box);
    if (box) parts.push(box);
    if (node.text) parts.push(`"${page(truncate(oneLine(node.text), 120))}"`);
    return parts.join(' · ');
}

/**
 * The space between each pair of neighbouring siblings, and what makes it when
 * the parent's gap and their margins add up to it. A wrong cause misleads more
 * than none, so a gap they don't explain only says what it includes.
 */
export function areaGaps(nodes: AreaNode[]): string[] {
    const lines: string[] = [];
    const parentOf = nodes.map((node, index) => {
        for (let before = index - 1; before >= 0; before--) {
            if (nodes[before]!.depth < node.depth) return before;
        }
        return -1;
    });
    for (let index = 0; index < nodes.length; index++) {
        const node = nodes[index]!;
        const parent = parentOf[index]!;
        let previous = -1;
        for (let before = index - 1; before > parent; before--) {
            if (nodes[before]!.depth === node.depth) {
                previous = before;
                break;
            }
        }
        // Something unlisted between them makes part of the space: don't guess.
        if (previous === -1 || parent === -1 || !node.adjacent) continue;
        const line = gapLine(nodes[parent]!, parent, nodes[previous]!, previous, node, index);
        if (line) lines.push(line);
    }
    return lines;
}

function gapLine(
    parent: AreaNode,
    parentIndex: number,
    a: AreaNode,
    aIndex: number,
    b: AreaNode,
    bIndex: number,
): string | undefined {
    const aBottom = a.rect.y + a.rect.height;
    const aRight = a.rect.x + a.rect.width;
    const vertical = b.rect.y >= aBottom - 0.5;
    if (!vertical && b.rect.x < aRight - 0.5) return undefined;
    const value = Math.round((vertical ? b.rect.y - aBottom : b.rect.x - aRight) * 10) / 10;
    if (value < 1) return undefined;
    const label = (index: number) => `[${index + 1}]`;
    const gap = parent.box?.gap?.[vertical ? 'row' : 'column'] ?? 0;
    const marginA = a.box?.margin[vertical ? 2 : 1] ?? 0;
    const marginB = b.box?.margin[vertical ? 0 : 3] ?? 0;
    // Block layout collapses vertical margins into the larger one.
    const collapses =
        vertical && !/flex|grid/.test(parent.layout ?? '') && marginA >= 0 && marginB >= 0;
    const parts: Array<[number, string]> = [[gap, `gap ${gap} on ${label(parentIndex)}`]];
    const sideA = `margin-${vertical ? 'bottom' : 'right'} ${marginA} on ${label(aIndex)}`;
    const sideB = `margin-${vertical ? 'top' : 'left'} ${marginB} on ${label(bIndex)}`;
    if (!collapses) parts.push([marginA, sideA], [marginB, sideB]);
    else if (marginA >= marginB) parts.push([marginA, sideA]);
    else parts.push([marginB, sideB]);
    const counted = parts.filter(([amount]) => amount !== 0);
    const total = counted.reduce((sum, [amount]) => sum + amount, 0);
    const head = `${label(aIndex)} to ${label(bIndex)}: ${value}px ${vertical ? 'vertical' : 'horizontal'}`;
    if (counted.length > 0 && Math.abs(total - value) <= 1) {
        return `${head} = ${counted.map(([, text]) => text).join(' + ')}`;
    }
    const known = counted.filter(([amount]) => amount > 0);
    const explained = known.reduce((sum, [amount]) => sum + amount, 0);
    if (known.length > 0 && explained < value) {
        return `${head}, includes ${known.map(([, text]) => text).join(' + ')}; the other ${Math.round((value - explained) * 10) / 10}px comes from elsewhere (padding, sizes or alignment)`;
    }
    return `${head}, not from a gap or margins (padding, sizes or alignment)`;
}

/**
 * The user's standing instructions, global first, then the project's. They're
 * the user's own words but go inside the block, so the agent reads them as
 * context for the change and the overlay doesn't show them on every pin.
 */
function instructionLines(instructions: PinInstructions = {}): string[] {
    const lines: string[] = [];
    const sections = [
        ['The user asks this for every project:', instructions.global],
        ['The user asks this for this project:', instructions.project],
    ] as const;
    for (const [heading, text] of sections) {
        const trimmed = text?.trim();
        if (trimmed) lines.push('', heading, page(trimmed));
    }
    return lines;
}

/**
 * When a pin was made on a deployed site (through the extension) rather than the
 * local dev server, the agent should know its edit won't show there until it ships,
 * and that a production build may have no component names or source paths.
 */
function deployedNote(pageUrls: string[]): string[] {
    const origins = [...new Set(pageUrls.filter(isDeployed).map(url => new URL(url).origin))];
    if (origins.length === 0) return [];
    return [
        `The page is on ${page(origins.join(', '))}, a deployed site, not this workspace's dev server. Change the source here; the change won't show on that site until it's deployed, so say so when you report back. A production build may not name components or their source files: find the code by its visible text, markup and selector.`,
    ];
}

/** Anything but a loopback, private-network or local-only host (`.local`, `.test`). */
export function isDeployed(pageUrl: string): boolean {
    let hostname: string;
    try {
        hostname = new URL(pageUrl).hostname.toLowerCase();
    } catch {
        return false;
    }
    if (!hostname) return false;
    return !(
        hostname === 'localhost' ||
        /\.(localhost|local|test|internal)$/.test(hostname) ||
        hostname === '[::1]' ||
        hostname === '0.0.0.0' ||
        /^127(\.\d{1,3}){3}$/.test(hostname) ||
        /^10(\.\d{1,3}){3}$/.test(hostname) ||
        /^192\.168(\.\d{1,3}){2}$/.test(hostname) ||
        /^172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2}$/.test(hostname)
    );
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
