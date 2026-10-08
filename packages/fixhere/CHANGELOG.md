# fixhere

## 0.1.0

### Minor Changes

- [`734fdd5`](https://github.com/pixel-perfect-agency/fixhere/commit/734fdd5897871a3363b03dc344db598744b875f9) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - First release: pin prompts on any element of your running app and let T3 Code fix it. Includes `fixhere init` for Next.js and Vite, automatic pairing with a local T3 Code, and continuing existing T3 Code threads from the browser.

- [`d65ab32`](https://github.com/pixel-perfect-agency/fixhere/commit/d65ab32e841346c5ebd8fe66482e33b64955588b) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - Add `--listen <address>` so a browser on another machine (for example over Tailscale) can reach the daemon. Requests without an Origin are now only trusted from this machine.

### Patch Changes

- [`5966b8b`](https://github.com/pixel-perfect-agency/fixhere/commit/5966b8bb75d801dc2e16590e92facf28e07972f1) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - Pins work on dev servers opened by host name over plain HTTP (for example `http://devbox:3000`), where browsers don't offer `crypto.randomUUID`.

- [`354136a`](https://github.com/pixel-perfect-agency/fixhere/commit/354136ac84966113da7990340c54255c1aa2bb28) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - A T3 Code project above the page's git repository (such as `~/Code`) no longer captures its pins; Fixhere adds the repository as its own project instead.

- [`e49b525`](https://github.com/pixel-perfect-agency/fixhere/commit/e49b5251b611c0d1f03c469206780ab7f0565c59) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - Screenshots are now opt-in: the composer's camera toggle starts off.
