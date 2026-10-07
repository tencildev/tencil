import type { ComponentFrame, ElementContext } from "@fixhere/protocol";
import { getDisplayName, getFiberFromHostInstance, isCompositeFiber, traverseFiber } from "bippy";
import { getOwnerStack, getRawOwnerStack, isSourceFile } from "bippy/source";

const MAX_FRAMES = 6;
const SOURCE_TIMEOUT_MS = 1500;

export async function captureContext(element: Element): Promise<ElementContext> {
  const rect = element.getBoundingClientRect();
  const selection = window.getSelection()?.toString().trim();
  return {
    tagName: element.tagName.toLowerCase(),
    selector: buildSelector(element),
    html: htmlPreview(element),
    text: visibleText(element),
    components: await componentFrames(element),
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: Math.round(window.devicePixelRatio * 100) / 100,
    },
    ...(selection && element.contains(window.getSelection()?.anchorNode ?? null)
      ? { selection }
      : {}),
  };
}

/** Fast, synchronous label for the hover chip. */
export function quickLabel(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const fiber = safeFiber(element);
  if (!fiber) return tag;
  let name: string | null = null;
  traverseFiber(
    fiber,
    (node) => {
      if (!isCompositeFiber(node)) return false;
      name = getDisplayName(node.type);
      return Boolean(name && !isInternalName(name));
    },
    true,
  );
  return name ? `${name} · ${tag}` : tag;
}

/* --------------------------------- selector -------------------------------- */

/**
 * A selector that should survive re-renders: stable ids and test ids first,
 * then a short nth-of-type path. Verified to match exactly this element.
 */
export function buildSelector(element: Element): string {
  const parts: string[] = [];
  let node: Element | null = element;
  while (node && node !== document.documentElement) {
    const stable = stableSelector(node);
    if (stable) {
      parts.unshift(stable);
      const candidate = parts.join(" > ");
      if (uniquelyMatches(candidate, element)) return candidate;
    } else {
      parts.unshift(positionalSelector(node));
      const candidate = parts.join(" > ");
      if (parts.length >= 2 && uniquelyMatches(candidate, element)) return candidate;
    }
    node = node.parentElement;
  }
  return parts.join(" > ");
}

function stableSelector(element: Element): string | null {
  for (const attribute of ["data-testid", "data-test", "data-cy", "data-fixhere-id"]) {
    const value = element.getAttribute(attribute);
    if (value) return `${element.tagName.toLowerCase()}[${attribute}="${CSS.escape(value)}"]`;
  }
  const id = element.id;
  // Skip generated ids (React useId `:r1:`, numeric suffixes) that change between renders.
  if (id && !/[:«»]|\d{3,}/.test(id)) return `#${CSS.escape(id)}`;
  return null;
}

function positionalSelector(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const parent = element.parentElement;
  if (!parent) return tag;
  const siblings = [...parent.children].filter((child) => child.tagName === element.tagName);
  return siblings.length === 1 ? tag : `${tag}:nth-of-type(${siblings.indexOf(element) + 1})`;
}

function uniquelyMatches(selector: string, element: Element): boolean {
  try {
    const matches = document.querySelectorAll(selector);
    return matches.length === 1 && matches[0] === element;
  } catch {
    return false;
  }
}

/* ----------------------------------- html ---------------------------------- */

const MAX_ATTRIBUTES = 8;
const PRIORITY_ATTRIBUTES = [
  "id",
  "class",
  "href",
  "src",
  "alt",
  "type",
  "name",
  "role",
  "aria-label",
];

export function htmlPreview(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const attributes = [...element.attributes]
    .filter((attribute) => !attribute.name.startsWith("data-fixhere"))
    .sort((a, b) => rank(a.name) - rank(b.name))
    .slice(0, MAX_ATTRIBUTES)
    .map((attribute) => {
      const limit = attribute.name === "class" ? 80 : 120;
      return attribute.value
        ? `${attribute.name}="${truncate(attribute.value, limit)}"`
        : attribute.name;
    });
  const open = `<${[tag, ...attributes].join(" ")}>`;
  const childCount = element.children.length;
  const inner =
    childCount > 0
      ? `…${childCount} element${childCount === 1 ? "" : "s"}…`
      : truncate(element.textContent?.trim() ?? "", 100);
  return `${open}${inner}</${tag}>`;
}

function rank(name: string): number {
  const index = PRIORITY_ATTRIBUTES.indexOf(name);
  return index === -1 ? PRIORITY_ATTRIBUTES.length : index;
}

function visibleText(element: Element): string | undefined {
  const text = (element as HTMLElement).innerText?.replace(/\s+/g, " ").trim();
  return text ? truncate(text, 200) : undefined;
}

/* ------------------------------ react components ------------------------------ */

async function componentFrames(element: Element): Promise<ComponentFrame[]> {
  const fiber = safeFiber(element);
  if (!fiber) return [];
  try {
    const frames = await withTimeout(getOwnerStack(fiber), SOURCE_TIMEOUT_MS);
    const rawPaths = rawPathsByName(fiber);
    const fromStack = frames
      // Lowercase names are host elements (`button`), not components.
      .filter(
        (frame) =>
          frame.functionName &&
          !/^[a-z]/.test(frame.functionName) &&
          !isInternalName(frame.functionName),
      )
      .slice(0, MAX_FRAMES)
      .map((frame) => toComponentFrame(frame, rawPaths.get(frame.functionName!)));
    if (fromStack.length > 0) return fromStack;
  } catch {
    // Owner stacks need React 19 dev builds and fetchable source maps; fall back to names.
  }
  return fiberNames(fiber);
}

/**
 * Source maps often list sources relative to the map (`Hero.tsx`), losing the
 * directory. The unsymbolicated stack still has the served URL
 * (`/src/components/Hero.tsx`), so keep it to restore the full path.
 */
function rawPathsByName(fiber: NonNullable<ReturnType<typeof safeFiber>>): Map<string, string> {
  const paths = new Map<string, string>();
  try {
    for (const frame of getRawOwnerStack(fiber)) {
      if (!frame.functionName || !frame.fileName || paths.has(frame.functionName)) continue;
      paths.set(frame.functionName, projectPath(frame.fileName));
    }
  } catch {
    // Raw stacks are a best-effort enhancement.
  }
  return paths;
}

function toComponentFrame(
  frame: {
    functionName?: string;
    fileName?: string;
    lineNumber?: number;
    columnNumber?: number;
  },
  rawPath?: string,
): ComponentFrame {
  const name = frame.functionName ?? "Anonymous";
  if (!frame.fileName) return { name };
  const library = packageName(frame.fileName);
  if (library) return { name, library };
  if (!isSourceFile(frame.fileName)) return { name };
  return {
    name,
    source: {
      file: resolvePath(projectPath(frame.fileName), rawPath),
      ...(frame.lineNumber != null ? { line: frame.lineNumber } : {}),
      ...(frame.columnNumber != null ? { column: frame.columnNumber } : {}),
    },
  };
}

function fiberNames(fiber: NonNullable<ReturnType<typeof safeFiber>>): ComponentFrame[] {
  const names: ComponentFrame[] = [];
  traverseFiber(
    fiber,
    (node) => {
      if (isCompositeFiber(node)) {
        const name = getDisplayName(node.type);
        if (name && !isInternalName(name)) names.push({ name });
      }
      return names.length >= MAX_FRAMES;
    },
    true,
  );
  return names;
}

function safeFiber(element: Element) {
  try {
    return getFiberFromHostInstance(element);
  } catch {
    return null;
  }
}

/** Framework plumbing that only adds noise to the agent's context. */
function isInternalName(name: string): boolean {
  return (
    /^(?:Anonymous|Fragment|Suspense|StrictMode|Profiler|Provider|Consumer|ErrorBoundary|InnerLayoutRouter|OuterLayoutRouter|RedirectBoundary|NotFoundBoundary|LoadingBoundary|HotReload|Router|AppRouter|ServerRoot|ScrollAndFocusHandler|RenderFromTemplateContext)$/.test(
      name,
    ) || /(?:Provider|Context|Boundary)$/.test(name)
  );
}

/**
 * Dev servers report sources as URLs (`http://localhost:5173/src/App.tsx?t=1`,
 * `/@fs/abs/path`, `webpack-internal:///./src/App.tsx`); reduce them to a
 * project-relative path the agent can open.
 */
/** Prefer the served path when it ends with the symbolicated file name. */
export function resolvePath(symbolicated: string, raw?: string): string {
  if (symbolicated.includes("/") || !raw) return symbolicated;
  return raw.endsWith(`/${symbolicated}`) ? raw : symbolicated;
}

export function projectPath(fileName: string): string {
  let path = fileName;
  if (/^https?:\/\//.test(fileName)) {
    try {
      path = decodeURIComponent(new URL(fileName).pathname);
    } catch {
      // Keep the raw value.
    }
  }
  return path
    .replace(/[?#].*$/, "")
    .replace(/^\/@fs/, "")
    .replace(
      /^(?:webpack-internal:\/\/\/|webpack:\/\/[^/]*\/|turbopack:\/\/\/|rsc:\/\/React\/[^/]+\/|file:\/\/)/,
      "",
    )
    .replace(/^\/?\((?:app-pages-browser|ssr|rsc)\)\//, "")
    .replace(/^\.\//, "")
    .replace(/^\/(?=(?:src|app|pages|components|lib)\/)/, "");
}

function packageName(fileName: string): string | undefined {
  const match = fileName.match(
    /node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)/,
  );
  return match?.[1];
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}
