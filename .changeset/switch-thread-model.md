---
'tencil': minor
'@tencildev/protocol': minor
'@tencildev/bridge': minor
'@tencildev/testing': minor
---

Change the model of a thread that already exists. The pin's popover and the comment box for a thread you continue now show the model menu, and the rest of that thread runs on the model you pick. The change shows in the thread as a short note. It works for T3 Code and Codex: with T3 Code builds before orchestration v2, a thread can switch between the models of its own agent only. Providers opt in with the new `Provider.threadModels` and `SendMessageInput.model`.
