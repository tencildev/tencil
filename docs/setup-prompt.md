# Fixhere teammate setup

Paste everything below the line into your coding agent (T3 Code, Claude Code,
Codex…) from the root of the app you want to try Fixhere on. You need the T3 Code
desktop app running and access to `pixel-perfect-agency` on GitHub.

---

Set up Fixhere for this project so I can test it. Fixhere is an internal tool
(private repo `pixel-perfect-agency/fixhere`): I press C on my running dev site,
click an element, type what should change, and it starts a T3 Code thread for
this project with the element's component and source file (and a screenshot on request).

Do the following, and stop and tell me if a step fails instead of working
around it:

1. **Get and package Fixhere.** If `~/Code/fixhere` doesn't exist, clone it:
   `git clone git@github.com:pixel-perfect-agency/fixhere.git ~/Code/fixhere`.
   Otherwise `git -C ~/Code/fixhere pull`. Then build a local package:
   `cd ~/Code/fixhere && pnpm install && pnpm pack:local`.
   This writes `~/Code/fixhere/.pack/fixhere-<version>.tgz`. Needs Node 22+ and pnpm.

2. **Run the installer in this project** (from the app's folder, i.e. the one
   with `next.config.*` or `vite.config.*`):
   `node ~/Code/fixhere/packages/fixhere/dist/cli.mjs init --from <path to the .tgz>`
   It shows the one change it makes (Next.js: `<Fixhere />` at the end of `<body>`
   in the root layout; Vite: the `fixhere()` plugin), installs the package, starts
   the Fixhere daemon in the background and pairs with T3 Code. Show me the planned
   change and ask before applying it (run it with `--dry-run` first, then `--yes`).
   If it says the framework isn't supported, tell me instead of editing files.

3. **Tell me how to try it.** Don't start the dev server yourself. Tell me to start
   the project's usual dev server, open the page and press C. `node
   ~/Code/fixhere/packages/fixhere/dist/cli.mjs status` should list this project
   once the page is open.

Don't commit any of these changes; they're for local testing.

---

## Using it

- **C**: comment mode. Click an element, type, Enter.
- In the composer, **→ New T3 Code thread** switches to continuing an existing thread.
- The tray icon opens the inbox; the **T3 Code** tab lists every thread in the project.
- Drag the toolbar by its separator line to move it to any corner.
- The agent runs in T3 Code's `full-access` mode and edits your working copy.

To update later: `git -C ~/Code/fixhere pull && pnpm -C ~/Code/fixhere pack:local`,
then run the `init --from` step again with the new file (it reinstalls and restarts
the daemon on the new version).

Feedback and bugs: tell Willem-Jaap or open an issue on the repo.
