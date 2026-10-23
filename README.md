# Tencil

**Point at your UI. Prompt your agent.**

Tencil is a browser review tool for coding agents. Press <kbd>C</kbd> on your
running dev site, click any element, and type what should change. Tencil pins
the comment to that element, starts an agent thread with the element's component,
source file and markup (plus a screenshot if you add one), and streams the agent's
progress back onto the pin while your dev server hot-reloads the result.

Think Vercel Comments, except the reviewer on the other side is an agent.

## Install and use

You need [T3 Code](https://github.com/pingdotgg/t3code) (the desktop app, running),
[Claude Code](https://docs.claude.com/en/docs/claude-code) (installed and logged in) or
[Ensemble](https://tryensemble.co) (the desktop app, running).

```sh
cd your-app
npx tencil
```

The full guide (setup, `init`, the CLI, security) is in
[packages/tencil/README.md](packages/tencil/README.md), which is also the npm page.
Teammates trying an unreleased build: [docs/setup-prompt.md](docs/setup-prompt.md).

## How it works

One daemon per machine (`localhost:4747`) serves the browser overlay and talks to the
agent. Projects only load `/tencil.js` from it in development. The daemon maps each
page to its project (dev server port → process → working directory; otherwise the
overlay asks) and keeps a bridge, an agent connection and a pin store per project.

## Providers

Agents plug in through the `Provider` interface in `@tencildev/protocol`
([`packages/protocol/src/provider.ts`](packages/protocol/src/provider.ts)):
`createThread`, `sendMessage`, `interrupt` and `watch` (a stream of messages and a
provider-agnostic status), plus `start`, `info`, `listThreads` and optional pairing
and model listing. The bridge owns pins and renders element context into the prompt,
so every provider receives identical input: text and images.

- **T3 Code** (`@tencildev/provider-t3code`): speaks T3 Code's Effect RPC over
  WebSocket. Supports both orchestration protocols: V1 (all released builds) and
  V2 (newer builds advertising `orchestrationProtocolVersion: 2`).
- **Claude Code** (`@tencildev/provider-claude-code`): runs Claude Code in the daemon
  through the Claude Agent SDK, one process per active session. Threads are Claude
  Code sessions, replayed from the transcripts Claude Code saves. The SDK is installed
  on first use, not bundled.
- **Ensemble** (`@tencildev/provider-ensemble`): uses the app's public local API.
  Keep Ensemble running and allow Tencil once when pairing. The page's dev server
  port identifies its Ensemble thread (including forwarded ports); each pin creates
  a chat on that thread's checkout. A page served from an Ensemble project's own folder
  starts a new thread per pin. A shared feed streams chat messages and tool steps.

A new provider is a workspace package that implements `Provider`, with tests against
a fake of the agent in `packages/testing`. The daemon picks the provider per project in
`packages/tencil/src/daemon/server.ts`.

## Repository layout

| Package | What |
| --- | --- |
| `packages/tencil` | Published package: CLI, daemon, `init`, Vite plugin and React component |
| `packages/overlay` | Browser overlay (Preact + signals, shadow DOM, bippy), built to one IIFE |
| `packages/protocol` | Wire schemas (zod) and the `Provider` interface |
| `packages/provider-t3code` | T3 Code provider (orchestration V1 and V2) |
| `packages/provider-claude-code` | Claude Code provider (Claude Agent SDK) |
| `packages/provider-ensemble` | Ensemble provider (public local API and SSE feed) |
| `packages/testing` | Fake T3 Code and Ensemble servers and fake Agent SDK used by the tests |
| `packages/tsconfig` | Shared TypeScript configs |
| `apps/playground` | Vite + React app with the plugin, also the e2e test target |

Only `tencil` is published; the workspace packages are private and bundled into it.
Structure and naming conventions: [AGENTS.md](AGENTS.md).

## Development

Node 22+ and pnpm (`corepack enable`).

```sh
pnpm install
pnpm build          # overlay IIFE + CLI and daemon
pnpm dev            # rebuild on change; also runs the playground dev server
pnpm check          # lint, typecheck, unit and integration tests
pnpm test:e2e       # browser tests (Playwright) against the playground
pnpm format         # Biome
```

To try your build by hand, run the daemon from it on a spare port (so it doesn't
clash with an installed Tencil on 4747) and point the playground at it. Open the URL
Vite prints and press <kbd>C</kbd> on the page:

```sh
pnpm build
node packages/tencil/dist/cli.mjs start --foreground --port 4848
TENCIL_PORT=4848 pnpm --filter playground dev   # in a second terminal
```

Restart the daemon after changing daemon or provider code.

For the browser tests, install Chromium once:
`pnpm --filter playground exec playwright install chromium`.

How to contribute (DCO sign-off, conventions, changesets): [CONTRIBUTING.md](CONTRIBUTING.md).

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
- **Package:** CI packs `tencil` exactly as npm would publish it and installs it
  into an empty project.

### Releasing

Changes that affect users get a changeset (`pnpm changeset`). Merging to `master`
opens a "Version packages" PR, and merging that PR publishes `tencil` to npm.

Publishing uses npm trusted publishing, so there is no npm token: on npmjs.com,
`tencil` → Settings → Trusted publisher allows GitHub Actions in
`tencildev/tencil`, workflow `release.yml`. The workflow only runs while
the repository variable `RELEASE_ENABLED` is `true`.

## Security

Please report vulnerabilities privately; see [SECURITY.md](SECURITY.md).

## License

[Apache License 2.0](LICENSE). Copyright 2026 Pixel Perfect Agency; see [NOTICE](NOTICE).
Third-party code bundled into the `tencil` package is listed in
[packages/tencil/THIRD_PARTY_NOTICES.md](packages/tencil/THIRD_PARTY_NOTICES.md).
