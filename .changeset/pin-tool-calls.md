---
'tencil': minor
'@tencildev/protocol': minor
'@tencildev/testing': minor
---

See what the agent is doing while a pin works. The thread shows a live clock, Stop and the
newest tool calls ("Reading app.tsx", "Ran pnpm test") as they happen; once the turn is done
they fold into one line, such as "Read 3 files, edited 2 files · 13s", that opens the full
list. Hover a working pin to see the same activity without opening it. Claude Code and T3 Code
report their tool calls. `ThreadStep` gains an optional `kind` (`read`, `search`, `edit`,
`command`, `web`, `agent` or `tool`) for its icon, and `FakeT3Server` takes `tools`: tool calls
each V2 turn makes before it replies.
