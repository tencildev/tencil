import { createElement } from 'react';
import { cloudLoader, resolveCloudBuild, type TencilCloudOptions } from './cloud.ts';
import { DEFAULT_DAEMON_PORT, overlayLoader } from './loader.ts';

let warned = false;

/**
 * Loads the Tencil overlay in development from the daemon on the machine
 * serving the page (`npx tencil start`); without a running daemon the script
 * simply doesn't load.
 *
 * Outside development it renders nothing, unless TENCIL_CLOUD is set for a
 * preview deployment: then it loads the overlay from Tencil Cloud. That needs
 * the env at render time, so keep `<Tencil />` in a server component (the root
 * layout or `_document`).
 *
 *   <body>{children}<Tencil /></body>
 */
export function Tencil({
    port = DEFAULT_DAEMON_PORT,
    cloud,
}: {
    port?: number;
    cloud?: TencilCloudOptions;
}) {
    if (process.env.NODE_ENV === 'development') return script(overlayLoader(port));
    // In a browser bundle `process.env` holds only what the bundler inlined.
    const resolved = resolveCloudBuild(typeof process === 'undefined' ? {} : process.env, cloud);
    if (resolved.kind === 'refused' && !warned) {
        warned = true;
        console.warn(`[tencil] Not loading Tencil Cloud. ${resolved.reason}`);
    }
    return resolved.kind === 'on' ? script(cloudLoader(resolved)) : null;
}

function script(code: string) {
    // Inline, so the daemon's host follows the page's: the server can't know it.
    return createElement('script', {
        id: 'tencil-loader',
        // biome-ignore lint/security/noDangerouslySetInnerHtml: our own constant code; values are JSON-escaped.
        dangerouslySetInnerHTML: { __html: code },
    });
}
