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
│ overlay (Preact, shadow DOM)       │ ──────▶ │ fixhere bridge      │ ─────────▶ │ T3 Code   │
│  • picker, pins, threads, inbox    │ ◀────── │  • holds credentials│ ◀───────── │ (threads) │
│  • React source via owner stacks   │         │  • provider adapters│            └───────────┘
└────────────────────────────────────┘         │  • pin store        │
                                               └─────────────────────┘
```

T3 Code is the orchestrator: every pin is a real T3 Code thread in the project
that matches your dev site's folder, so you can continue any conversation there.

## Quick start

> Fixhere isn't published yet. Teammates: follow [docs/setup-prompt.md](docs/setup-prompt.md)
> (paste it into your coding agent), which runs the CLI from a local clone. The
> `npx fixhere` commands below apply once it's published.

1. **Pair with T3 Code** (once). In T3 Code open **Settings → Connections** and
   create a pairing link (or run `npx t3 pair`), then:

   ```sh
   npx fixhere connect "<pairing link>"
   ```

2. **Run the bridge** in your project root:

   ```sh
   npx fixhere
   ```

   The folder is matched to a T3 Code project by its workspace root (it is added
   as a project when missing).

3. **Load the overlay** in development:

   ```html
   <script src="http://localhost:4747/fixhere.js" defer></script>
   ```

   **Next.js** (`app/layout.tsx`):

   ```tsx
   import Script from "next/script";

   {process.env.NODE_ENV === "development" && (
     <Script src="http://localhost:4747/fixhere.js" strategy="afterInteractive" />
   )}
   ```

   **Vite**: the plugin injects the script and runs the bridge inside the dev server.

   ```ts
   import fixhere from "fixhere/vite";

   export default defineConfig({ plugins: [react(), fixhere()] });
   ```

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
fixhere [dev] [options]        Start the bridge for the current project
fixhere connect [pairing-link] Pair with T3 Code

--port <n>              Bridge port (default 4747)
--root <dir>            Project root (default: cwd)
--t3-url <url>          T3 Code server (default: last paired, then http://127.0.0.1:3773)
--model <inst:model>    e.g. claudeAgent:claude-fable-5-1 (default: project default)
--runtime-mode <mode>   approval-required | auto-accept-edits | auto | full-access
--allow-origin <url>    Allow a non-localhost page to connect (repeatable)
--no-create-project     Don't register the folder in T3 Code when missing
```

## Security

The bridge can make an agent edit your code, so it is locked down by default:

- Pins are stored per project in `~/.config/fixhere/projects/`, never inside your repo.
- Credentials live in `~/.config/fixhere/credentials.json` (mode `0600`) and never
  reach the page. The token only carries `orchestration:read` and `orchestration:operate`.
- The bridge listens on `127.0.0.1` and only accepts WebSocket connections from
  loopback origins (`localhost`, `*.localhost`, `127.0.0.1`, `[::1]`) unless you
  pass `--allow-origin`.
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
pnpm build        # overlay IIFE + bridge
pnpm test         # vitest
pnpm typecheck
pnpm lint
```

`apps/playground` is a Vite + React app wired up with the Vite plugin.

| Package | What |
| --- | --- |
| `packages/fixhere` | Published CLI, bridge server, Vite plugin |
| `packages/overlay` | Browser overlay (Preact + signals, shadow DOM, bippy) |
| `packages/protocol` | Wire schemas (zod) and the provider interface |
| `packages/provider-t3code` | T3 Code provider |
