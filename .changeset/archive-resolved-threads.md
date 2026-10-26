---
"@tencildev/protocol": minor
"@tencildev/bridge": minor
---

Providers can mark a thread they start for a pin `archivable` and implement `archive`
and `reopen`. The bridge archives such a thread once all its pins are resolved or deleted, and
reopens it when one is reopened or replied to.
