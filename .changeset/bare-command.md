---
'fixhere': minor
---

`npx fixhere` on its own now does everything: it sets up the machine the first time (asking whether to start at login), then adds Fixhere to the project in the current folder, or lists the apps it finds in a monorepo root. `init` no longer reinstalls `fixhere` when the project already depends on it. Login services on a port other than 4747 get their own name and runtime copy, so they never replace the default one, and `service uninstall` removes that copy.
