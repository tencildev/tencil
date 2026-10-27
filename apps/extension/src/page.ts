/**
 * Runs in the page itself (`world: 'MAIN'`), so the overlay sees what a script tag
 * would: React's fibers on the DOM and the page's own origin. `executeScript`
 * serializes these functions, so each one may only use what's inside its body.
 */

type PageWindow = Window & {
    __TENCIL__?: { destroy(): void };
    /** Set when this extension put Tencil on the page. */
    __TENCIL_EXTENSION__?: boolean;
};

/** `blocked` when the page refused the tag, usually its Content-Security-Policy. */
export type LoadResult = 'loaded' | 'present' | 'blocked';

/** Adds the daemon's own script tag, so the overlay always matches the daemon. */
export function loadScript(src: string): Promise<LoadResult> {
    const page = window as PageWindow;
    if (page.__TENCIL__) return Promise.resolve('present');
    page.__TENCIL_EXTENSION__ = true;
    return new Promise(resolve => {
        const script = document.createElement('script');
        script.src = src;
        script.dataset.tencilExtension = '';
        script.onload = () => resolve('loaded');
        script.onerror = () => {
            script.remove();
            resolve('blocked');
        };
        document.documentElement.append(script);
    });
}

export function isLoaded(): boolean {
    return Boolean((window as PageWindow).__TENCIL_EXTENSION__);
}

export function unload(): void {
    const page = window as PageWindow;
    page.__TENCIL__?.destroy();
    page.__TENCIL_EXTENSION__ = undefined;
    document.querySelector('script[data-tencil-extension]')?.remove();
}
