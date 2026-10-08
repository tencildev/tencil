---
'fixhere': minor
---

Pins can go to Claude Code instead of T3 Code. Setup works out which one you have and only asks when it finds both (or neither); `--provider` answers up front. Each project can switch agents in a new settings dialog (the gear on the toolbar), which is also offered when the current agent isn't running; the choice is saved per project, and pins already made keep their agent. The project picker lists projects from both agents. The daemon runs Claude Code itself through the Claude Agent SDK, under your Claude Code login, in the project's repository root. Each pin is a Claude Code session, and the inbox lists the project's sessions. The SDK is installed into Fixhere's config folder the first time it's needed. `--runtime-mode` maps to Claude Code's permission modes, and `--model` takes a plain model name. The overlay only offers **Pair** for providers that support it.
