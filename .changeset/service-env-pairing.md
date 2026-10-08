---
'tencil': patch
---

The login service now starts the daemon with your shell's PATH (so it finds nvm's npm and npx to pair and to install Claude Code support) and with your XDG_CONFIG_HOME, if set. Setup pairs before it starts the daemon, a daemon whose own pairing failed picks up a pairing made later, and pairing works when Tencil runs under `npx --package`.
