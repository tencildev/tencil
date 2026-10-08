---
'fixhere': patch
---

`<Fixhere />` and the Vite plugin load the overlay from the daemon on the machine serving the page, so a dev server opened as `http://devbox:3000` reaches the daemon on `devbox` (start it with `--listen` and `--allow-origin`) instead of `localhost`.
