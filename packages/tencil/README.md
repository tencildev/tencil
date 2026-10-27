# Tencil

**Point at your UI. Prompt your agent.**

Tencil is a browser review tool for coding agents. Press <kbd>C</kbd> on your
running dev site, click any element, and type what should change. Tencil pins
the comment to that element, starts an agent thread with the element's component,
source file and markup (plus a screenshot if you add one), and streams the agent's
progress back onto the pin while your dev server hot-reloads the result.

Think Vercel Comments, except the reviewer on the other side is an agent.

```
 your dev site (any origin on localhost)          your machine
┌────────────────────────────────────┐   ws    ┌─────────────────────┐   ws/rpc   ┌─────────────┐
│ overlay (Preact, shadow DOM)       │ ──────▶ │ tencil daemon       │ ─────────▶ │ T3 Code     │
│  • picker, pins, threads, inbox    │ ◀────── │  • holds credentials│ ◀───────── │ (threads)   │
│  • React source via owner stacks   │         │  • provider adapters│            └─────────────┘
└────────────────────────────────────┘         │  • pin store        │   Agent SDK ┌─────────────┐
                                               │                     │ ──────────▶ │ Claude Code │
                                               └─────────────────────┘             │ (sessions)  │
                                                                                   └─────────────┘
```

Tencil works with three agents. With **T3 Code**, every pin is a real T3 Code thread
in the project that matches your dev site's folder, so you can continue any
conversation there. With **Claude Code**, the daemon runs Claude Code itself and
every pin is a Claude Code session you can resume in a terminal. With **Ensemble**,
every pin is a chat on the Ensemble thread serving your page.

## Quick start

You need [T3 Code](https://github.com/pingdotgg/t3code) (the desktop app, running),
[Claude Code](https://docs.claude.com/en/docs/claude-code) (installed and logged in) or
[Ensemble](https://tryensemble.co) (the desktop app, running).

```sh
cd your-app
npx tencil
```

The first time, this sets up your machine: it asks whether Tencil should start
when you log in (yes by default), picks your agent and, for T3 Code, pairs with it. Then it adds Tencil to
the project in the current folder. In other projects it only does the second part.
Start your dev server as usual and press <kbd>C</kbd> on the page.

The two steps also run on their own: `npx tencil setup` (this machine) and
`npx tencil init` (this project).

### How it fits together

Tencil runs as **one daemon per machine** on `localhost:4747`. Projects only load a
script from it in development; there's no build plugin or config to maintain. For
someone without the daemon running, the script doesn't load and nothing appears, so
committing the integration to a shared repo is safe.

When a page connects, the daemon works out which project it belongs to:

1. **the dev server's folder**, found from the port the page is served on;
2. if that fails (Docker, remote dev), the overlay asks **"Which project is this
   page?"** and remembers the answer.

Each project gets its own agent connection and pins, all served by the one daemon.

### What `init` adds

**Next.js** (`app/layout.tsx`, or `pages/_document` for the pages router):

```tsx
import { Tencil } from "tencil/react";
<body>{children}<Tencil /></body> {/* renders nothing outside development */}
```

**Vite** (React, Vue, Svelte, TanStack Start, Astro and others):

```ts
import tencil from "tencil/vite";
export default defineConfig({ plugins: [react(), tencil()] });
```

**Anything else:** load this in development only:

```html
<script src="http://localhost:4747/tencil.js" async></script>
```

### Starting at login

`setup` asks whether Tencil should start when you log in (the default). It then
keeps its own copy in `~/.config/tencil/runtime`, since npx's cache can be cleaned
up, and registers it with launchd on macOS, systemd on Linux or Task Scheduler on
Windows. Answer no and run `npx tencil start` after a restart instead.

`npx tencil stop` stops it until you next log in; `npx tencil service uninstall`
removes it.

### Updates

The daemon looks for a new Tencil when it starts and about once a day. When one
is out, the overlay's settings show it, with an **Update** button: the daemon
installs the new version into its runtime copy, waits until no thread is running,
and restarts on it. If the new version doesn't start, the old one keeps running.
`npx tencil@latest setup` updates by hand.

Set `TENCIL_NO_UPDATE_CHECK=1` to stop the daemon and the CLI asking the npm
registry; they don't on CI either.

### Pairing

Tencil pairs with the T3 Code on your machine by itself (`init` does it right
away). Otherwise use the **Pair** button in the overlay, or create a pairing link in
T3 Code → Settings → Connections and run `npx tencil connect "<link>"`.

### Claude Code instead of T3 Code

Setup works out which agent you have: with only T3 Code or only Claude Code it uses
that one, with both (or neither) it asks once. Each project can switch in the overlay:
the gear on the toolbar opens its settings, and the choice is remembered for that
project. Pins you already made keep the agent they started with. To choose without
being asked, pass `--provider t3code` or `--provider claude-code` to setup. The
daemon runs Claude Code itself, under your Claude Code login, in the project's
repository root. Each pin is a Claude Code session you can also pick up in a
terminal with `claude --resume <id>`. The first time, Tencil installs the Claude
Agent SDK into its config folder (it brings Claude Code along, about 250 MB).

### Ensemble

With `--provider ensemble` (or Ensemble picked in a project's settings), keep the
[Ensemble](https://tryensemble.co) app running. Pair from the overlay or during
setup and allow “Tencil” once in Ensemble. Tencil stores the token privately;
if you remove Tencil in Ensemble › Settings › Ensemble API, pair again.

Tencil uses the page's dev server port to find its Ensemble thread, including ports
forwarded from another machine. Each pin creates a separate chat on that thread's
checkout, so changes reload in the page. A dev server you run yourself, from a folder
of an Ensemble project (or a worktree of its repository), starts a new Ensemble
thread per pin instead; that thread works on its own branch, so its changes don't
reach your page until you merge them. Resolving or deleting the pin archives that
thread, and reopening the pin or replying to it brings it back. Threads you started
yourself stay open, and so does one you've added a chat to. If the folder isn't in Ensemble, the overlay names the repository to add.

Nobody is at a terminal to approve tool calls, so `--runtime-mode` decides up front:
`full-access` (the default) lets Claude Code run anything; with the stricter modes,
tools that would need approval are refused and Claude Code is told why. A turn that
is running when the daemon stops is lost; the pin turns red and you can follow up.

## Using it

| Action | How |
| --- | --- |
| Comment mode | <kbd>C</kbd> or the toolbar button |
| Pin a prompt | Click an element, type, <kbd>Enter</kbd> |
| Cancel | <kbd>Esc</kbd> |
| Follow up | Open a pin and reply; the same agent thread continues |
| Continue an existing thread | In the composer, switch **→ New thread** to any thread in the project; the element becomes its next message |
| Open any project thread | Inbox → the agent's tab (**T3 Code** or **Claude Code**); the thread docks on the right so you can read, reply and stop while using the page |
| Stop the agent | **Stop** while a pin is working |
| All pins | Inbox button, filter by page or show resolved |
| Continue in T3 Code | External-link icon on a pin |
| Continue in Claude Code | `claude --resume <id>` in the project's folder |

Pins show their state: spinning while the agent works, blue when done, amber when
the agent waits for approval, red on errors, grey once resolved.

## CLI

```
tencil                        Set up this machine if needed, then add Tencil to this project
tencil setup                  Set up this machine: start Tencil (at login) and pair
tencil init [options]         Load the overlay in this project (Next.js, Vite)
tencil start                  Start the daemon in the background
tencil start --foreground     Run the daemon in this terminal
tencil stop                   Stop the daemon (until the next login, with the login service)
tencil status                 Show the daemon and the projects it serves
tencil service install        Start the daemon automatically when you log in
tencil service uninstall      Remove the login service
tencil connect [pairing-link] Pair with T3 Code (automatic for a local T3 Code)

--port <n>              Port (default 4747, env TENCIL_PORT)
--provider <name>       Agent for projects without their own: t3code (default) | claude-code | ensemble
--t3-url <url>          T3 Code server (default: last paired, then http://127.0.0.1:3773)
--model <model>         T3 Code: instance:model, e.g. claudeAgent:claude-fable-5-1
                        Claude Code: a model, e.g. claude-opus-5-5 (default: its default)
--runtime-mode <mode>   approval-required | auto-accept-edits | auto | full-access
--listen <address>      Also listen here, e.g. a Tailscale IP (repeatable)
--allow-origin <url>    Allow a non-localhost page to connect (repeatable)
--no-create-project     Don't register unknown folders as T3 Code projects

init: -y/--yes, --dry-run, --skip-install, --from <package spec>
```

## Security

The bridge can make an agent edit your code, so it is locked down by default:

- Pins are stored per project in `~/.config/tencil/projects/`, never inside your repo.
  Remembered page → project choices live in `~/.config/tencil/origins.json`.
- Credentials live in `~/.config/tencil/credentials.json` (mode `0600`) and never
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

## License

Apache-2.0. See [LICENSE](LICENSE), [NOTICE](NOTICE) and, for bundled third-party code,
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
