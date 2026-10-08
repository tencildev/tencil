import { createElement } from "react";

/**
 * Loads the Fixhere overlay in development from the daemon on this machine
 * (`npx fixhere start`). Renders nothing in production; without a running
 * daemon the script simply doesn't load.
 *
 *   <body>{children}<Fixhere /></body>
 */
export function Fixhere({ port = 4747 }: { port?: number }) {
  if (process.env.NODE_ENV !== "development") return null;
  return createElement("script", { src: `http://localhost:${port}/fixhere.js`, async: true });
}
