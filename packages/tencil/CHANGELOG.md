# tencil

Up to 0.2.0 this package was published as `fixhere`.

## 0.2.0

### Minor Changes

- [`bb1db0b`](https://github.com/pixel-perfect-agency/fixhere/commit/bb1db0bdb764bf1ff01c9fb8bfc00ebd422f4a1b) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - Add `npx fixhere setup`: one command per machine that starts Fixhere, asks whether it should start when you log in (yes by default) and pairs with T3 Code. The login service now works from npx: it keeps its own copy of Fixhere in `~/.config/fixhere/runtime`. `start` and `init` update a login service in place instead of fighting it for the port, and `stop` stops it until the next login.

## 0.1.1

### Patch Changes

- [`2a76c25`](https://github.com/pixel-perfect-agency/fixhere/commit/2a76c25405c52a37ed1bae7d5716e9b63f5853ed) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - Restarting the daemon (after an upgrade, or from `fixhere init`) keeps the flags it was started with, such as `--listen` and `--allow-origin`. `fixhere start` with different flags now restarts the daemon instead of ignoring them.

- [`be3fc37`](https://github.com/pixel-perfect-agency/fixhere/commit/be3fc377ef9e01bd267b8111965b4051b44babd3) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - `<Fixhere />` and the Vite plugin load the overlay from the daemon on the machine serving the page, so a dev server opened as `http://devbox:3000` reaches the daemon on `devbox` (start it with `--listen` and `--allow-origin`) instead of `localhost`.

## 0.1.0

### Minor Changes

- [`734fdd5`](https://github.com/pixel-perfect-agency/fixhere/commit/734fdd5897871a3363b03dc344db598744b875f9) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - First release: pin prompts on any element of your running app and let T3 Code fix it. Includes `fixhere init` for Next.js and Vite, automatic pairing with a local T3 Code, and continuing existing T3 Code threads from the browser.

- [`d65ab32`](https://github.com/pixel-perfect-agency/fixhere/commit/d65ab32e841346c5ebd8fe66482e33b64955588b) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - Add `--listen <address>` so a browser on another machine (for example over Tailscale) can reach the daemon. Requests without an Origin are now only trusted from this machine.

### Patch Changes

- [`5966b8b`](https://github.com/pixel-perfect-agency/fixhere/commit/5966b8bb75d801dc2e16590e92facf28e07972f1) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - Pins work on dev servers opened by host name over plain HTTP (for example `http://devbox:3000`), where browsers don't offer `crypto.randomUUID`.

- [`354136a`](https://github.com/pixel-perfect-agency/fixhere/commit/354136ac84966113da7990340c54255c1aa2bb28) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - A T3 Code project above the page's git repository (such as `~/Code`) no longer captures its pins; Fixhere adds the repository as its own project instead.

- [`e49b525`](https://github.com/pixel-perfect-agency/fixhere/commit/e49b5251b611c0d1f03c469206780ab7f0565c59) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - Screenshots are now opt-in: the composer's camera toggle starts off.
