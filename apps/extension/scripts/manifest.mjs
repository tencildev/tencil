// Stamps dist/manifest.json with the version of `tencil`, so the extension ships
// alongside the daemon and overlay it bundles, and the Web Store sees a higher
// version on every release. Runs after tsdown has copied public/.
import { readFileSync, writeFileSync } from 'node:fs';

const { version } = JSON.parse(
    readFileSync(new URL('../../../packages/tencil/package.json', import.meta.url), 'utf8'),
);
// Chrome only takes one to four dot-separated integers: no prerelease tags.
if (!/^\d+(\.\d+){0,3}$/.test(version)) {
    throw new Error(`tencil ${version} isn't a version Chrome accepts`);
}

const path = new URL('../dist/manifest.json', import.meta.url);
const manifest = JSON.parse(readFileSync(path, 'utf8'));
writeFileSync(path, `${JSON.stringify({ ...manifest, version }, null, 4)}\n`);
