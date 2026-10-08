import { createElement } from "react";

/**
 * Loads the Fixhere overlay in development. Pair with `withFixhere` in
 * next.config, or pass `src` when running the bridge yourself.
 *
 *   <body>{children}<Fixhere /></body>
 */
export function Fixhere({ src }: { src?: string }) {
  if (process.env.NODE_ENV !== "development") return null;
  const url = src ?? process.env.FIXHERE_SCRIPT_URL;
  if (!url) return null;
  return createElement("script", { src: url, async: true });
}
