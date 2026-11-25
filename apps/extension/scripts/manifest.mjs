// Stamps dist/manifest.json with the version of `tencil`, so the extension ships
// alongside the daemon and overlay it bundles, and the Web Store sees a higher
// version on every release. Runs after tsdown has copied public/. Then copies dist/
// to dist-firefox/ with the manifest Firefox wants: the scripts are the same.
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const { version } = JSON.parse(
    readFileSync(new URL('../../../packages/tencil/package.json', import.meta.url), 'utf8'),
);
// Chrome only takes one to four dot-separated integers: no prerelease tags.
if (!/^\d+(\.\d+){0,3}$/.test(version)) {
    throw new Error(`tencil ${version} isn't a version Chrome accepts`);
}

const dist = new URL('../dist/', import.meta.url);
const firefox = new URL('../dist-firefox/', import.meta.url);

const write = (dir, manifest) =>
    writeFileSync(new URL('manifest.json', dir), `${JSON.stringify(manifest, null, 4)}\n`);

const manifest = { ...JSON.parse(readFileSync(new URL('manifest.json', dist), 'utf8')), version };
write(dist, manifest);

rmSync(firefox, { recursive: true, force: true });
cpSync(dist, firefox, { recursive: true });
write(firefox, {
    ...manifest,
    // Firefox runs MV3 backgrounds as event pages, not service workers.
    background: { scripts: [manifest.background.service_worker] },
    browser_specific_settings: {
        gecko: {
            id: 'extension@tencil.dev',
            // `executeScript` into the page's own world (`world: 'MAIN'`) arrived in 128.
            strict_min_version: '128.0',
            // Nothing leaves the machine: the overlay only talks to the local daemon.
            data_collection_permissions: { required: ['none'] },
        },
    },
});
