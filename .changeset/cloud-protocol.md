---
'@tencildev/protocol': minor
'@tencildev/bridge': minor
---

What Tencil Cloud needs from the wire and the bridge. The protocol gains the build a cloud preview reports (`BuildInfo`), sign-in (`auth.required`, `CloudSignIn`, `Viewer`), a run's delivery (`Delivery`: queued, pushed, deploying, live) and its steps (`ThreadStep`), and `ThreadSink.delivery` and `ThreadSink.step`. The bridge stores and broadcasts delivery and steps on a provider thread's pins, starts a turn's steps afresh on a reply, and keeps page content from closing the prompt's context block.
