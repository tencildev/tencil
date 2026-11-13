import type { StepKind, ThreadStep } from '@tencildev/protocol';

/** "Read 3 files, edited 2 files" reads better than "5 steps", up to three kinds. */
export function summary(steps: ThreadStep[]): string {
    const counts = new Map<StepKind | 'other', number>();
    for (const step of steps) {
        const kind = step.kind ?? 'other';
        counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
    if (counts.has('other') || counts.size > 3) {
        return `${steps.length} ${steps.length === 1 ? 'step' : 'steps'}`;
    }
    const text = [...counts].map(([kind, n]) => phrase(kind as StepKind, n)).join(', ');
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function phrase(kind: StepKind, n: number): string {
    const plural = (word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
    switch (kind) {
        case 'read':
            return `read ${plural('file')}`;
        case 'search':
            return `searched ${n === 1 ? 'once' : `${n} times`}`;
        case 'edit':
            return `edited ${plural('file')}`;
        case 'command':
            return `ran ${plural('command')}`;
        case 'web':
            return `browsed ${plural('page')}`;
        case 'agent':
            return `delegated ${n === 1 ? 'once' : `${n} times`}`;
        case 'tool':
            return `used ${plural('tool')}`;
    }
}

/** A running clock: `m:ss`. */
export function clock(ms: number): string {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function duration(step: ThreadStep): string {
    if (!step.endedAt) return '';
    return formatSeconds((Date.parse(step.endedAt) - Date.parse(step.startedAt)) / 1000);
}

/** From the first step's start to the last one's end. */
export function elapsed(steps: ThreadStep[]): string {
    const first = steps[0];
    const ends = steps.map(step => step.endedAt).filter((end): end is string => !!end);
    if (!first || ends.length === 0) return '';
    const last = ends.reduce((a, b) => (a > b ? a : b));
    return formatSeconds((Date.parse(last) - Date.parse(first.startedAt)) / 1000);
}

function formatSeconds(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0.1) return '';
    if (seconds < 10) return `${seconds.toFixed(1)}s`;
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ${String(Math.round(seconds % 60)).padStart(2, '0')}s`;
}
