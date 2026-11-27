# Tencil for Chrome and Firefox

Loads the Tencil overlay into a running app without adding the script tag or a
framework integration. Click the toolbar button on a page and Tencil is on; click
again to turn it off.

## Try it

```sh
pnpm --filter @tencildev/extension... build
tencil start
```

Then `chrome://extensions` → Developer mode → Load unpacked → `apps/extension/dist`.

In Firefox (128 or later): `about:debugging#/runtime/this-firefox` → Load Temporary
Add-on → `apps/extension/dist-firefox/manifest.json`. A temporary add-on stays until
Firefox restarts.

The build writes both from the same scripts. `scripts/manifest.mjs` copies `dist/` to
`dist-firefox/` and swaps the manifest's service worker for a background script, which is
what Firefox runs in MV3, and adds the `browser_specific_settings.gecko` id
(`extension@tencil.dev`). The code only uses `chrome.*` APIs that Firefox has too.

## How it works

- The click adds `<script src="http://localhost:4747/tencil.js">` to the page, in its
  main world (`src/page.ts`), so the overlay is the daemon's own version and can read
  React's fibers for component names and source locations.
- If the page's CSP blocks that tag, it injects the overlay bundled into the extension
  instead (`overlay.js`), which the CSP doesn't apply to.
- On local dev servers (`localhost`, `127.0.0.1`, `*.localhost`) the site is
  remembered and Tencil loads again on every reload. Other sites get it for the
  current page only.
- The badge shows `ON`, or `!` when the daemon isn't running.
- The icons in `public/` are `icon.svg` (the Tencil mark, as on tencil.dev) rendered at 16, 32, 48
  and 128 px (the 128 one with the store's 16 px border).

Limits: a strict `connect-src` CSP still blocks the overlay's connection to the
daemon. Sites that aren't on localhost need `tencil start --allow-origin <origin>`, and
the overlay asks which project they belong to.

## Releasing

Only the Chrome build is released for now. The Firefox one isn't on
addons.mozilla.org yet; build and zip it by hand with
`pnpm --filter @tencildev/extension zip:firefox` (`apps/extension/tencil-extension-firefox.zip`).

The extension has the same version as `tencil` (`scripts/manifest.mjs` sets it in
`dist/manifest.json`), so it's released whenever a version PR is merged. The `extension`
job in `.github/workflows/release.yml` builds it, uploads it to the Chrome Web Store,
submits it for review and tags the commit `extension@<version>`. A version that already
has a tag is skipped. To ship a change that only touches the extension, add a `tencil`
changeset for it.

To build the zip by hand:

```sh
pnpm turbo run build --filter=@tencildev/extension...
pnpm --filter @tencildev/extension zip   # apps/extension/tencil-extension.zip
```

### One-time setup

1. **Create the store item.** The API can only update an item that exists. Upload the zip
   in the [Developer Dashboard](https://chrome.google.com/webstore/devconsole), fill in the
   listing and privacy tab, and submit it. Then tag the version you uploaded so the job
   doesn't send it again: `git tag extension@<version> && git push origin extension@<version>`.
2. **Create a service account.** In a Google Cloud project, enable the Chrome Web Store API
   and create a service account; it needs no roles. In the Developer Dashboard, add its
   email under **Account** (one service account per publisher).
3. **Let this workflow act as it**, without a key, through Workload Identity Federation:

   ```sh
   gcloud iam workload-identity-pools create github --location=global
   gcloud iam workload-identity-pools providers create-oidc tencil \
     --location=global --workload-identity-pool=github \
     --issuer-uri=https://token.actions.githubusercontent.com \
     --attribute-mapping=google.subject=assertion.sub,attribute.repository=assertion.repository \
     --attribute-condition="assertion.repository == 'tencildev/tencil'"
   gcloud iam service-accounts add-iam-policy-binding <service-account-email> \
     --role=roles/iam.workloadIdentityUser \
     --member="principalSet://iam.googleapis.com/projects/<project-number>/locations/global/workloadIdentityPools/github/attribute.repository/tencildev/tencil"
   gcloud iam service-accounts add-iam-policy-binding <service-account-email> \
     --role=roles/iam.serviceAccountTokenCreator \
     --member="principalSet://iam.googleapis.com/projects/<project-number>/locations/global/workloadIdentityPools/github/attribute.repository/tencildev/tencil"
   ```

4. **Set the repository variables** (Settings → Secrets and variables → Actions → Variables).
   None of them are secret:

   | Variable | Value |
   | --- | --- |
   | `CHROME_WEBSTORE_PUBLISHER_ID` | Developer Dashboard → Publisher → Settings |
   | `CHROME_WEBSTORE_EXTENSION_ID` | The item's ID, on its Package tab |
   | `CHROME_WEBSTORE_SERVICE_ACCOUNT` | The service account's email |
   | `GCP_WORKLOAD_IDENTITY_PROVIDER` | `projects/<project-number>/locations/global/workloadIdentityPools/github/providers/tencil` |
   | `EXTENSION_RELEASE_ENABLED` | `true` |

If an upload went through but submitting it failed, submit it from the dashboard and tag
the version by hand: the store won't take the same version twice.
