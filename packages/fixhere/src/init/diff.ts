/**
 * Minimal line diff for previewing `fixhere init` edits: changed lines with
 * a little context, formatted by the caller's color functions.
 */
export interface DiffLine {
    kind: 'same' | 'add' | 'remove';
    text: string;
}

export function diffLines(before: string, after: string): DiffLine[] {
    const a = before.split('\n');
    const b = after.split('\n');
    // Longest common subsequence table; files edited by init are small.
    const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i--) {
        for (let j = b.length - 1; j >= 0; j--) {
            lcs[i]![j] =
                a[i] === b[j]
                    ? lcs[i + 1]![j + 1]! + 1
                    : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
        }
    }
    const out: DiffLine[] = [];
    let i = 0;
    let j = 0;
    while (i < a.length || j < b.length) {
        if (i < a.length && j < b.length && a[i] === b[j]) {
            out.push({ kind: 'same', text: a[i++]! });
            j++;
        } else if (i < a.length && (j === b.length || lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) {
            // Removals first, so a replaced line reads old → new.
            out.push({ kind: 'remove', text: a[i++]! });
        } else {
            out.push({ kind: 'add', text: b[j++]! });
        }
    }
    return out;
}

/** Keep `context` unchanged lines around each change; collapse the rest. */
export function hunks(lines: DiffLine[], context = 2): Array<DiffLine | '…'> {
    const keep = new Set<number>();
    lines.forEach((line, index) => {
        if (line.kind === 'same') return;
        for (let k = index - context; k <= index + context; k++) keep.add(k);
    });
    const out: Array<DiffLine | '…'> = [];
    let skipped = false;
    lines.forEach((line, index) => {
        if (keep.has(index)) {
            out.push(line);
            skipped = false;
        } else if (!skipped) {
            out.push('…');
            skipped = true;
        }
    });
    return out;
}
