# tencil

Up to 0.2.0 this package was published as `fixhere`.

## 0.4.0

### Minor Changes

- [`9fda77b`](https://github.com/tencildev/tencil/commit/9fda77b7f2e8ddb6af29fad543e0acf4aa6f4d28) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - Batch comments: use the new batch toggle in the comment box to queue comments instead of sending each one right away, then send them all with Send in the toolbar. Batch mode is on by default and can be turned off per project in the settings, which removes the toggle. They go to the agent as one thread, numbered like their pins, and every pin in the batch opens that conversation. Queued comments survive a reload and can be rewritten or deleted before sending. The settings now open from the toolbar, next to it wherever it's docked.

- [`93ee277`](https://github.com/tencildev/tencil/commit/93ee277a2cf347a538d0be5ad66b6a3809798180) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - Drag a pin to move it: it re-anchors to the element you drop it on. Threads now open at their latest message and follow the agent's answer as it streams, unless you scroll up to read. Pins also follow the page when it scrolls.

- [`9fda77b`](https://github.com/tencildev/tencil/commit/9fda77b7f2e8ddb6af29fad543e0acf4aa6f4d28) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - Pick the agent and model a new pin runs on, right in the comment box; the choice is saved per project. Without a pick, T3 Code pins now follow T3 Code's own default model (per project, then for all projects), else the model of your latest thread in that project, instead of always starting on Codex.

- [`9fda77b`](https://github.com/tencildev/tencil/commit/9fda77b7f2e8ddb6af29fad543e0acf4aa6f4d28) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - Hover (or focus) the toolbar's status dot to see how Tencil is connected: the daemon and its address, the page's project, and the agent with its state.

### Patch Changes

- Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - Tencil is now licensed under the Apache License 2.0 instead of MIT.

- [`9fda77b`](https://github.com/tencildev/tencil/commit/9fda77b7f2e8ddb6af29fad543e0acf4aa6f4d28) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - The toolbar stands beside Next.js's dev tools button when both are in the same corner, instead of sitting under it. Dragging the toolbar is reliable again: it no longer gets dropped halfway when it starts over a link or image (the browser took over to drag that instead), its landing isn't cut short, and grabbing it mid-landing no longer makes it jump.

## 0.3.2

### Patch Changes

- Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - An older Tencil (npx reuses what it cached for `npx tencil`) no longer replaces a newer daemon or login service; it says to use `npx tencil@latest`. Setup, start and `npx tencil` mention when a newer version is out, and setup says whether the project you run it in already loads Tencil.

## 0.3.1

### Patch Changes

- Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - The login service now starts the daemon with your shell's PATH (so it finds nvm's npm and npx to pair and to install Claude Code support) and with your XDG_CONFIG_HOME, if set. Setup pairs before it starts the daemon, a daemon whose own pairing failed picks up a pairing made later, and pairing works when Tencil runs under `npx --package`.

## 0.3.0

### Minor Changes

- Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - `npx tencil` on its own now does everything: it sets up the machine the first time (asking whether to start at login), then adds Tencil to the project in the current folder, or lists the apps it finds in a monorepo root. `init` no longer reinstalls `tencil` when the project already depends on it. Login services on a port other than 4747 get their own name and runtime copy, so they never replace the default one, and `service uninstall` removes that copy.

- [#5](https://github.com/tencildev/tencil/pull/5) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - Pins can go to Claude Code instead of T3 Code. Setup works out which one you have and only asks when it finds both (or neither); `--provider` answers up front. Each project can switch agents in a new settings dialog (the gear on the toolbar), which is also offered when the current agent isn't running; the choice is saved per project, and pins already made keep their agent. The project picker lists projects from both agents. The daemon runs Claude Code itself through the Claude Agent SDK, under your Claude Code login, in the project's repository root. Each pin is a Claude Code session, and the inbox lists the project's sessions. The SDK is installed into Tencil's config folder the first time it's needed. `--runtime-mode` maps to Claude Code's permission modes, and `--model` takes a plain model name. The overlay only offers **Pair** for providers that support it.

- Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - Fixhere is now Tencil: `npx tencil`, `tencil/react` (`<Tencil />`), `tencil/vite` and tencil.dev. The first `tencil` command moves a Fixhere install over: pins, pairing and settings, its login service and running daemon. In a project, `npx tencil` rewrites the `fixhere/react` or `fixhere/vite` import and swaps the `fixhere` package for `tencil`.

### Patch Changes

- Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - The "Which project is this page?" picker has a search field (Enter picks the first match), and resolving a thread closes its panel.

## 0.2.0

### Minor Changes

- Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - Add `npx fixhere setup`: one command per machine that starts Fixhere, asks whether it should start when you log in (yes by default) and pairs with T3 Code. The login service now works from npx: it keeps its own copy of Fixhere in `~/.config/fixhere/runtime`. `start` and `init` update a login service in place instead of fighting it for the port, and `stop` stops it until the next login.

## 0.1.1

### Patch Changes

- Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - Restarting the daemon (after an upgrade, or from `fixhere init`) keeps the flags it was started with, such as `--listen` and `--allow-origin`. `fixhere start` with different flags now restarts the daemon instead of ignoring them.

- Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - `<Fixhere />` and the Vite plugin load the overlay from the daemon on the machine serving the page, so a dev server opened as `http://devbox:3000` reaches the daemon on `devbox` (start it with `--listen` and `--allow-origin`) instead of `localhost`.

## 0.1.0

### Minor Changes

- [`734fdd5`](https://github.com/tencildev/tencil/commit/734fdd5897871a3363b03dc344db598744b875f9) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - First release: pin prompts on any element of your running app and let T3 Code fix it. Includes `fixhere init` for Next.js and Vite, automatic pairing with a local T3 Code, and continuing existing T3 Code threads from the browser.

- Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - Add `--listen <address>` so a browser on another machine (for example over Tailscale) can reach the daemon. Requests without an Origin are now only trusted from this machine.

### Patch Changes

- Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - Pins work on dev servers opened by host name over plain HTTP (for example `http://devbox:3000`), where browsers don't offer `crypto.randomUUID`.

- Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - A T3 Code project above the page's git repository (such as `~/Code`) no longer captures its pins; Fixhere adds the repository as its own project instead.

- Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - Screenshots are now opt-in: the composer's camera toggle starts off.
