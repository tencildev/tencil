import { signal } from '@preact/signals';

export type Dock =
    | 'top-left'
    | 'top-center'
    | 'top-right'
    | 'bottom-left'
    | 'bottom-center'
    | 'bottom-right';

const STORAGE_KEY = 'tencil:dock';
const DOCKS: Dock[] = [
    'top-left',
    'top-center',
    'top-right',
    'bottom-left',
    'bottom-center',
    'bottom-right',
];
const DRAG_THRESHOLD = 3;
/** How far ahead a flick carries the toolbar when picking where it lands. */
const MOMENTUM_MS = 120;
/** Drawer-style curve: quick to leave the hand, soft to land. */
const SNAP_MS = 340;
const SNAP = `translate ${SNAP_MS}ms cubic-bezier(0.32, 0.72, 0, 1)`;
/** Only the last stretch of movement counts toward a flick. */
const VELOCITY_WINDOW_MS = 80;
/** px/ms; a flick can carry the toolbar a little way, never across the screen on its own. */
const MAX_SPEED = 2.5;

/** Stops a landing that's still running, e.g. when the toolbar is grabbed mid-flight. */
let cancelSettle: (() => void) | undefined;

export const dock = signal<Dock>(readDock());

function readDock(): Dock {
    try {
        const stored = localStorage.getItem(STORAGE_KEY) as Dock | null;
        return stored && DOCKS.includes(stored) ? stored : 'bottom-center';
    } catch {
        return 'bottom-center';
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
    const column = x < width / 3 ? 'left' : x > (width * 2) / 3 ? 'right' : 'center';
    const row = y < height / 2 ? 'top' : 'bottom';
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
    // Otherwise the browser may start its own drag of whatever is under the toolbar
    // (a link, an image, selected text) and cancel this pointer halfway.
    event.preventDefault();
    const grip = event.currentTarget as HTMLElement;
    try {
        grip.setPointerCapture(event.pointerId);
    } catch {
        // Synthetic or already-released pointers can't be captured; dragging still works.
    }
    // Caught mid-landing: carry on from where it is on screen, not where it was headed.
    const [baseX, baseY] = currentTranslate(element);
    cancelSettle?.();
    element.style.transition = 'none';
    element.style.translate = `${baseX}px ${baseY}px`;
    const startX = event.clientX;
    const startY = event.clientY;
    let dragging = baseX !== 0 || baseY !== 0;
    let samples: Array<{ x: number; y: number; t: number }> = [];

    const move = (moveEvent: PointerEvent) => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        if (!dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        dragging = true;
        element.dataset.dragging = '';
        element.style.translate = `${baseX + dx}px ${baseY + dy}px`;
        samples = [
            ...samples.filter(sample => moveEvent.timeStamp - sample.t < VELOCITY_WINDOW_MS),
            { x: moveEvent.clientX, y: moveEvent.clientY, t: moveEvent.timeStamp },
        ];
    };

    const end = (endEvent: PointerEvent) => {
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', end);
        grip.removeEventListener('pointercancel', end);
        grip.removeEventListener('lostpointercapture', end);
        window.removeEventListener('dragstart', preventNativeDrag, true);
        delete element.dataset.dragging;
        if (!dragging) {
            element.style.translate = '';
            element.style.transition = '';
            return;
        }

        // Project the release point forward by the flick velocity; a pause before letting go is no flick.
        samples = samples.filter(sample => endEvent.timeStamp - sample.t < VELOCITY_WINDOW_MS);
        const first = samples[0];
        const last = samples[samples.length - 1];
        const elapsed = first && last ? Math.max(1, last.t - first.t) : 1;
        const speed = (delta: number) => Math.max(-MAX_SPEED, Math.min(MAX_SPEED, delta / elapsed));
        const vx = first && last ? speed(last.x - first.x) : 0;
        const vy = first && last ? speed(last.y - first.y) : 0;
        const rect = barRect(element);
        const target = nearestDock(
            rect.left + rect.width / 2 + vx * MOMENTUM_MS,
            rect.top + rect.height / 2 + vy * MOMENTUM_MS,
            window.innerWidth,
            window.innerHeight,
        );
        settle(element, rect, target);
    };

    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
    // However the pointer is lost (window switch, a stolen capture), the drag ends and lands.
    grip.addEventListener('lostpointercapture', end);
    window.addEventListener('dragstart', preventNativeDrag, true);
}

function preventNativeDrag(event: DragEvent): void {
    event.preventDefault();
}

/** Keyboard alternative: arrows step between docks. */
export function moveDockBy(key: string, element: HTMLElement): boolean {
    const [row, column] = dock.value.split('-') as ['top' | 'bottom', 'left' | 'center' | 'right'];
    const columns = ['left', 'center', 'right'] as const;
    const index = columns.indexOf(column);
    let next: Dock | undefined;
    if (key === 'ArrowLeft' && index > 0) next = `${row}-${columns[index - 1]!}`;
    if (key === 'ArrowRight' && index < 2) next = `${row}-${columns[index + 1]!}`;
    if (key === 'ArrowUp' && row === 'bottom') next = `top-${column}`;
    if (key === 'ArrowDown' && row === 'top') next = `bottom-${column}`;
    if (!next) return false;
    // Keyboard-initiated: move instantly, no animation.
    setDock(next);
    element.style.translate = '';
    return true;
}

function settle(element: HTMLElement, from: DOMRect, target: Dock): void {
    setDock(target);
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = () => {
        cancelAnimationFrame(frame);
        clearTimeout(timer);
        element.removeEventListener('transitionend', onEnd);
        cancelSettle = undefined;
        element.style.transition = '';
        element.style.translate = '';
    };
    // Children animate too (the bar's lift); only the wrapper's own landing ends it.
    const onEnd = (event: TransitionEvent) => {
        if (event.target === element && event.propertyName === 'translate') done();
    };
    cancelSettle = () => {
        cancelAnimationFrame(frame);
        clearTimeout(timer);
        element.removeEventListener('transitionend', onEnd);
        cancelSettle = undefined;
    };
    // Wait for the dock class to apply, then animate from the release point.
    frame = requestAnimationFrame(() => {
        element.style.translate = '';
        // Measure the bar, not the wrapper: the hint changes the wrapper's alignment per dock.
        const to = barRect(element);
        element.style.translate = `${from.left - to.left}px ${from.top - to.top}px`;
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
            done();
            return;
        }
        frame = requestAnimationFrame(() => {
            element.style.transition = SNAP;
            element.style.translate = '0px 0px';
            element.addEventListener('transitionend', onEnd);
            // No transitionend when it lands exactly where it was let go.
            timer = setTimeout(done, SNAP_MS + 100);
        });
    });
}

/** The wrapper's on-screen offset from its dock, mid-animation included. */
function currentTranslate(element: HTMLElement): [number, number] {
    const value = getComputedStyle(element).translate;
    if (!value || value === 'none') return [0, 0];
    const [x = '0', y = '0'] = value.split(' ');
    return [Number.parseFloat(x) || 0, Number.parseFloat(y) || 0];
}

function barRect(element: HTMLElement): DOMRect {
    return (element.querySelector('.toolbar') ?? element).getBoundingClientRect();
}
