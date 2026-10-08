# Fixhere teammate setup

Paste everything below the line into your coding agent (T3 Code, Claude Code,
Codex…) from the root of the project you want to try Fixhere on. You need the
T3 Code desktop app running and access to `pixel-perfect-agency` on GitHub.

---

Set up Fixhere for this project so I can test it. Fixhere is an internal tool
(private repo `pixel-perfect-agency/fixhere`): I press C on my running dev site,
click an element, type what should change, and it starts a T3 Code thread for
this project with the element's component, source file and a screenshot.

Do the following, and stop and tell me if a step fails instead of working
around it:

1. **Get Fixhere.** If `~/Code/fixhere` doesn't exist, clone it:
   `git clone git@github.com:pixel-perfect-agency/fixhere.git ~/Code/fixhere`.
   Otherwise `git -C ~/Code/fixhere pull`. Then build it:
   `cd ~/Code/fixhere && pnpm install && pnpm build`.
   Needs Node 22+ and pnpm.

2. **Pair with T3 Code** (skip if `~/.config/fixhere/credentials.json` already
   exists). T3 Code must be running. Run:
   `node ~/Code/fixhere/packages/fixhere/dist/cli.mjs connect < /dev/null`
   It creates a pairing code with the `t3` CLI that matches my T3 Code version
   and stores the token. It should print `✓ Paired with T3 Code`.

3. **Load the overlay in development only**, in this project:
   - **Next.js (app router):** in the root `app/layout.tsx` (or
     `src/app/layout.tsx`), import `Script` from `next/script` and render, as
     the last child of `<body>`:
     `{process.env.NODE_ENV === 'development' && <Script src="http://localhost:4747/fixhere.js" strategy="afterInteractive" />}`
   - **Vite:** add `<script src="http://localhost:4747/fixhere.js" defer></script>`
     to `index.html`, or better, only in dev via `transformIndexHtml` if the
     project already has a plugin setup for that.
   - **Anything else:** add that same script tag to the dev-only HTML.
   Match the project's code style. Don't commit this change; it's for local
   testing.

4. **Tell me how to run it.** Don't start long-running processes yourself.
   Give me these two commands for separate terminals:
   - from this project's root: `node ~/Code/fixhere/packages/fixhere/dist/cli.mjs`
     (it should log `Connected to T3 Code … project "<name>" … protocol v1`;
     if the folder isn't a T3 Code project yet, Fixhere adds it)
   - the project's usual dev server command.

Finish with a short summary of what you changed and the two commands.

---

## Using it

- **C**: comment mode. Click an element, type, Enter.
- In the composer, **→ New T3 Code thread** switches to continuing an existing thread.
- The tray icon opens the inbox; the **T3 Code** tab lists every thread in the project.
- Drag the toolbar by its separator line to move it to any corner.
- The agent runs in T3 Code's `full-access` mode and edits your working copy.
  Start the bridge with `--runtime-mode approval-required` to approve changes in T3 Code first.

Feedback and bugs: tell Willem-Jaap or open an issue on the repo.
