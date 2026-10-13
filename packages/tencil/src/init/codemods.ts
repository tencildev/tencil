/**
 * Source edits for `tencil init`. Each takes a file's contents and returns
 * the edited contents, the same string when Tencil is already wired in, or
 * null when the file doesn't have a shape we can safely edit (the caller then
 * prints manual instructions). They follow the file's own quote, semicolon
 * and indentation style.
 */

interface Style {
    quote: '"' | "'";
    semi: string;
    indent: string;
}

export function detectStyle(source: string): Style {
    const singles = (source.match(/^import .*'[^']+';?$/gm) ?? []).length;
    const doubles = (source.match(/^import .*"[^"]+";?$/gm) ?? []).length;
    // Codebases without semicolons essentially never end a line with one.
    const usesSemicolons = /;[ \t]*$/m.test(source);
    const indent = source.match(/^( +|\t)\S/m)?.[1] ?? '  ';
    return {
        quote: singles > doubles ? "'" : '"',
        semi: usesSemicolons || source.trim() === '' ? ';' : '',
        indent: indent === '\t' ? '\t' : indent.length >= 4 ? '    ' : '  ',
    };
}

/** Insert an import after the last top-level import (or after directives). */
export function addImport(source: string, statement: string): string {
    const imports = [
        ...source.matchAll(/^import\s[\s\S]*?\sfrom\s+['"][^'"]+['"];?[ \t]*$/gm),
        ...source.matchAll(/^import\s+['"][^'"]+['"];?[ \t]*$/gm),
    ];
    const end = Math.max(-1, ...imports.map(m => (m.index ?? 0) + m[0].length));
    if (end >= 0) return `${source.slice(0, end)}\n${statement}${source.slice(end)}`;
    const directive = source.match(/^(?:\s*(['"])use [a-z]+\1;?\s*\n)+/);
    const at = directive ? directive[0].length : 0;
    return `${source.slice(0, at)}${statement}\n${at === 0 ? '\n' : ''}${source.slice(at)}`;
}

/** `plugins: [react()]` → `plugins: [react(), tencil()]`, plus the import. */
export function addVitePlugin(source: string): string | null {
    if (/["']tencil\/vite["']/.test(source)) return source;
    const style = detectStyle(source);
    let edited: string | null = null;

    const plugins = /plugins\s*:\s*\[/.exec(source);
    if (plugins) {
        const open = plugins.index + plugins[0].length - 1;
        const close = matchBracket(source, open);
        if (close === -1) return null;
        const inner = source.slice(open + 1, close);
        if (inner.includes('\n')) {
            const lastContent = inner.trimEnd();
            const indent = inner.match(/\n([ \t]*)\S/)?.[1] ?? style.indent.repeat(2);
            const comma = lastContent.trim() === '' || lastContent.endsWith(',') ? '' : ',';
            const insertAt = open + 1 + lastContent.length;
            edited = `${source.slice(0, insertAt)}${comma}\n${indent}tencil(),${source.slice(insertAt)}`;
        } else {
            const trimmed = inner.trim().replace(/,$/, '');
            edited = `${source.slice(0, open + 1)}${trimmed ? `${trimmed}, ` : ''}tencil()${source.slice(close)}`;
        }
    } else {
        const config = /defineConfig\(\s*\{/.exec(source);
        if (!config) return null;
        const at = config.index + config[0].length;
        edited = `${source.slice(0, at)}\n${style.indent}plugins: [tencil()],${source.slice(at)}`;
    }

    return addImport(
        edited,
        `import tencil from ${style.quote}tencil/vite${style.quote}${style.semi}`,
    );
}

/** Render `<Tencil />` as the last child of `<body>` in a layout or _document. */
export function addTencilToBody(source: string): string | null {
    if (/["']tencil\/react["']/.test(source)) return source;
    const style = detectStyle(source);
    const close = source.lastIndexOf('</body>');
    if (close === -1) return null;

    const lineStart = source.lastIndexOf('\n', close) + 1;
    const before = source.slice(lineStart, close);
    let edited: string;
    if (before.trim() === '') {
        // `</body>` on its own line: add a line above it, one level deeper.
        edited = `${source.slice(0, lineStart)}${before}${style.indent}<Tencil />\n${source.slice(lineStart)}`;
    } else {
        edited = `${source.slice(0, close)}<Tencil />${source.slice(close)}`;
    }
    return addImport(
        edited,
        `import { Tencil } from ${style.quote}tencil/react${style.quote}${style.semi}`,
    );
}

/**
 * `export default nextConfig` → `export default withTencil(nextConfig)`, plus
 * the import. Wraps whatever is exported, including another plugin's wrapper.
 */
export function addWithTencil(source: string): string | null {
    if (/["']tencil\/next["']/.test(source)) return source;
    const style = detectStyle(source);
    const exported = /^export\s+default\s+/m.exec(source);
    if (!exported) return null;
    const start = exported.index + exported[0].length;
    const end = expressionEnd(source, start);
    if (end === -1) return null;
    const expression = source.slice(start, end).trimEnd();
    if (!expression || /^(?:function|class|async)\b/.test(expression)) return null;
    const edited = `${source.slice(0, start)}withTencil(${expression})${source.slice(start + expression.length)}`;
    return addImport(
        edited,
        `import { withTencil } from ${style.quote}tencil/next${style.quote}${style.semi}`,
    );
}

/** Where the expression starting at `start` ends: `;`, or a newline outside brackets. */
function expressionEnd(source: string, start: number): number {
    for (let i = start; i < source.length; i++) {
        const char = source[i]!;
        if (char === '"' || char === "'" || char === '`') i = skipString(source, i);
        else if (char === '(' || char === '[' || char === '{') {
            i = matchBracket(source, i);
            if (i === -1) return -1;
        } else if (char === ';' || char === '\n') return i;
    }
    return source.length;
}

/** Index of the bracket closing the one at `open`, skipping strings and comments. */
function matchBracket(source: string, open: number): number {
    const pairs: Record<string, string> = { '[': ']', '(': ')', '{': '}' };
    const stack: string[] = [];
    for (let i = open; i < source.length; i++) {
        const char = source[i]!;
        if (char === '"' || char === "'" || char === '`') {
            i = skipString(source, i);
            continue;
        }
        if (char === '/' && source[i + 1] === '/') {
            i = source.indexOf('\n', i);
            if (i === -1) return -1;
            continue;
        }
        if (char === '/' && source[i + 1] === '*') {
            i = source.indexOf('*/', i + 2) + 1;
            if (i === 0) return -1;
            continue;
        }
        if (pairs[char]) stack.push(pairs[char]);
        else if (char === stack.at(-1)) {
            stack.pop();
            if (stack.length === 0) return i;
        }
    }
    return -1;
}

function skipString(source: string, start: number): number {
    const quote = source[start];
    for (let i = start + 1; i < source.length; i++) {
        if (source[i] === '\\') i++;
        else if (source[i] === quote) return i;
    }
    return source.length;
}
