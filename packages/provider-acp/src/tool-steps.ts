import type { StepStatus } from '@tencildev/protocol';
import type { PlanEntry, ToolCall, ToolCallStatus } from './protocol.ts';

/** How a step reads in the overlay. */
export interface StepLabel {
    label: string;
    detail?: string;
}

const MAX_LABEL = 60;

/** What was done, by tool kind, for titles that only name the tool or the file. */
const BY_KIND: Record<string, string> = {
    read: 'Read',
    edit: 'Edit',
    delete: 'Delete',
    move: 'Move',
    search: 'Search',
    execute: 'Run a command',
    think: 'Think',
    fetch: 'Fetch',
    switch_mode: 'Switch mode',
};
/** Kinds whose one-word title is the thing itself: a command, a thought. */
const TITLED_BY_ITSELF = new Set(['execute', 'think', 'other']);

/**
 * A tool call as the agent titled it (`Read src/hero.tsx`, `pnpm test`), in
 * plain text and short enough for one line. A title that's only a tool's or a
 * file's name (`read`, `index.html`) says what was done to which file instead.
 * The detail is the rest of a long title, the file a long title leaves out, or
 * why the call failed.
 */
export function toolLabel(call: ToolCall, cwd: string): StepLabel {
    const file = call.locations
        ?.map(location => location.path)
        .find(path => path && !isFolderOf(path, cwd));
    const name = file ? basename(file) : undefined;
    const verb = BY_KIND[call.kind ?? ''];
    const title = plain(call.title ?? '');
    let full = title || verb || 'Use a tool';
    let where: string | undefined;
    if (verb && !title.includes(' ') && !TITLED_BY_ITSELF.has(call.kind ?? '')) {
        const target = name ?? (/[./\\]/.test(title) ? basename(title) : undefined);
        full = target ? `${verb} ${target}` : verb;
    } else if (file && name && !full.includes(name)) {
        // `Write file` says little alone: name the file, or give its path for a longer title.
        if (full.split(' ').length <= 2) full = `${full} ${name}`;
        else where = relative(file, cwd);
    }
    const label = clip(firstLine(full), MAX_LABEL);
    const failure = call.status === 'failed' ? failureText(call) : undefined;
    const rest = label === full ? undefined : full;
    const detail = failure ?? rest ?? where;
    return detail ? { label, detail } : { label };
}

export function toolStatus(status: ToolCallStatus | null | undefined): StepStatus {
    if (status === 'completed') return 'done';
    if (status === 'failed') return 'failed';
    return 'running';
}

/** What the agent is thinking about: the first line of its thoughts, without markdown. */
export function thoughtLabel(text: string, done: boolean): StepLabel | undefined {
    const detail = clip(plain(firstLine(text.trim())).replace(/^#+\s*/, ''), 120);
    return detail ? { label: done ? 'Thought' : 'Thinking', detail } : undefined;
}

/** A plan as one step: how far along it is, and the entry being worked on. */
export function planLabel(entries: PlanEntry[]): StepLabel & { status: StepStatus } {
    const done = entries.filter(entry => entry.status === 'completed').length;
    const current =
        entries.find(entry => entry.status === 'in_progress') ??
        entries.find(entry => entry.status === 'pending');
    return {
        label: `Plan: ${done} of ${entries.length} done`,
        status: current ? 'running' : 'done',
        ...(current ? { detail: clip(plain(current.content), 120) } : {}),
    };
}

/** The first line of text the tool returned, which says why it failed. */
function failureText(call: ToolCall): string | undefined {
    for (const item of call.content ?? []) {
        if (item.type !== 'content') continue;
        const block = item.content as { type: string; text?: unknown };
        if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
            return clip(firstLine(block.text.trim()), 160);
        }
    }
    return undefined;
}

/** Titles are often markdown: `` Edit `src/a.ts` ``. */
function plain(text: string): string {
    return text
        .replaceAll('`', '')
        .replaceAll('**', '')
        .replace(/[ \t]+/g, ' ')
        .trim();
}

/** The checkout's own folder, or one above it: where the agent is, not what it touched. */
function isFolderOf(path: string, cwd: string): boolean {
    const folder = path.replace(/[\\/]+$/, '');
    return roots(cwd).some(
        root => root === folder || root.startsWith(`${folder}/`) || root.startsWith(`${folder}\\`),
    );
}

function relative(path: string, cwd: string): string {
    for (const root of roots(cwd)) {
        if (path.startsWith(`${root}/`) || path.startsWith(`${root}\\`)) {
            return path.slice(root.length + 1);
        }
    }
    return path;
}

/** The checkout as agents may write it: macOS's /tmp is /private/tmp once resolved. */
function roots(cwd: string): string[] {
    const root = cwd.replace(/[\\/]+$/, '');
    const unresolved = root.replace(/^\/private(?=\/)/, '');
    return unresolved === root ? [root] : [root, unresolved];
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
