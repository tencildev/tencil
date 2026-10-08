import { defineConfig } from 'tsdown';

export default defineConfig({
    // Keys are the published file names (dist/cli.mjs, dist/vite.mjs, …).
    entry: {
        index: 'src/index.ts',
        cli: 'src/cli/index.ts',
        vite: 'src/integrations/vite.ts',
        react: 'src/integrations/react.ts',
    },
    format: 'esm',
    platform: 'node',
    target: 'node22',
    tsconfig: 'tsconfig.build.json',
    dts: { eager: true },
    // Workspace packages are private; inline them into the published build.
    deps: { alwaysBundle: [/^@fixhere\//] },
});
