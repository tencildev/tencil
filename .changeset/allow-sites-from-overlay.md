---
'tencil': minor
'@tencildev/protocol': minor
---

Allow a site that isn't on localhost from the overlay. When the daemon refuses a page, the overlay says so and offers Allow, which opens a confirmation page served by the daemon itself. Allowed sites are saved in `allowed-origins.json` in Tencil's data folder, next to the ones passed with `--allow-origin`. The protocol adds the `origin.blocked` server message for it.
