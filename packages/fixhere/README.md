# Fixhere

**Point at your UI. Prompt your agent.**

Fixhere is a browser review tool for coding agents. Press <kbd>C</kbd> on your
running dev site, click any element, and type what should change. Fixhere pins
the comment to that element, starts an agent thread with the element's component,
source file and markup (plus a screenshot if you add one), and streams the agent's
progress back onto the pin while your dev server hot-reloads the result.

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
cd your-app
npx fixhere
```

The first time, this sets up your machine: it asks whether Fixhere should start
when you log in (yes by default) and pairs with T3 Code. Then it adds Fixhere to
the project in the current folder. In other projects it only does the second part.
Start your dev server as usual and press <kbd>C</kbd> on the page.

The two steps also run on their own: `npx fixhere setup` (this machine) and
`npx fixhere init` (this project).

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

`setup` asks whether Fixhere should start when you log in (the default). It then
keeps its own copy in `~/.config/fixhere/runtime`, since npx's cache can be cleaned
up, and registers it with launchd on macOS, systemd on Linux or Task Scheduler on
Windows. Answer no and run `npx fixhere start` after a restart instead.

`npx fixhere stop` stops it until you next log in; `npx fixhere service uninstall`
removes it. To update, run `npx fixhere@latest setup` again.

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
fixhere                        Set up this machine if needed, then add Fixhere to this project
fixhere setup                  Set up this machine: start Fixhere (at login) and pair
fixhere init [options]         Load the overlay in this project (Next.js, Vite)
fixhere start                  Start the daemon in the background
fixhere start --foreground     Run the daemon in this terminal
fixhere stop                   Stop the daemon (until the next login, with the login service)
fixhere status                 Show the daemon and the projects it serves
fixhere service install        Start the daemon automatically when you log in
fixhere service uninstall      Remove the login service
fixhere connect [pairing-link] Pair with T3 Code (automatic for a local T3 Code)

--port <n>              Port (default 4747, env FIXHERE_PORT)
--t3-url <url>          T3 Code server (default: last paired, then http://127.0.0.1:3773)
--model <inst:model>    e.g. claudeAgent:claude-fable-5-1 (default: project default)
--runtime-mode <mode>   approval-required | auto-accept-edits | auto | full-access
--listen <address>      Also listen here, e.g. a Tailscale IP (repeatable)
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
  pass `--allow-origin`. Requests addressed to any other host name than loopback,
  a `--listen` address or an allowed origin's host are refused, which blocks DNS
  rebinding. Tools that send no Origin are only trusted from this machine.
- On a shared dev box, `--listen` exposes the bridge to that network: browsers are
  held to `--allow-origin`, but a non-browser client can claim any Origin, so only
  listen on a network you trust (such as your tailnet).
- Agent replies are rendered as text nodes (no `innerHTML`).
