---
'tencil': patch
---

Send a page to the project actually running on its port. A folder picked
for an address no longer wins over the dev server found there now, so a
second Vite app on port 5173 stops going to the first one's folder. On
Windows the port lookup now sees dev servers listening on IPv6 (`[::1]`),
which Vite does for `localhost`.
