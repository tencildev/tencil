---
'tencil': minor
---

Tencil Cloud preview builds tag each element with the file, line and component it comes from (`data-tencil-src`, `data-tencil-component`), so a pin on a preview tells the agent where the code is, as in development. The Vite plugin does it by itself; for Next.js wrap the config in `withTencil()` from `tencil/next` (`tencil init --cloud` does it for you). Builds without `TENCIL_CLOUD` are unchanged.
