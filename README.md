# Fixhere

**Point at your UI. Prompt your agent.**

Fixhere is a browser review tool for coding agents. Press <kbd>C</kbd> on your
running dev site, click any element, and type what should change. Fixhere pins
the comment to that element, starts an agent thread with the element's component,
source file and markup (plus a screenshot if you add one), and streams the agent's
progress back onto the pin while your dev server hot-reloads the result.

Think Vercel Comments, except the reviewer on the other side is an agent.

How to install and use it: [packages/fixhere/README.md](packages/fixhere/README.md)
(also the npm page). Teammates trying an unreleased build: [docs/setup-prompt.md](docs/setup-prompt.md).

## Providers

Agents plug in through the `Provider` interface in `@fixhere/protocol`:
`createThread`, `sendMessage`, `interrupt` and `watch` (a stream of messages and a
provider-agnostic status). The bridge owns pins and renders element context into
the prompt, so every provider receives identical input.

- **T3 Code** (`@fixhere/provider-t3code`): speaks T3 Code's Effect RPC over
  WebSocket. Supports both orchestration protocols: V1 (all released builds) and
  V2 (newer builds advertising `orchestrationProtocolVersion: 2`).
- **Claude Code**, others: planned.

## Development

```sh
pnpm install
pnpm build          # overlay IIFE + bridge
pnpm check          # lint, typecheck, unit and integration tests
pnpm test:e2e       # browser tests (Playwright) against the playground
```

| Package | What |
| --- | --- |
| `packages/fixhere` | Published package: CLI, daemon, `init`, Vite plugin and React component |
| `packages/overlay` | Browser overlay (Preact + signals, shadow DOM, bippy) |
| `packages/protocol` | Wire schemas (zod) and the provider interface |
| `packages/provider-t3code` | T3 Code provider (orchestration V1 and V2) |
| `packages/testing` | Fake T3 Code server used by the integration and browser tests |
| `packages/tsconfig` | Shared TypeScript configs |
| `apps/playground` | Vite + React app with the plugin, also the e2e test target |

Structure and naming conventions: [AGENTS.md](AGENTS.md).

### Tests

- **Unit:** prompt rendering, trackers, codemods, path handling, stores.
- **Integration:** the provider and the daemon against a fake T3 Code that speaks
  the real wire protocol (both versions), including streaming, interrupts, uploads,
  reconnects, pairing, stalled servers, several projects on one daemon, the project
  picker, and the origin and host checks; plus the built CLI's start/status/stop.
- **Browser:** Playwright runs the real daemon and the playground, and drives the
  overlay in Chromium (the daemon finds the project from the dev server's port):
  pinning, streamed replies,
  follow-ups, persistence across reloads, the thread list, dragging the toolbar.
- **Package:** CI packs `fixhere` exactly as npm would publish it and installs it
  into an empty project.

### Releasing

Changes that affect users get a changeset (`pnpm changeset`). Merging to `master`
opens a "Version packages" PR, and merging that PR publishes `fixhere` to npm.

Publishing uses npm trusted publishing, so there is no npm token: on npmjs.com,
`fixhere` → Settings → Trusted publisher allows GitHub Actions in
`pixel-perfect-agency/fixhere`, workflow `release.yml`. The workflow only runs while
the repository variable `RELEASE_ENABLED` is `true`.
