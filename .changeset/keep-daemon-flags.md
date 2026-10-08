---
'fixhere': patch
---

Restarting the daemon (after an upgrade, or from `fixhere init`) keeps the flags it was started with, such as `--listen` and `--allow-origin`. `fixhere start` with different flags now restarts the daemon instead of ignoring them.
