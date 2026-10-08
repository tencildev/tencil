# Fixhere teammate setup

Paste everything below the line into your coding agent (T3 Code, Claude Code,
Codex…) from the root of the app you want to try Fixhere on. You need the T3 Code
desktop app running.

---

Set up Fixhere for this project so I can test it. Fixhere (npm package `fixhere`)
lets me press C on my running dev site, click an element, type what should change,
and it starts a T3 Code thread for this project with the element's component and
source file (and a screenshot on request).

Do the following, and stop and tell me if a step fails instead of working
around it:

1. **Run the installer in this project** (from the app's folder, i.e. the one
   with `next.config.*` or `vite.config.*`). Needs Node 22+. First
   `npx fixhere@latest init --dry-run`, show me the planned change and ask before
   applying it with `npx fixhere@latest init --yes`.
   It makes one change (Next.js: `<Fixhere />` at the end of `<body>` in the root
   layout; Vite: the `fixhere()` plugin), installs `fixhere` as a dev dependency,
   starts the Fixhere daemon in the background and pairs with T3 Code.
   If it says the framework isn't supported, tell me instead of editing files.

2. **Tell me how to try it.** Don't start the dev server yourself. Tell me to start
   the project's usual dev server, open the page and press C. `npx fixhere status`
   should list this project once the page is open.

Don't commit any of these changes; they're for local testing.

---

## Using it

- **C**: comment mode. Click an element, type, Enter.
- In the composer, **→ New T3 Code thread** switches to continuing an existing thread.
- The tray icon opens the inbox; the **T3 Code** tab lists every thread in the project.
- Drag the toolbar by its separator line to move it to any corner.
- The agent runs in T3 Code's `full-access` mode and edits your working copy.

To update later: install `fixhere@latest` in the project and run `npx fixhere start`
(it restarts the daemon on the new version).

Feedback and bugs: tell Willem-Jaap or open an issue on the repo.
