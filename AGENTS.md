# Fixhere

A pnpm + Turborepo monorepo for Fixhere: point at an element of a running app,
type what should change, and a coding agent (T3 Code) does it. One daemon per
machine serves the browser overlay and talks to the agent.

## Project Structure

```
packages/
├── fixhere/            # Published package: CLI, daemon, init, framework integrations
│   └── src/
│       ├── cli/        # index.ts (entry, arg parsing) + commands/{name}.ts
│       ├── daemon/     # server, bridge, project-resolver, thread-store, prompt, security
│       ├── service/    # machine setup: background start/stop, login service
│       │               # (launchd/systemd/schtasks) and its runtime copy, pairing
│       ├── init/       # `fixhere init`: detect-framework, codemods, diff, run-init
│       └── integrations/  # vite.ts (plugin), react.ts (<Fixhere />)
├── overlay/            # Browser overlay (Preact + signals, shadow DOM), built to one IIFE
│   └── src/
│       ├── components/ # UI, one component per kebab-case file
│       └── lib/        # state, bridge connection, element picker/context, positioning
├── protocol/           # Wire schemas (zod) and the Provider interface
├── provider-t3code/    # T3 Code provider: Effect RPC socket, auth, protocols/{v1,v2}
├── testing/            # Fake T3 Code server and test helpers
└── tsconfig/           # Shared tsconfig: base, node, browser
apps/
└── playground/         # Vite + React app; the browser-test (Playwright) target
```

## Mental Model

- **Daemon per machine.** `fixhere setup` (or `start`) runs one daemon on
  `localhost:4747`. Projects only load `/fixhere.js` in development. The daemon maps each page to its project
  (dev server port → process → working directory; otherwise the overlay asks) and
  keeps a bridge, provider connection and pin store per project.
- **Providers are swappable.** The bridge owns pins and renders element context into
  the prompt; providers (`Provider` in `@fixhere/protocol`) only see text and images.
- **Only `fixhere` is published.** Workspace packages are private and bundled into it
  by tsdown.

## Conventions

| Thing | Convention | Example |
| --- | --- | --- |
| Files and folders | kebab-case | `thread-panel.tsx`, `project-resolver.ts` |
| Components | PascalCase export, kebab-case file | `ThreadPanel` in `components/thread-panel.tsx` |
| Tests | next to the code | `thread-store.test.ts`, `server.integration.test.ts` |
| CLI commands | one file per command | `cli/commands/start.ts` |
| Imports | relative within a package, package name across packages | `@fixhere/protocol` |

- Formatting and lint: `biome-config-pixel` (4 spaces, single quotes). Run `pnpm format`.
- When adding a file, mirror the closest sibling in the same folder.
- Overlay classes are plain CSS in `overlay/src/styles.ts` (no Tailwind); conditional
  classes need their leading space: `` `tool${active ? ' tool-active' : ''}` ``.

## Commits

[Conventional Commits](https://www.conventionalcommits.org): `type(scope): subject`,
imperative and lowercase. Scopes: `cli`, `daemon`, `init`, `overlay`, `t3code`,
`protocol`, `testing`, `playground`. Add a changeset (`pnpm changeset`) for changes
users of the `fixhere` package will notice.

## Commands

| Task | Command |
| --- | --- |
| Build everything (cached) | `pnpm build` |
| Lint, typecheck, unit and integration tests | `pnpm check` |
| Browser tests (Playwright, real daemon + playground) | `pnpm test:e2e` |
| Format | `pnpm format` |
| Local package for teammates | `pnpm pack:local` |
