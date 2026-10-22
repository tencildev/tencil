import { defineConfig } from 'tsdown';

export default defineConfig({
    entry: { background: 'src/background.ts' },
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    dts: false,
    deps: { alwaysBundle: [/.*/], onlyBundle: false },
    outputOptions: { entryFileNames: '[name].js' },
    // The overlay as built here, for pages whose CSP won't load the daemon's copy.
    copy: [
        'public/*',
        { from: '../../packages/overlay/dist/tencil.global.js', rename: 'overlay.js' },
    ],
});
