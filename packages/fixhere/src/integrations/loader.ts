/** Port of the Fixhere daemon unless configured otherwise. */
export const DEFAULT_DAEMON_PORT = 4747;

/**
 * Browser code that loads the overlay from the daemon on the machine serving
 * the page: `localhost:4747` for a local dev server, `devbox:4747` for one
 * opened as http://devbox:3000. The daemon always speaks plain HTTP.
 */
export function overlayLoader(port: number = DEFAULT_DAEMON_PORT): string {
    return `;(() => {
  if (typeof document === "undefined") return;
  const src = "http://" + location.hostname + ":${Number(port)}/fixhere.js";
  if (document.querySelector('script[src="' + src + '"]')) return;
  const script = document.createElement("script");
  script.src = src;
  script.async = true;
  document.head.appendChild(script);
})();`;
}
