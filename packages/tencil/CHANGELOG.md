# tencil

## 0.6.0

### Minor Changes

- [#13](https://github.com/tencildev/tencil/pull/13) [`1f74444`](https://github.com/tencildev/tencil/commit/1f74444271778a5f232086611fd464b45cdb0b6c) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - Tencil Cloud preview builds tag each element with the file, line and component it comes from (`data-tencil-src`, `data-tencil-component`), so a pin on a preview tells the agent where the code is, as in development. The Vite plugin does it by itself; for Next.js wrap the config in `withTencil()` from `tencil/next` (`tencil init --cloud` does it for you). Builds without `TENCIL_CLOUD` are unchanged.

- [#17](https://github.com/tencildev/tencil/pull/17) [`5050616`](https://github.com/tencildev/tencil/commit/5050616e04f1b78b7f441b460fccc5fb5ca8c32b) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - Click "Working…" on a Tencil Cloud pin to see what the run is doing: starting the sandbox, cloning, installing, each file the agent reads or edits, committing and pushing. When the run is done, the steps stay behind a "steps" toggle with how long it took.

## 0.5.0

### Minor Changes

- [#12](https://github.com/tencildev/tencil/pull/12) [`9fd363b`](https://github.com/tencildev/tencil/commit/9fd363b069415c8c0b2e04477296b66e3e0b3d26) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - Preview builds can load the overlay from Tencil Cloud. Set `TENCIL_CLOUD` to a project key in your host's preview environment and the Vite plugin and `<Tencil />` load the overlay from Tencil Cloud, with the repository, branch and commit the host reports (Vercel, Netlify, Cloudflare Pages, GitHub Actions). Production deployments never load it, and builds without `TENCIL_CLOUD` are unchanged. `tencil init --cloud` sets a project up for it without starting a daemon.

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

- Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - First release as Tencil: `npx tencil`, `tencil/react` (`<Tencil />`), `tencil/vite` and tencil.dev.

### Patch Changes

- Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - The "Which project is this page?" picker has a search field (Enter picks the first match), and resolving a thread closes its panel.
