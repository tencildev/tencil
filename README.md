# Fixhere

**Point at your UI. Prompt your agent.**

Fixhere is a browser review tool for coding agents. Press <kbd>C</kbd> on your
running dev site, click any element, and type what should change. Fixhere pins
the comment to that element, starts an agent thread with the element's component,
source file, markup and a screenshot, and streams the agent's progress back onto
the pin while your dev server hot-reloads the result.

Think Vercel Comments, except the reviewer on the other side is an agent.

```
 your dev site (any origin on localhost)          your machine
┌────────────────────────────────────┐   ws    ┌─────────────────────┐   ws/rpc   ┌───────────┐
│ overlay (Preact, shadow DOM)       │ ──────▶ │ fixhere daemon      │ ─────────▶ │ T3 Code   │
│  • picker, pins, threads, inbox    │ ◀────── │  • holds credentials│ ◀───────── │ (threads) │
│  • React source via owner stacks   │         │  • provider adapters│            └───────────┘
└────────────────────────────────────┘         │  • pin store        │
                                               └─────────────────────┘
```

T3 Code is the orchestrator: every pin is a real T3 Code thread in the project
that matches your dev site's folder, so you can continue any conversation there.

## Quick start

You need the [T3 Code](https://github.com/pingdotgg/t3code) desktop app running.

```sh
npx fixhere start   # once per machine: starts the Fixhere daemon
npx fixhere init    # once per project: loads the overlay in development
```

Start your dev server as usual and press <kbd>C</kbd> on the page.

> Fixhere isn't on npm yet. Teammates: follow [docs/setup-prompt.md](docs/setup-prompt.md).

### How it fits together

Fixhere runs as **one daemon per machine** on `localhost:4747`. Projects only load a
script from it in development; there's no build plugin or config to maintain. For
someone without the daemon running, the script doesn't load and nothing appears, so
committing the integration to a shared repo is safe.

When a page connects, the daemon works out which project it belongs to:

1. **the dev server's folder**, found from the port the page is served on;
2. if that fails (Docker, remote dev), the overlay asks **"Which project is this
   page?"** with your T3 Code projects and remembers the answer.

Each project gets its own T3 Code connection and pins, all served by the one daemon.

### What `init` adds

**Next.js** (`app/layout.tsx`, or `pages/_document` for the pages router):

```tsx
import { Fixhere } from "fixhere/react";
<body>{children}<Fixhere /></body> {/* renders nothing outside development */}
```

**Vite** (React, Vue, Svelte, TanStack Start, Astro and others):

```ts
import fixhere from "fixhere/vite";
export default defineConfig({ plugins: [react(), fixhere()] });
```

**Anything else:** load this in development only:

```html
<script src="http://localhost:4747/fixhere.js" async></script>
```

### Starting at login

```sh
npm i -g fixhere
fixhere service install   # launchd on macOS, systemd on Linux, Task Scheduler on Windows
```

### Pairing

Fixhere pairs with the T3 Code on your machine by itself (`init` does it right
away). Otherwise use the **Pair** button in the overlay, or create a pairing link in
T3 Code → Settings → Connections and run `npx fixhere connect "<link>"`.

## Using it

| Action | How |
| --- | --- |
| Comment mode | <kbd>C</kbd> or the toolbar button |
| Pin a prompt | Click an element, type, <kbd>Enter</kbd> |
| Cancel | <kbd>Esc</kbd> |
| Follow up | Open a pin and reply; the same agent thread continues |
| Continue an existing thread | In the composer, switch **→ New thread** to any thread in the project; the element becomes its next message |
| Open any project thread | Inbox → **T3 Code** tab; the thread docks on the right so you can read, reply and stop while using the page |
| Stop the agent | **Stop** while a pin is working |
| All pins | Inbox button, filter by page or show resolved |
| Continue in T3 Code | External-link icon on a pin |

Pins show their state: spinning while the agent works, blue when done, amber when
the agent waits for approval, red on errors, grey once resolved.

## CLI

```
fixhere [start]                Start the daemon in the background
fixhere start --foreground     Run the daemon in this terminal
fixhere stop                   Stop the daemon
fixhere status                 Show the daemon and the projects it serves
fixhere service install        Start the daemon automatically when you log in
fixhere service uninstall      Remove the login service
fixhere init [options]         Load the overlay in this project (Next.js, Vite)
fixhere connect [pairing-link] Pair with T3 Code (automatic for a local T3 Code)

--port <n>              Port (default 4747, env FIXHERE_PORT)
--t3-url <url>          T3 Code server (default: last paired, then http://127.0.0.1:3773)
--model <inst:model>    e.g. claudeAgent:claude-fable-5-1 (default: project default)
--runtime-mode <mode>   approval-required | auto-accept-edits | auto | full-access
--allow-origin <url>    Allow a non-localhost page to connect (repeatable)
--no-create-project     Don't register unknown folders as T3 Code projects

init: -y/--yes, --dry-run, --skip-install, --from <package spec>
```

## Security

The bridge can make an agent edit your code, so it is locked down by default:

- Pins are stored per project in `~/.config/fixhere/projects/`, never inside your repo.
  Remembered page → project choices live in `~/.config/fixhere/origins.json`.
- Credentials live in `~/.config/fixhere/credentials.json` (mode `0600`) and never
  reach the page. The token only carries `orchestration:read` and `orchestration:operate`.
- The bridge listens on `127.0.0.1` and only accepts WebSocket connections from
  loopback origins (`localhost`, `*.localhost`, `127.0.0.1`, `[::1]`) unless you
  pass `--allow-origin`. Requests addressed to any other host name are refused,
  which blocks DNS rebinding.
- Agent replies are rendered as text nodes (no `innerHTML`).

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

Changes that affect users get a changeset (`pnpm changeset`). With the repository
variable `RELEASE_ENABLED=true` and an `NPM_TOKEN` secret, merging to `main` opens a
"Version packages" PR, and merging that PR publishes `fixhere` to npm.
