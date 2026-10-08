import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsdown';

export default defineConfig({
    entry: { fixhere: 'src/index.ts' },
    format: 'iife',
    globalName: 'Fixhere',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    dts: false,
    outExtensions: () => ({ js: '.global.js' }),
    alias: { react: fileURLToPath(new URL('./src/shims/react.ts', import.meta.url)) },
    // The overlay ships as one self-contained script tag.
    deps: { alwaysBundle: [/.*/], onlyBundle: false },
    outputOptions: { entryFileNames: '[name].global.js' },
});
