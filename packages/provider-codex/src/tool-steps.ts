import type { StepStatus } from '@tencildev/protocol';
import type { ThreadItem } from './protocol.ts';

/** How an item reads in the overlay, while running and once done. */
export interface ItemLabel {
    running: string;
    done: string;
    detail?: string;
}

/** `undefined` for items that aren't something Codex did: messages, bookkeeping. */
export function itemLabel(item: ThreadItem): ItemLabel | undefined {
    switch (item.type) {
        case 'commandExecution':
            return commandLabel(item);
        case 'fileChange':
            return fileChangeLabel(item);
        case 'mcpToolCall':
            return {
                running: `Using ${item.tool}`,
                done: `Used ${item.tool}`,
                detail: item.error?.message ?? item.server,
            };
        case 'dynamicToolCall':
            return { running: `Using ${item.tool}`, done: `Used ${item.tool}` };
        case 'collabAgentToolCall':
            // Its other tools only wait on, or wrap up, the subagent this one started.
            if (item.tool !== 'spawnAgent') return undefined;
            return {
                running: 'Delegating to a subagent',
                done: 'Delegated to a subagent',
                ...(item.prompt ? { detail: firstLine(item.prompt) } : {}),
            };
        case 'webSearch': {
            const what = item.query ? ` for ${clip(item.query, 36)}` : '';
            return {
                running: `Searching the web${what}`,
                done: `Searched the web${what}`,
            };
        }
        case 'imageView': {
            const file = basename(item.path);
            return { running: `Viewing ${file}`, done: `Viewed ${file}` };
        }
        case 'imageGeneration':
            return { running: 'Generating an image', done: 'Generated an image' };
        case 'contextCompaction':
            return { running: 'Compacting the conversation', done: 'Compacted the conversation' };
        default:
            return undefined;
    }
}

/** What Codex is thinking about, from the summary of its reasoning: `**Heading**\n\nText`. */
export function reasoningLabel(summary: string): ItemLabel | undefined {
    const detail = firstLine(summary).replaceAll('**', '').trim();
    return detail ? { running: 'Thinking', done: 'Thought', detail } : undefined;
}

export function itemStatus(item: ThreadItem): StepStatus {
    const status = 'status' in item ? item.status : undefined;
    return status === 'failed' || status === 'declined' ? 'failed' : 'done';
}

/** The second line of a finished step: why it didn't run, if it didn't. */
export function finishedDetail(item: ThreadItem, label: ItemLabel): string | undefined {
    const declined = 'status' in item && item.status === 'declined';
    return declined ? 'Refused: it needs approval, and nobody is here to give it' : label.detail;
}

function commandLabel(item: Extract<ThreadItem, { type: 'commandExecution' }>): ItemLabel {
    const actions = item.commandActions ?? [];
    const only = actions.length === 1 ? actions[0] : undefined;
    if (only?.type === 'read') {
        return { running: `Reading ${only.name}`, done: `Read ${only.name}` };
    }
    if (only?.type === 'search' && only.query) {
        const query = clip(only.query, 40);
        return { running: `Searching for ${query}`, done: `Searched for ${query}` };
    }
    if (only?.type === 'listFiles') {
        const where = only.path ? basename(only.path) : 'files';
        return { running: `Listing ${where}`, done: `Listed ${where}` };
    }
    const command = withoutShell(item.command);
    const short = clip(firstLine(command), 48);
    return {
        running: `Running ${short}`,
        done: `Ran ${short}`,
        ...(short === command ? {} : { detail: command }),
    };
}

function fileChangeLabel(item: Extract<ThreadItem, { type: 'fileChange' }>): ItemLabel {
    const changes = item.changes ?? [];
    const [first] = changes;
    if (changes.length === 1 && first) {
        const file = basename(first.path);
        if (first.kind.type === 'add')
            return { running: `Creating ${file}`, done: `Created ${file}` };
        if (first.kind.type === 'delete') {
            return { running: `Deleting ${file}`, done: `Deleted ${file}` };
        }
        return { running: `Editing ${file}`, done: `Edited ${file}` };
    }
    const count = changes.length > 1 ? `${changes.length} files` : 'files';
    return {
        running: `Editing ${count}`,
        done: `Edited ${count}`,
        ...(changes.length > 1
            ? { detail: changes.map(change => basename(change.path)).join(', ') }
            : {}),
    };
}

/** `/bin/zsh -lc 'pnpm test'` is `pnpm test` to the person reading it. */
function withoutShell(command: string): string {
    const inner = /^\S*sh -l?c '(.*)'$/s.exec(command)?.[1];
    return inner === undefined ? command : inner.replaceAll(`'\\''`, `'`);
}

function basename(path: string): string {
    return path.split(/[\\/]/).pop() || path;
}

function firstLine(text: string): string {
    return text.split('\n', 1)[0] ?? '';
}

function clip(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
