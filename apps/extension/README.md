# Tencil for Chrome

Loads the Tencil overlay into a running app without adding the script tag or a
framework integration. Click the toolbar button on a page and Tencil is on; click
again to turn it off.

## Try it

```sh
pnpm --filter @tencildev/extension... build
tencil start
```

Then `chrome://extensions` → Developer mode → Load unpacked → `apps/extension/dist`.

## How it works

- The click adds `<script src="http://localhost:4747/tencil.js">` to the page, in its
  main world (`src/page.ts`), so the overlay is the daemon's own version and can read
  React's fibers for component names and source locations.
- If the page's CSP blocks that tag, it injects the overlay bundled into the extension
  instead (`overlay.js`), which the CSP doesn't apply to.
- On local dev servers (`localhost`, `127.0.0.1`, `*.localhost`) the site is
  remembered and Tencil loads again on every reload. Other sites get it for the
  current page only.
- The badge shows `ON`, or `!` when the daemon isn't running.
- The icons in `public/` are `icon.svg` (the Tencil mark, as on tencil.dev) rendered at 16, 32, 48
  and 128 px (the 128 one with the store's 16 px border).

Limits: a strict `connect-src` CSP still blocks the overlay's connection to the
daemon. Sites that aren't on localhost need `tencil start --allow-origin <origin>`, and
the overlay asks which project they belong to.
