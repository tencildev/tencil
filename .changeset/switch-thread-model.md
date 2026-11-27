---
'tencil': minor
'@tencildev/protocol': minor
'@tencildev/bridge': minor
'@tencildev/testing': minor
---

Change the model of a thread that already exists. The pin's popover and the comment box for a thread you continue now show the model menu, and the rest of that thread runs on the model you pick. The change shows in the thread as a short note. It works for T3 Code, Codex and Claude Code. With T3 Code builds before orchestration v2, a thread can only switch between the models of its own agent. Claude Code also gets the model menu for new threads, listing Claude Code's own models. Providers opt in with the new `Provider.threadModels` and `SendMessageInput.model`.
