# Tencil

A pnpm + Turborepo monorepo for Tencil: point at an element of a running app,
type what should change, and a coding agent (T3 Code) does it. One daemon per
machine serves the browser overlay and talks to the agent.

## Project Structure

```
packages/
├── tencil/             # Published package: CLI, daemon, init, framework integrations
│   └── src/
│       ├── cli/        # index.ts (entry, arg parsing) + commands/{name}.ts
│       ├── daemon/     # server, project-resolver, file thread-store and project settings,
│       │               # agents (machine provider detection), security
│       ├── service/    # machine setup: background start/stop, login service
│       │               # (launchd/systemd/schtasks) and its runtime copy, pairing
│       ├── init/       # `tencil init`: detect-framework, codemods, diff, run-init
│       └── integrations/  # vite.ts (plugin), react.ts (<Tencil />)
├── overlay/            # Browser overlay (Preact + signals, shadow DOM), built to one IIFE
│   └── src/
│       ├── components/ # UI, one component per kebab-case file
│       └── lib/        # state, bridge connection, element picker/context, positioning
├── bridge/             # Bridge: pins, prompt rendering, provider wiring; ThreadStore and
│                       # ProjectSettingsStore interfaces, MemoryThreadStore. No machine state
├── protocol/           # Wire schemas (zod) and the Provider interface
├── provider-t3code/    # T3 Code provider: Effect RPC socket, auth, protocols/{v1,v2}
├── provider-claude-code/  # Claude Code provider: Agent SDK sessions, loaded on first use
├── provider-ensemble/  # Ensemble provider: public local API, bearer auth and shared SSE feed
├── testing/            # Fake provider, fake T3 Code and Ensemble servers, fake Agent SDK, helpers
└── tsconfig/           # Shared tsconfig: base, node, browser
apps/
└── playground/         # Vite + React app; the browser-test (Playwright) target
```

## Mental Model

- **Daemon per machine.** `tencil setup` (or `start`) runs one daemon on
  `localhost:4747`. Projects only load `/tencil.js` in development. The daemon maps
  each page to its project (dev server port → process → working directory;
  otherwise the overlay asks) and keeps a bridge, provider connection and pin
  store per project.
- **Providers are swappable.** The bridge (`@tencildev/bridge`) owns pins and renders element
  context into the prompt; providers (`Provider` in `@tencildev/protocol`) only see text and images.
  The bridge knows nothing about the machine: its host hands in a `ThreadStore`, the providers
  (`ProjectProviders`, `create(id)`) and a `ProjectSettingsStore`. The daemon passes file-backed
  ones from `daemon/`; Tencil Cloud runs the same bridge with its own.
  Each project picks its default provider in the overlay's settings (saved next to its
  pins, `daemon/project-settings.ts`). Otherwise it's the machine's: chosen once by
  setup and saved in `settings.json`, or detected (`daemon/agents.ts`). Pins keep the
  provider they were made with, so a project can have pins on both. Claude Code runs
  inside the daemon through the Agent SDK. The SDK carries a ~250 MB binary, so it's
  an optional peer, never bundled: loaded from next to Tencil or installed into
  `~/.config/tencil/claude-code` on first use.
- **Ensemble requires the running app and one-time approval.** Pair asks the user
  to allow Tencil and saves a private token. Resolve pages by dev server port through
  the public API (including forwarded ports), using `ensemble://thread/<id>` as the
  project identity. Each pin is a chat on that checkout; pins share its SSE feed.
  A page served from a folder maps by path (`provider-ensemble/src/folders.ts`): an
  Ensemble project's folder or a worktree of it starts a thread per pin, and a
  thread's workspace is found by its branch.
- **Published: `tencil`, `@tencildev/protocol`, `@tencildev/bridge` and `@tencildev/testing`.** The
  three libraries resolve to `src` in the workspace (`exports`) and to `dist` when packed
  (`publishConfig.exports`); verify with `pnpm --filter <name> pack`. `tencil` still bundles
  every `@tencildev/*` package with tsdown, so it has no `@tencildev/*` dependencies. The rest stay
  private.

## Conventions

| Thing | Convention | Example |
| --- | --- | --- |
| Files and folders | kebab-case | `thread-panel.tsx`, `project-resolver.ts` |
| Components | PascalCase export, kebab-case file | `ThreadPanel` in `components/thread-panel.tsx` |
| Tests | next to the code | `thread-store.test.ts`, `server.integration.test.ts` |
| CLI commands | one file per command | `cli/commands/start.ts` |
| Imports | relative within a package, package name across packages | `@tencildev/protocol` |

- Formatting and lint: `biome-config-pixel` (4 spaces, single quotes). Run `pnpm format`.
- When adding a file, mirror the closest sibling in the same folder.
- Overlay classes are plain CSS in `overlay/src/styles.ts` (no Tailwind); conditional
  classes need their leading space: `` `tool${active ? ' tool-active' : ''}` ``.

## Commits

[Conventional Commits](https://www.conventionalcommits.org): `type(scope): subject`,
imperative and lowercase. Scopes: `cli`, `daemon`, `init`, `overlay`, `t3code`, `claude-code`,
`ensemble`, `protocol`, `testing`, `playground`. Add a changeset (`pnpm changeset`) for changes
users of the `tencil` package will notice.

## Commands

| Task | Command |
| --- | --- |
| Build everything (cached) | `pnpm build` |
| Lint, typecheck, unit and integration tests | `pnpm check` |
| Browser tests (Playwright, real daemon + playground) | `pnpm test:e2e` |
| Format | `pnpm format` |
| Local package for teammates | `pnpm pack:local` |
