import type { StepKind, ThreadStep } from '@tencildev/protocol';

/** How a tool call reads in the overlay, while running and once done. */
export interface ToolLabel {
    kind: StepKind;
    running: string;
    done: string;
    detail?: string;
}

/** Tools that only bookkeep for the agent; showing them would be noise. */
const HIDDEN = new Set(['TodoWrite', 'TodoRead', 'ExitPlanMode', 'ToolSearch']);

/** `undefined` for tools the overlay doesn't show. */
export function toolLabel(name: string, input: unknown): ToolLabel | undefined {
    if (HIDDEN.has(name)) return undefined;
    const args = (input ?? {}) as Record<string, unknown>;
    const text = (key: string) => (typeof args[key] === 'string' ? (args[key] as string) : '');
    switch (name) {
        case 'Read': {
            const file = basename(text('file_path'));
            return { kind: 'read', running: `Reading ${file}`, done: `Read ${file}` };
        }
        case 'Glob':
            return {
                kind: 'search',
                running: `Finding ${text('pattern')}`,
                done: `Found ${text('pattern')}`,
            };
        case 'Grep':
            return {
                kind: 'search',
                running: `Searching for ${clip(text('pattern'), 40)}`,
                done: `Searched for ${clip(text('pattern'), 40)}`,
            };
        case 'Edit':
        case 'MultiEdit':
        case 'NotebookEdit': {
            const file = basename(text('file_path') || text('notebook_path'));
            return { kind: 'edit', running: `Editing ${file}`, done: `Edited ${file}` };
        }
        case 'Write': {
            const file = basename(text('file_path'));
            return { kind: 'edit', running: `Writing ${file}`, done: `Wrote ${file}` };
        }
        case 'Bash': {
            const command = firstLine(text('command'));
            return {
                kind: 'command',
                running: `Running ${clip(command, 48)}`,
                done: `Ran ${clip(command, 48)}`,
                detail: text('description') || undefined,
            };
        }
        case 'WebSearch':
            return {
                kind: 'web',
                running: `Searching the web for ${clip(text('query'), 36)}`,
                done: `Searched the web for ${clip(text('query'), 36)}`,
            };
        case 'WebFetch': {
            const host = hostOf(text('url'));
            return { kind: 'web', running: `Fetching ${host}`, done: `Fetched ${host}` };
        }
        case 'Task':
        case 'Agent': {
            const what = text('description') || 'a subagent';
            return { kind: 'agent', running: `Delegating: ${what}`, done: `Delegated: ${what}` };
        }
        default: {
            // MCP tools arrive as `mcp__server__tool`.
            const tool = name.startsWith('mcp__') ? (name.split('__').pop() ?? name) : name;
            return { kind: 'tool', running: `Using ${tool}`, done: `Used ${tool}` };
        }
    }
}

/**
 * The steps of one turn, keyed by tool use id: started when Claude calls a
 * tool, finished when its result comes back.
 */
export class ToolSteps {
    readonly #open = new Map<string, { step: ThreadStep; label: ToolLabel }>();

    start(
        id: string,
        name: string,
        input: unknown,
        now: string,
        parentId?: string,
    ): ThreadStep | undefined {
        if (this.#open.has(id)) return undefined;
        const label = toolLabel(name, input);
        if (!label) return undefined;
        const step: ThreadStep = {
            id,
            label: label.running,
            status: 'running',
            kind: label.kind,
            ...(label.detail ? { detail: label.detail } : {}),
            ...(parentId ? { parentId } : {}),
            startedAt: now,
        };
        this.#open.set(id, { step, label });
        return step;
    }

    finish(id: string, failed: boolean, now: string): ThreadStep | undefined {
        const open = this.#open.get(id);
        if (!open) return undefined;
        this.#open.delete(id);
        return {
            ...open.step,
            // A failed call keeps what it tried; the overlay marks it failed.
            label: failed ? open.label.running : open.label.done,
            status: failed ? 'failed' : 'done',
            endedAt: now,
        };
    }

    /** The turn ended (or was stopped) with these still out. */
    abandon(now: string): ThreadStep[] {
        const steps = [...this.#open.values()].map(({ step }) => ({
            ...step,
            status: 'skipped' as const,
            endedAt: now,
        }));
        this.#open.clear();
        return steps;
    }
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

function hostOf(url: string): string {
    try {
        return new URL(url).host;
    } catch {
        return clip(url, 40);
    }
}
