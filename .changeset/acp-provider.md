---
'tencil': minor
'@tencildev/testing': minor
---

Send pins to Devin and any other agent that speaks the Agent Client Protocol (ACP). The
daemon runs the agent's ACP mode under your own install and login, and each pin is one of
its sessions: replies, tool calls and plans stream in, Stop cancels the turn, follow-ups
continue the session, and after a restart the session is reloaded when the agent can.
Devin, Gemini CLI, GitHub Copilot, Cursor, OpenCode and goose are known by name
(`--provider devin`) and show up in setup and, with their icons, in the overlay when
installed. Change their commands or add your own agents under `acp` in `~/.config/tencil/settings.json`.
`--runtime-mode` decides what the agent may do when it asks. `@tencildev/testing` gains
`FakeAcpAgent`.
