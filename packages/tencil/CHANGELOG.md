# tencil

Up to 0.2.0 this package was published as `fixhere`.

## 0.3.1

### Patch Changes

- [`41de998`](https://github.com/pixel-perfect-agency/tencil/commit/41de9989b4c4232ddb69b4743795d8c58e74bbb1) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - The login service now starts the daemon with your shell's PATH (so it finds nvm's npm and npx to pair and to install Claude Code support) and with your XDG_CONFIG_HOME, if set. Setup pairs before it starts the daemon, a daemon whose own pairing failed picks up a pairing made later, and pairing works when Tencil runs under `npx --package`.

## 0.3.0

### Minor Changes

- [`95fa2c3`](https://github.com/pixel-perfect-agency/tencil/commit/95fa2c33cd2b1ed2cd8634b366ca19957d500b2e) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - `npx tencil` on its own now does everything: it sets up the machine the first time (asking whether to start at login), then adds Tencil to the project in the current folder, or lists the apps it finds in a monorepo root. `init` no longer reinstalls `tencil` when the project already depends on it. Login services on a port other than 4747 get their own name and runtime copy, so they never replace the default one, and `service uninstall` removes that copy.

- [#5](https://github.com/pixel-perfect-agency/tencil/pull/5) [`60d3ec4`](https://github.com/pixel-perfect-agency/tencil/commit/60d3ec4dab6842e5053f7f171de885d17905e062) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - Pins can go to Claude Code instead of T3 Code. Setup works out which one you have and only asks when it finds both (or neither); `--provider` answers up front. Each project can switch agents in a new settings dialog (the gear on the toolbar), which is also offered when the current agent isn't running; the choice is saved per project, and pins already made keep their agent. The project picker lists projects from both agents. The daemon runs Claude Code itself through the Claude Agent SDK, under your Claude Code login, in the project's repository root. Each pin is a Claude Code session, and the inbox lists the project's sessions. The SDK is installed into Tencil's config folder the first time it's needed. `--runtime-mode` maps to Claude Code's permission modes, and `--model` takes a plain model name. The overlay only offers **Pair** for providers that support it.

- [`7e1727b`](https://github.com/pixel-perfect-agency/tencil/commit/7e1727bec30b84d3020f91e5193b75d20f912321) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - Fixhere is now Tencil: `npx tencil`, `tencil/react` (`<Tencil />`), `tencil/vite` and tencil.dev. The first `tencil` command moves a Fixhere install over: pins, pairing and settings, its login service and running daemon. In a project, `npx tencil` rewrites the `fixhere/react` or `fixhere/vite` import and swaps the `fixhere` package for `tencil`.

### Patch Changes

- [`eb79704`](https://github.com/pixel-perfect-agency/tencil/commit/eb79704bdaebbf6399a0a61d2669c37908dc2bd6) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - The "Which project is this page?" picker has a search field (Enter picks the first match), and resolving a thread closes its panel.

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
