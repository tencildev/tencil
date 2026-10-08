# Tencil teammate setup

Paste everything below the line into your coding agent (T3 Code, Claude Code,
Codex…) from the root of the app you want to try Tencil on. You need the T3 Code
desktop app running.

---

Set up Tencil for this project so I can test it. Tencil (npm package `tencil`)
lets me press C on my running dev site, click an element, type what should change,
and it starts a T3 Code thread for this project with the element's component and
source file (and a screenshot on request).

Do the following, and stop and tell me if a step fails instead of working
around it:

1. **Set up this machine.** Needs Node 22+. Ask me whether Tencil should start
   automatically when I log in (recommended). If yes, run
   `npx --yes tencil@latest setup --yes`; if not, `npx --yes tencil@latest start`.

2. **Run the installer in this project** (from the app's folder, i.e. the one
   with `next.config.*` or `vite.config.*`). First
   `npx tencil@latest init --dry-run`, show me the planned change and ask before
   applying it with `npx tencil@latest init --yes`.
   It makes one change (Next.js: `<Tencil />` at the end of `<body>` in the root
   layout; Vite: the `tencil()` plugin) and installs `tencil` as a dev dependency.
   If it says the framework isn't supported, tell me instead of editing files.

3. **Tell me how to try it.** Don't start the dev server yourself. Tell me to start
   the project's usual dev server, open the page and press C. `npx tencil status`
   should list this project once the page is open.

Don't commit any of these changes; they're for local testing.

---

## Using it

- **C**: comment mode. Click an element, type, Enter.
- In the composer, **→ New T3 Code thread** switches to continuing an existing thread.
- The tray icon opens the inbox; the **T3 Code** tab lists every thread in the project.
- Drag the toolbar by its separator line to move it to any corner.
- The agent runs in T3 Code's `full-access` mode and edits your working copy.

To update later: run `npx tencil@latest setup` (or `start`, without the login
service) and install `tencil@latest` in the project.

Feedback and bugs: tell Willem-Jaap or open an issue on the repo.
