import { defineConfig } from 'tsdown';

export default defineConfig([
    {
        // Keys are the published file names (dist/cli.mjs, dist/vite.mjs, …).
        entry: {
            index: 'src/index.ts',
            cli: 'src/cli/index.ts',
            vite: 'src/integrations/vite.ts',
            react: 'src/integrations/react.ts',
            next: 'src/integrations/next.ts',
        },
        format: 'esm',
        platform: 'node',
        target: 'node22',
        tsconfig: 'tsconfig.build.json',
        dts: { eager: true },
        // Workspace packages are private; inline them into the published build.
        deps: { alwaysBundle: [/^@tencildev\//] },
    },
    {
        // webpack and Turbopack load loaders with require().
        entry: { 'next-loader': 'src/integrations/next-loader.ts' },
        format: 'cjs',
        platform: 'node',
        target: 'node22',
        tsconfig: 'tsconfig.build.json',
        dts: false,
        clean: false,
    },
]);
