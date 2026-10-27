# tencil

## 0.9.0

### Minor Changes

- [#14](https://github.com/tencildev/tencil/pull/14) [`8491e40`](https://github.com/tencildev/tencil/commit/8491e4036f2fe7020d26d00df7b0a59b66630c99) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - Add Ensemble as an agent provider through its public local API. Keep the Ensemble
  app running and allow Tencil once when pairing. Pages map to Ensemble threads by
  dev server port, including forwarded ports; each pin creates a separate chat on
  the same checkout. Pages served from an Ensemble project's own folder start a new
  thread per pin, archived when the pin is resolved and reopened with it. Stream messages and tool steps over a shared, resumable feed.

### Patch Changes

- [#15](https://github.com/tencildev/tencil/pull/15) [`f3b0a31`](https://github.com/tencildev/tencil/commit/f3b0a31482ab9be4ed4698b9057796851572a517) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - Send a page to the project actually running on its port. A folder picked
  for an address no longer wins over the dev server found there now, so a
  second Vite app on port 5173 stops going to the first one's folder. On
  Windows the port lookup now sees dev servers listening on IPv6 (`[::1]`),
  which Vite does for `localhost`.

## 0.8.0

### Minor Changes

- [#10](https://github.com/tencildev/tencil/pull/10) [`ddddde6`](https://github.com/tencildev/tencil/commit/ddddde6bfdafce967480ae3d81201c2e2f8cf68b) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - The daemon looks for a new Tencil on start and about once a day, and the overlay's settings show the running version. When a newer one is out, they say so (with a dot on the settings button) and offer **Update**: the daemon installs it into its runtime copy, waits for running threads to finish and restarts on it, through the login service or in the background. If the new version doesn't start, the old one keeps running and the overlay shows why, with `npx tencil@latest setup` to copy. `TENCIL_NO_UPDATE_CHECK=1` (and CI) turns the checks off.

### Patch Changes

- [#8](https://github.com/tencildev/tencil/pull/8) [`faf871b`](https://github.com/tencildev/tencil/commit/faf871b4207d633bef02eb912e41d70ceb038f7f) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - Find the project of a dev server running in Docker. When a page's port is published by Docker (Docker Desktop, docker-proxy, OrbStack, Colima, Podman), the daemon asks Docker for the compose project's folder instead of showing the project picker.

- [#9](https://github.com/tencildev/tencil/pull/9) [`ca2b067`](https://github.com/tencildev/tencil/commit/ca2b067663d4ca552fd24d8bf48fbf5f41b29500) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - Find a page's project from the repository the Vite plugin or `withTencil` runs in, so pages served by something other than a Node process in the project (Laravel on Sail or Herd, a backend behind a proxy) no longer ask "Which project is this page?". The loader passes the git root (`tencil.js?root=…`), the overlay sends it with `hello` (`root`), and the daemon uses it when it holds a `.git` folder or file, after the address's remembered choice and before the port lookup. In Next.js this needs `withTencil` in `next.config`. The plain `<script>` tag keeps the port lookup.

## 0.7.0

### Minor Changes

- [#6](https://github.com/tencildev/tencil/pull/6) [`25749e6`](https://github.com/tencildev/tencil/commit/25749e6d21588ab8a149525e2b957701f1a7c5a6) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - Measure spacing in the overlay. While picking, the hovered element shows its padding, margin and flex or grid gap with their values (and the Tailwind class that sets them). Hold Alt to see the distances to its parent, or, with a comment open, to any other element; Alt-click to send those distances with the comment. With the ruler on, it also works outside comment mode: hold Alt (Option on a Mac) anywhere to measure, Alt-click to select an element to measure from, and press C to comment on it with that spacing. The ruler button in the toolbar, or `R`, turns this on (it starts off), and the project setting `ruler` (on by default) hides it altogether. Pins now carry the element's box model (`ElementContext.box`) and any measured spacing (`ElementContext.spacing`), and the bridge puts both in the prompt.

## 0.6.1

### Patch Changes

- [#4](https://github.com/tencildev/tencil/pull/4) [`efe0d88`](https://github.com/tencildev/tencil/commit/efe0d8857d4216ee01540e8894945d1b51ecbf55) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - A new pin blooms out of the element you clicked. A resolved pin turns into a check and dissolves instead of disappearing at once.

- [#2](https://github.com/tencildev/tencil/pull/2) [`a722845`](https://github.com/tencildev/tencil/commit/a7228451433dc41a63eb0eaffa458e3e3950db71) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - T3 Code 0.1.0: pins show "Waiting for approval" only while T3 Code is actually waiting on you (it used to flash after every reply and miss real approvals), and "Waiting for your answer" when the agent asks a question.

- [#4](https://github.com/tencildev/tencil/pull/4) [`dc03ecf`](https://github.com/tencildev/tencil/commit/dc03ecf99a4dffc826d42d822d5f519334944bf2) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - A working pin now looks like the Tencil logo, with a light travelling round its edge instead of a spinning ring.

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
