// Ships the overlay bundle inside the published package (cross-platform `cp`).
import { copyFileSync } from 'node:fs';

copyFileSync(
    new URL('../../overlay/dist/tencil.global.js', import.meta.url),
    new URL('../dist/overlay.global.js', import.meta.url),
);
