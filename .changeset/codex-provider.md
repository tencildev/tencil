---
'tencil': minor
'@tencildev/testing': minor
---

Send pins to Codex directly, next to T3 Code, Claude Code and Ensemble. The daemon runs
`codex app-server` under your own Codex install and login, the CLI or the desktop app's
copy, and each pin is a Codex thread you can continue with `codex resume <id>`. Pick it
with `--provider codex` or in a project's settings; `--model`, the model picker and
`--runtime-mode` all apply. `@tencildev/testing` gains `FakeCodexAppServer`.
