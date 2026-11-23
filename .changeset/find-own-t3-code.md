---
'tencil': patch
---

Find your own T3 Code before trying port 3773. Unless a URL is set or you paired with T3 Code on another machine, Tencil reads where your T3 Code runs from `~/.t3/userdata/server-runtime.json` (or `$T3CODE_HOME`). On a shared machine, port 3773 can be someone else's T3 Code, and your own can move to another port after a restart. The background service now also gets `T3CODE_HOME`.
