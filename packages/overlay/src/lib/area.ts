import type { Area, AreaNode, ComponentFrame } from '@tencildev/protocol';
import { componentFrames, openTag, visibleText } from './element-context.ts';
import { type Box, boxModel } from './measure.ts';

/** Elements listed for an area, at most; the rest are counted as `omitted`. */
const MAX_NODES = 24;
/** Levels below the shared parent; wrappers the same size as their parent don't count. */
const MAX_DEPTH = 4;
/** An element must cover this share of the area to be listed. */
const MIN_SHARE = 0.02;
/** Probe spacing in CSS pixels, and the most probes per axis. */
const PROBE_STEP = 14;
const MAX_PROBES = 40;

/** An element the area touches, with the touched elements inside it. */
export interface Touched<T> {
    ref: T;
    rect: Box;
    children: Touched<T>[];
}

export interface Picked<T> {
    ref: T;
    /** Nesting among the picked nodes; 0 is the root. */
    depth: number;
    /** How much of the element is inside the area, 0..1. */
    inside: number;
    /** Some of its children are picked too. */
    parent: boolean;
}

/**
 * Which touched elements to describe: the root, then level by level (so the
 * top of the tree always makes it) every element covering enough of the area,
 * until the cap. Returned outermost first, in document order.
 */
export function pickNodes<T>(
    root: Touched<T>,
    area: Box,
    limits: { maxNodes?: number; maxDepth?: number; minShare?: number } = {},
): { nodes: Picked<T>[]; omitted: number } {
    const maxNodes = limits.maxNodes ?? MAX_NODES;
    const maxDepth = limits.maxDepth ?? MAX_DEPTH;
    const minShare = limits.minShare ?? MIN_SHARE;
    const areaSize = size(area);
    const eligible = (node: Touched<T>) =>
        size(node.rect) > 0 && size(intersect(node.rect, area)) >= areaSize * minShare;

    const kept = new Set<Touched<T>>();
    const queue: Array<{ node: Touched<T>; level: number }> = [{ node: root, level: 0 }];
    while (queue.length > 0 && kept.size < maxNodes) {
        const { node, level } = queue.shift()!;
        kept.add(node);
        for (const child of node.children) {
            if (!eligible(child)) continue;
            const childLevel = level + (sameRect(child.rect, node.rect) ? 0 : 1);
            if (childLevel <= maxDepth) queue.push({ node: child, level: childLevel });
        }
    }

    const nodes: Picked<T>[] = [];
    const walk = (node: Touched<T>, depth: number) => {
        const children = node.children.filter(child => kept.has(child));
        nodes.push({
            ref: node.ref,
            depth,
            inside: share(node.rect, area),
            parent: children.length > 0,
        });
        for (const child of children) walk(child, depth + 1);
    };
    walk(root, 0);

    const countEligible = (node: Touched<T>): number =>
        node.children.filter(eligible).reduce((sum, child) => sum + 1 + countEligible(child), 0);
    return { nodes, omitted: Math.max(0, 1 + countEligible(root) - nodes.length) };
}

/** The smallest element containing every hit, never above `body`. */
export function sharedParent(hits: Element[]): Element | null {
    let parent: Element | null = hits[0] ?? null;
    for (const hit of hits) {
        while (parent && !parent.contains(hit)) parent = parent.parentElement;
    }
    if (!parent || parent === document.documentElement) return document.body;
    return parent;
}

/**
 * The visible elements under the area: what the browser hit-tests on top at a
 * grid of points. Elements hidden behind others aren't what the user sees, so
 * they're left out.
 */
export function probeArea(area: Box, host: Element): Element[] {
    const columns = Math.min(
        MAX_PROBES,
        Math.max(2, Math.ceil((area.right - area.left) / PROBE_STEP)),
    );
    const rows = Math.min(
        MAX_PROBES,
        Math.max(2, Math.ceil((area.bottom - area.top) / PROBE_STEP)),
    );
    const hits = new Set<Element>();
    for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
            const x = area.left + ((column + 0.5) / columns) * (area.right - area.left);
            const y = area.top + ((row + 0.5) / rows) * (area.bottom - area.top);
            const hit = topElementAt(x, y, host);
            if (hit) hits.add(hit);
        }
    }
    return [...hits];
}

function topElementAt(x: number, y: number, host: Element): Element | null {
    for (const element of document.elementsFromPoint(x, y)) {
        if (element === host || host.contains(element)) continue;
        if (element === document.documentElement) continue;
        // Shapes inside an icon are the icon.
        if (element instanceof SVGElement && element.ownerSVGElement) {
            let svg: SVGSVGElement = element.ownerSVGElement;
            while (svg.ownerSVGElement) svg = svg.ownerSVGElement;
            return svg;
        }
        return element;
    }
    return null;
}

/** The elements between `root` and each hit, as a tree in document order. */
export function touchedTree(root: Element, hits: Element[]): Touched<Element> {
    const nodes = new Map<Element, Touched<Element>>();
    const nodeFor = (element: Element) => {
        let node = nodes.get(element);
        if (!node) {
            node = { ref: element, rect: boxOfElement(element), children: [] };
            nodes.set(element, node);
        }
        return node;
    };
    const top = nodeFor(root);
    for (const hit of hits) {
        let child: Element = hit;
        while (child !== root && root.contains(child)) {
            const parent = child.parentElement;
            if (!parent) break;
            const parentNode = nodeFor(parent);
            const childNode = nodeFor(child);
            if (!parentNode.children.includes(childNode)) parentNode.children.push(childNode);
            child = parent;
        }
    }
    for (const node of nodes.values()) {
        node.children.sort((a, b) =>
            a.ref.compareDocumentPosition(b.ref) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
        );
    }
    return top;
}

export interface AreaCapture {
    /** The element holding everything in the area: the pin goes on it. */
    root: Element;
    /** How many listed elements sit one level below the root. */
    parts: number;
    /** Layout is read now; component names resolve later. */
    area: Promise<Area>;
}

/** What's under a dragged box, read synchronously so it matches what the user saw. */
export function captureArea(area: Box, host: Element): AreaCapture | null {
    const hits = probeArea(area, host);
    const root = sharedParent(hits);
    if (!root) return null;
    const { nodes, omitted } = pickNodes(touchedTree(root, hits), area);
    const listed = new Set(nodes.map(node => node.ref));
    const described = nodes.map(node => {
        const rect = node.ref.getBoundingClientRect();
        const style = getComputedStyle(node.ref);
        return {
            element: node.ref,
            depth: node.depth,
            base: {
                depth: node.depth,
                tagName: node.ref.tagName.toLowerCase(),
                html: clip(openTag(node.ref), 300),
                rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                inside: Math.round(node.inside * 100) / 100,
                box: boxModel(node.ref),
                ...(node.parent ? { layout: layoutOf(style) } : {}),
                ...(listed.has(previousRendered(node.ref) as Element) ? { adjacent: true } : {}),
                ...(!node.parent ? optional('text', visibleText(node.ref, 120)) : {}),
            } satisfies AreaNode,
        };
    });
    return {
        root,
        parts: described.filter(node => node.depth === 1).length,
        area: (async () => {
            const components = await Promise.all(
                described.map(node => componentFrames(node.element).catch(() => [])),
            );
            // Name a node's component only where it changes from its parent's.
            const parents: Array<ComponentFrame | undefined> = [];
            const result = described.map((node, index) => {
                const component = components[index]?.[0];
                const parent = node.depth > 0 ? parents[node.depth - 1] : undefined;
                parents[node.depth] = component;
                const changed = component && !sameFrame(component, parent);
                return { ...node.base, ...(changed ? { component } : {}) };
            });
            return {
                rect: {
                    x: area.left,
                    y: area.top,
                    width: area.right - area.left,
                    height: area.bottom - area.top,
                },
                nodes: result,
                ...(omitted > 0 ? { omitted } : {}),
            };
        })(),
    };
}

function clip(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** The element sibling before this one that takes up space, skipping hidden ones. */
function previousRendered(element: Element): Element | null {
    let sibling = element.previousElementSibling;
    while (sibling) {
        const rect = sibling.getBoundingClientRect();
        if (rect.width > 0 || rect.height > 0) return sibling;
        sibling = sibling.previousElementSibling;
    }
    return null;
}

function layoutOf(style: CSSStyleDeclaration): string {
    if (/flex/.test(style.display)) return `${style.display} ${style.flexDirection}`;
    return style.display;
}

function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
    return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
}

function sameFrame(a: ComponentFrame, b: ComponentFrame | undefined): boolean {
    return (
        b !== undefined &&
        a.name === b.name &&
        a.source?.file === b.source?.file &&
        a.source?.line === b.source?.line
    );
}

function boxOfElement(element: Element): Box {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
}

export function intersect(a: Box, b: Box): Box {
    return {
        left: Math.max(a.left, b.left),
        top: Math.max(a.top, b.top),
        right: Math.min(a.right, b.right),
        bottom: Math.min(a.bottom, b.bottom),
    };
}

function size(box: Box): number {
    return Math.max(0, box.right - box.left) * Math.max(0, box.bottom - box.top);
}

function share(rect: Box, area: Box): number {
    const total = size(rect);
    return total > 0 ? Math.min(1, size(intersect(rect, area)) / total) : 0;
}

function sameRect(a: Box, b: Box): boolean {
    return (
        Math.abs(a.left - b.left) < 1 &&
        Math.abs(a.top - b.top) < 1 &&
        Math.abs(a.right - b.right) < 1 &&
        Math.abs(a.bottom - b.bottom) < 1
    );
}
