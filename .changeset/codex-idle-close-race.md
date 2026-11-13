---
"tencil": patch
"@tencildev/testing": patch
---

Codex no longer closes for being idle while Tencil is still starting a thread or waiting on an answer from it. `FakeCodexAppServer` gets `answerDelayMs` to answer slowly, like a busy machine.
