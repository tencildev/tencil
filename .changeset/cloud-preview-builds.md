---
'tencil': minor
---

Preview builds can load the overlay from Tencil Cloud. Set `TENCIL_CLOUD` to a project key in your host's preview environment and the Vite plugin and `<Tencil />` load the overlay from Tencil Cloud, with the repository, branch and commit the host reports (Vercel, Netlify, Cloudflare Pages, GitHub Actions). Production deployments never load it, and builds without `TENCIL_CLOUD` are unchanged. `tencil init --cloud` sets a project up for it without starting a daemon.
