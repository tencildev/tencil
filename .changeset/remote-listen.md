---
'fixhere': minor
---

Add `--listen <address>` so a browser on another machine (for example over Tailscale) can reach the daemon. Requests without an Origin are now only trusted from this machine.
