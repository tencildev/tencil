---
'fixhere': minor
---

Add `npx fixhere setup`: one command per machine that starts Fixhere, asks whether it should start when you log in (yes by default) and pairs with T3 Code. The login service now works from npx: it keeps its own copy of Fixhere in `~/.config/fixhere/runtime`. `start` and `init` update a login service in place instead of fighting it for the port, and `stop` stops it until the next login.
