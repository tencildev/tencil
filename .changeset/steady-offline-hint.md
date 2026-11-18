---
'tencil': patch
---

Fix flickering in the offline hint while the overlay retries and clarify that the overlay reconnects on its own after you start Tencil. It now reconnects as soon as you come back to the page, retries the daemon at least every 2 seconds, and the hint has a Retry button.
