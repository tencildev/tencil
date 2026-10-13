import { defineConfig } from 'tsdown';

export default defineConfig({
    entry: { index: 'src/index.ts' },
    format: 'esm',
    // Shared by the daemon and the browser overlay.
    platform: 'neutral',
    target: 'es2022',
    // .mjs and .d.mts, like the other packages (neutral builds default to .js).
    fixedExtension: true,
    tsconfig: 'tsconfig.build.json',
    dts: { eager: true },
});
