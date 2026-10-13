---
'@tencildev/protocol': minor
'@tencildev/bridge': minor
---

`CreateThreadInput.pin` carries the pin as the overlay sent it (comment, page, anchor and element context), and the bridge passes it to `createThread` for single pins. A provider that hands pins on to another bridge, like Tencil Cloud, renders the element context once instead of twice. Absent for batches.
