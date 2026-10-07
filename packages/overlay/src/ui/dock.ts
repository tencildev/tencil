import { signal } from "@preact/signals";

export type Dock =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

const STORAGE_KEY = "fixhere:dock";
const DOCKS: Dock[] = [
  "top-left",
  "top-center",
  "top-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
];
const DRAG_THRESHOLD = 3;
/** How far ahead a flick carries the toolbar when picking where it lands. */
const MOMENTUM_MS = 120;
/** Drawer-style curve: quick to leave the hand, soft to land. */
const SNAP = "translate 340ms cubic-bezier(0.32, 0.72, 0, 1)";

export const dock = signal<Dock>(readDock());

function readDock(): Dock {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) as Dock | null;
    return stored && DOCKS.includes(stored) ? stored : "bottom-center";
  } catch {
    return "bottom-center";
  }
}

function setDock(next: Dock): void {
  dock.value = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Storage can be blocked; the position just won't persist.
  }
}

/** Viewport thirds pick the column, halves pick the row. */
export function nearestDock(x: number, y: number, width: number, height: number): Dock {
  const column = x < width / 3 ? "left" : x > (width * 2) / 3 ? "right" : "center";
  const row = y < height / 2 ? "top" : "bottom";
  return `${row}-${column}`;
}

/**
 * Drag the toolbar by its grip. The element follows the pointer 1:1 via the
 * `translate` property (it composes with the dock's own `transform`), then
 * snaps into the nearest dock with a FLIP so the landing is animated from
 * wherever it was released.
 */
export function startDrag(event: PointerEvent, element: HTMLElement): void {
  if (event.button !== 0) return;
  const grip = event.currentTarget as HTMLElement;
  try {
    grip.setPointerCapture(event.pointerId);
  } catch {
    // Synthetic or already-released pointers can't be captured; dragging still works.
  }
  const startX = event.clientX;
  const startY = event.clientY;
  let dx = 0;
  let dy = 0;
  let dragging = false;
  let samples: Array<{ x: number; y: number; t: number }> = [];

  element.style.transition = "none";

  const move = (moveEvent: PointerEvent) => {
    dx = moveEvent.clientX - startX;
    dy = moveEvent.clientY - startY;
    if (!dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    dragging = true;
    element.dataset.dragging = "";
    element.style.translate = `${dx}px ${dy}px`;
    samples = [
      ...samples.slice(-4),
      { x: moveEvent.clientX, y: moveEvent.clientY, t: moveEvent.timeStamp },
    ];
  };

  const end = () => {
    grip.removeEventListener("pointermove", move);
    grip.removeEventListener("pointerup", end);
    grip.removeEventListener("pointercancel", end);
    delete element.dataset.dragging;
    if (!dragging) {
      element.style.translate = "";
      element.style.transition = "";
      return;
    }

    // Project the release point forward by the flick velocity.
    const first = samples[0];
    const last = samples[samples.length - 1];
    const elapsed = first && last ? Math.max(1, last.t - first.t) : 1;
    const vx = first && last ? (last.x - first.x) / elapsed : 0;
    const vy = first && last ? (last.y - first.y) / elapsed : 0;
    const rect = barRect(element);
    const target = nearestDock(
      rect.left + rect.width / 2 + vx * MOMENTUM_MS,
      rect.top + rect.height / 2 + vy * MOMENTUM_MS,
      window.innerWidth,
      window.innerHeight,
    );
    settle(element, rect, target);
  };

  grip.addEventListener("pointermove", move);
  grip.addEventListener("pointerup", end);
  grip.addEventListener("pointercancel", end);
}

/** Keyboard alternative: arrows step between docks. */
export function moveDockBy(key: string, element: HTMLElement): boolean {
  const [row, column] = dock.value.split("-") as ["top" | "bottom", "left" | "center" | "right"];
  const columns = ["left", "center", "right"] as const;
  const index = columns.indexOf(column);
  let next: Dock | undefined;
  if (key === "ArrowLeft" && index > 0) next = `${row}-${columns[index - 1]!}`;
  if (key === "ArrowRight" && index < 2) next = `${row}-${columns[index + 1]!}`;
  if (key === "ArrowUp" && row === "bottom") next = `top-${column}`;
  if (key === "ArrowDown" && row === "top") next = `bottom-${column}`;
  if (!next) return false;
  // Keyboard-initiated: move instantly, no animation.
  setDock(next);
  element.style.translate = "";
  return true;
}

function settle(element: HTMLElement, from: DOMRect, target: Dock): void {
  setDock(target);
  // Wait for the dock class to apply, then animate from the release point.
  requestAnimationFrame(() => {
    element.style.translate = "";
    // Measure the bar, not the wrapper: the hint changes the wrapper's alignment per dock.
    const to = barRect(element);
    element.style.translate = `${from.left - to.left}px ${from.top - to.top}px`;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    requestAnimationFrame(() => {
      element.style.transition = reduced ? "none" : SNAP;
      element.style.translate = "0px 0px";
      const cleanup = () => {
        element.style.transition = "";
        element.style.translate = "";
      };
      if (reduced) cleanup();
      else element.addEventListener("transitionend", cleanup, { once: true });
    });
  });
}

function barRect(element: HTMLElement): DOMRect {
  return (element.querySelector(".toolbar") ?? element).getBoundingClientRect();
}
