import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

/** Files whose JSX gets source attributes. */
export const JSX_FILE = /\.[jt]sx$/;

/** Host elements that never get picked, or must stay untouched. */
const SKIP = new Set([
    'html',
    'head',
    'meta',
    'link',
    'script',
    'style',
    'title',
    'base',
    'noscript',
    'template',
    'slot',
]);

interface Node {
    type: string;
    start: number;
    end: number;
    [key: string]: unknown;
}

interface Insert {
    at: number;
    text: string;
}

/**
 * Tags every host element (`<button>`, not `<Button>`) with where it's written,
 * `data-tencil-src="src/card.tsx:42:7"`, and the component it's in,
 * `data-tencil-component="Card"`. Production builds drop React's dev source
 * info, so this is how a pin on a preview still knows its file and line.
 *
 * Paths are relative to `root`, the repository root, because that's what the
 * cloud agent checks out. Returns undefined when there's nothing to tag or the
 * file doesn't parse (the bundler will report that itself).
 */
export async function addSourceAttributes(
    code: string,
    id: string,
    root: string,
): Promise<{ code: string; map: unknown } | undefined> {
    const file = id.replace(/[?#].*$/, '');
    if (!JSX_FILE.test(file) || file.includes(`${sep}node_modules${sep}`) || file.includes('\0')) {
        return undefined;
    }
    const path = relative(root, file).split(sep).join('/');
    if (path.startsWith('..')) return undefined;

    const { parseSync } = await import('oxc-parser');
    const lang = file.endsWith('.tsx') ? 'tsx' : 'jsx';
    const parsed = parseSync(file, code, { lang, sourceType: 'module' });
    if (parsed.errors.length > 0) return undefined;

    const lines = lineStarts(code);
    const inserts: Insert[] = [];
    visit(
        parsed.program as unknown as Node,
        undefined,
        node => {
            const opening = node as Node & { name: Node & { name?: string }; attributes: Node[] };
            const tag = opening.name.type === 'JSXIdentifier' ? opening.name.name : undefined;
            if (!tag || !/^[a-z]/.test(tag) || SKIP.has(tag)) return;
            if (opening.attributes.some(isTencilAttribute)) return;
            const { line, column } = position(lines, opening.start);
            return `${path}:${line}:${column}`;
        },
        inserts,
    );
    if (inserts.length === 0) return undefined;

    const { default: MagicString } = await import('magic-string');
    const output = new MagicString(code);
    for (const insert of inserts) output.appendLeft(insert.at, insert.text);
    return {
        code: output.toString(),
        map: output.generateMap({ source: file, includeContent: true, hires: 'boundary' }),
    };
}

/** Walks the AST, tracking the component each JSX element is written in. */
function visit(
    node: Node,
    component: string | undefined,
    sourceOf: (opening: Node) => string | undefined,
    inserts: Insert[],
): void {
    let current = component;
    const named = componentName(node);
    if (named) current = named;

    if (node.type === 'JSXOpeningElement') {
        const source = sourceOf(node);
        if (source) {
            const name = (node.name as Node).end;
            const attributes = [`data-tencil-src={${JSON.stringify(source)}}`];
            if (current) attributes.push(`data-tencil-component={${JSON.stringify(current)}}`);
            inserts.push({ at: name, text: ` ${attributes.join(' ')}` });
        }
    }

    for (const key in node) {
        if (key === 'type' || key === 'start' || key === 'end') continue;
        const value = node[key];
        if (Array.isArray(value)) {
            for (const child of value) if (isNode(child)) visit(child, current, sourceOf, inserts);
        } else if (isNode(value)) {
            visit(value, current, sourceOf, inserts);
        }
    }
}

/** `function Card()`, `const Card = () =>`, `const Card = memo(…)`, `class Card`. */
function componentName(node: Node): string | undefined {
    let name: string | undefined;
    if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') {
        name = (node.id as { name?: string } | null)?.name;
    } else if (node.type === 'VariableDeclarator') {
        const init = node.init as Node | null;
        const isComponent =
            init &&
            (init.type === 'ArrowFunctionExpression' ||
                init.type === 'FunctionExpression' ||
                init.type === 'CallExpression');
        if (isComponent) name = (node.id as { name?: string }).name;
    }
    return name && /^[A-Z]/.test(name) ? name : undefined;
}

function isTencilAttribute(attribute: Node): boolean {
    const name = attribute.name as { name?: string } | undefined;
    return attribute.type === 'JSXAttribute' && name?.name === 'data-tencil-src';
}

function isNode(value: unknown): value is Node {
    return typeof value === 'object' && value !== null && typeof (value as Node).type === 'string';
}

function lineStarts(code: string): number[] {
    const starts = [0];
    for (let i = 0; i < code.length; i++) if (code[i] === '\n') starts.push(i + 1);
    return starts;
}

/** 1-based line and column of an offset. */
function position(starts: number[], offset: number): { line: number; column: number } {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
        const middle = (low + high + 1) >> 1;
        if ((starts[middle] as number) <= offset) low = middle;
        else high = middle - 1;
    }
    return { line: low + 1, column: offset - (starts[low] as number) + 1 };
}

const WORKSPACE_FILES = ['pnpm-workspace.yaml', 'turbo.json', 'nx.json', 'lerna.json'];

/**
 * The repository a build runs in: the nearest folder with `.git`, else the
 * outermost workspace root (some hosts build without `.git`), else `start`.
 */
export function repositoryRoot(start: string): string {
    let workspace: string | undefined;
    for (let dir = start; ; dir = dirname(dir)) {
        if (existsSync(join(dir, '.git'))) return dir;
        if (WORKSPACE_FILES.some(name => existsSync(join(dir, name))) || hasWorkspaces(dir)) {
            workspace = dir;
        }
        if (dirname(dir) === dir) return workspace ?? start;
    }
}

function hasWorkspaces(dir: string): boolean {
    try {
        return 'workspaces' in JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    } catch {
        return false;
    }
}
