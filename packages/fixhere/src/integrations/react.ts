import { createElement } from 'react';
import { DEFAULT_DAEMON_PORT, overlayLoader } from './loader.ts';

/**
 * Loads the Fixhere overlay in development from the daemon on the machine
 * serving the page (`npx fixhere start`). Renders nothing in production;
 * without a running daemon the script simply doesn't load.
 *
 *   <body>{children}<Fixhere /></body>
 */
export function Fixhere({ port = DEFAULT_DAEMON_PORT }: { port?: number }) {
    if (process.env.NODE_ENV !== 'development') return null;
    // Inline, so the daemon's host follows the page's: the server can't know it.
    return createElement('script', {
        id: 'fixhere-loader',
        // biome-ignore lint/security/noDangerouslySetInnerHtml: our own constant code; the port is a number.
        dangerouslySetInnerHTML: { __html: overlayLoader(port) },
    });
}
