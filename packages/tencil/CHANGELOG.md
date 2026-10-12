# tencil

## 0.3.2

### Patch Changes

- [`5dc5d0d`](https://github.com/pixel-perfect-agency/tencil/commit/5dc5d0d1a3e496618c33ca75c4e181696eb67866) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - An older Tencil (npx reuses what it cached for `npx tencil`) no longer replaces a newer daemon or login service; it says to use `npx tencil@latest`. Setup, start and `npx tencil` mention when a newer version is out, and setup says whether the project you run it in already loads Tencil.

## 0.3.1

### Patch Changes

- [`41de998`](https://github.com/pixel-perfect-agency/tencil/commit/41de9989b4c4232ddb69b4743795d8c58e74bbb1) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - The login service now starts the daemon with your shell's PATH (so it finds nvm's npm and npx to pair and to install Claude Code support) and with your XDG_CONFIG_HOME, if set. Setup pairs before it starts the daemon, a daemon whose own pairing failed picks up a pairing made later, and pairing works when Tencil runs under `npx --package`.

## 0.3.0

### Minor Changes

- [`95fa2c3`](https://github.com/pixel-perfect-agency/tencil/commit/95fa2c33cd2b1ed2cd8634b366ca19957d500b2e) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - `npx tencil` on its own now does everything: it sets up the machine the first time (asking whether to start at login), then adds Tencil to the project in the current folder, or lists the apps it finds in a monorepo root. `init` no longer reinstalls `tencil` when the project already depends on it. Login services on a port other than 4747 get their own name and runtime copy, so they never replace the default one, and `service uninstall` removes that copy.

- [#5](https://github.com/pixel-perfect-agency/tencil/pull/5) [`60d3ec4`](https://github.com/pixel-perfect-agency/tencil/commit/60d3ec4dab6842e5053f7f171de885d17905e062) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - Pins can go to Claude Code instead of T3 Code. Setup works out which one you have and only asks when it finds both (or neither); `--provider` answers up front. Each project can switch agents in a new settings dialog (the gear on the toolbar), which is also offered when the current agent isn't running; the choice is saved per project, and pins already made keep their agent. The project picker lists projects from both agents. The daemon runs Claude Code itself through the Claude Agent SDK, under your Claude Code login, in the project's repository root. Each pin is a Claude Code session, and the inbox lists the project's sessions. The SDK is installed into Tencil's config folder the first time it's needed. `--runtime-mode` maps to Claude Code's permission modes, and `--model` takes a plain model name. The overlay only offers **Pair** for providers that support it.

- [`7e1727b`](https://github.com/pixel-perfect-agency/tencil/commit/7e1727bec30b84d3020f91e5193b75d20f912321) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - First release as Tencil: `npx tencil`, `tencil/react` (`<Tencil />`), `tencil/vite` and tencil.dev.

### Patch Changes

- [`eb79704`](https://github.com/pixel-perfect-agency/tencil/commit/eb79704bdaebbf6399a0a61d2669c37908dc2bd6) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - The "Which project is this page?" picker has a search field (Enter picks the first match), and resolving a thread closes its panel.
