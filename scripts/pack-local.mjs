// Packs `tencil` into ./.pack for local installs before it's on npm.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const destination = fileURLToPath(new URL('../.pack', import.meta.url));
execFileSync('pnpm', ['--filter', 'tencil', 'pack', '--pack-destination', destination], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
});
