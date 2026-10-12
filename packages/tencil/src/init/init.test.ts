import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addImport, addTencilToBody, addVitePlugin, addWithTencil } from './codemods.ts';
import { detectPackageManager, findApps } from './detect-framework.ts';
import { diffLines } from './diff.ts';
import { planInit, runInit } from './run-init.ts';

const CREATE_NEXT_APP_CONFIG = `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
`;

const CREATE_NEXT_APP_LAYOUT = `import type { Metadata } from "next";
import "./globals.css";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
`;

/** Shaped like the Eyes dashboard: 4 spaces, single quotes. */
const EYES_LAYOUT = `import type { Metadata } from 'next';
import type { PropsWithChildren } from 'react';

import '~styles/global.css';

const RootLayout = ({ children }: PropsWithChildren) => {
    return (
        <html lang="en">
            <body className="bg-neutral-50">
                <Providers>{children}</Providers>
            </body>
        </html>
    );
};

export default RootLayout;
`;

const CREATE_VITE_CONFIG = `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
})
`;

describe('addVitePlugin', () => {
    it("adds the plugin and import in the file's style", () => {
        expect(addVitePlugin(CREATE_VITE_CONFIG)).toBe(`import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tencil from 'tencil/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tencil()],
})
`);
    });

    it('appends to multi-line plugin arrays', () => {
        const source = `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    react({ babel: { plugins: ["x"] } }),
    tsconfigPaths()
  ],
});
`;
        expect(addVitePlugin(source)).toContain(`    tsconfigPaths(),
    tencil(),
  ],`);
    });

    it('creates plugins when there are none', () => {
        expect(
            addVitePlugin(
                `import { defineConfig } from "vite";\n\nexport default defineConfig({});\n`,
            ),
        ).toContain('plugins: [tencil()],');
    });

    it("is idempotent and refuses shapes it can't edit", () => {
        const once = addVitePlugin(CREATE_VITE_CONFIG)!;
        expect(addVitePlugin(once)).toBe(once);
        expect(addVitePlugin('export default someFactory();\n')).toBeNull();
    });
});

describe('addTencilToBody', () => {
    it('adds <Tencil /> as the last child of body', () => {
        const result = addTencilToBody(CREATE_NEXT_APP_LAYOUT)!;
        expect(result).toContain(`        {children}
        <Tencil />
      </body>`);
        expect(result).toContain('import "./globals.css";\nimport { Tencil } from "tencil/react";');
    });

    it('follows 4-space indentation and single quotes', () => {
        const result = addTencilToBody(EYES_LAYOUT)!;
        expect(result).toContain(`                <Providers>{children}</Providers>
                <Tencil />
            </body>`);
        expect(result).toContain("import { Tencil } from 'tencil/react';");
    });

    it('handles a body on one line and refuses files without one', () => {
        expect(
            addTencilToBody('import x from "y";\nconst A = () => <body>{children}</body>;\n'),
        ).toContain('<body>{children}<Tencil /></body>');
        expect(addTencilToBody('export default function Page() { return null; }\n')).toBeNull();
    });
});

describe('addImport', () => {
    it('goes after multi-line imports and after directives when there are no imports', () => {
        const multi = 'import {\n  a,\n  b,\n} from "x";\n\nconst c = 1;\n';
        expect(addImport(multi, 'import d from "d";')).toBe(
            'import {\n  a,\n  b,\n} from "x";\nimport d from "d";\n\nconst c = 1;\n',
        );
        expect(addImport('"use client";\nconst a = 1;\n', 'import d from "d";')).toBe(
            '"use client";\nimport d from "d";\nconst a = 1;\n',
        );
    });
});

describe('addWithTencil', () => {
    it('wraps the exported Next config', () => {
        const after = addWithTencil(CREATE_NEXT_APP_CONFIG);
        expect(after).toContain('import { withTencil } from "tencil/next";');
        expect(after).toContain('export default withTencil(nextConfig);');
        expect(addWithTencil(after as string)).toBe(after);
    });

    it('wraps object literals and other plugins, keeping the style', () => {
        const literal = `import type { NextConfig } from 'next'\n\nexport default {\n  images: { unoptimized: true },\n} satisfies NextConfig\n`;
        expect(addWithTencil(literal)).toBe(
            `import type { NextConfig } from 'next'\nimport { withTencil } from 'tencil/next'\n\nexport default withTencil({\n  images: { unoptimized: true },\n} satisfies NextConfig)\n`,
        );
        const wrapped = addWithTencil(
            "import createMDX from '@next/mdx';\n\nexport default createMDX({})({ reactStrictMode: true });\n",
        );
        expect(wrapped).toContain(
            'export default withTencil(createMDX({})({ reactStrictMode: true }));',
        );
    });

    it('gives up on shapes it cannot wrap', () => {
        expect(addWithTencil('module.exports = { reactStrictMode: true };\n')).toBeNull();
        expect(addWithTencil('export default function config() { return {}; }\n')).toBeNull();
    });
});

describe('planInit', () => {
    const project = (files: Record<string, string>) => {
        const root = mkdtempSync(join(tmpdir(), 'tencil-init-'));
        for (const [path, content] of Object.entries(files)) {
            mkdirSync(join(root, path, '..'), { recursive: true });
            writeFileSync(join(root, path), content);
        }
        return root;
    };

    it('plans the Next.js app router edits', async () => {
        const root = project({
            'package.json': JSON.stringify({ dependencies: { next: '16.0.0' } }),
            'next.config.ts': CREATE_NEXT_APP_CONFIG,
            'src/app/layout.tsx': CREATE_NEXT_APP_LAYOUT,
        });
        const plan = await planInit(root);
        expect(plan.framework.kind).toBe('next-app');
        // The overlay loads from the daemon; next.config stays untouched.
        expect(plan.edits.map(e => relative(root, e.path).split(sep).join('/'))).toEqual([
            'src/app/layout.tsx',
        ]);
        expect(plan.manual).toEqual([]);
    });

    it('plans Vite edits and falls back to instructions elsewhere', async () => {
        const vite = await planInit(
            project({
                'package.json': JSON.stringify({ devDependencies: { vite: '8.0.0' } }),
                'vite.config.ts': CREATE_VITE_CONFIG,
            }),
        );
        expect(vite.framework.kind).toBe('vite');
        expect(vite.edits).toHaveLength(1);

        const unknown = await planInit(project({ 'package.json': '{}' }));
        expect(unknown.edits).toEqual([]);
        expect(unknown.manual[0]).toContain('tencil.js');
    });

    it('wraps next.config for Tencil Cloud, and leaves it alone otherwise', async () => {
        const files = {
            'package.json': JSON.stringify({ dependencies: { next: '16.0.0' } }),
            'next.config.ts': CREATE_NEXT_APP_CONFIG,
            'app/layout.tsx': CREATE_NEXT_APP_LAYOUT,
        };
        const paths = (plan: Awaited<ReturnType<typeof planInit>>, root: string) =>
            plan.edits.map(e => relative(root, e.path).split(sep).join('/'));
        const local = project(files);
        expect(paths(await planInit(local), local)).toEqual(['app/layout.tsx']);
        const cloud = project(files);
        expect(paths(await planInit(cloud, { cloud: true }), cloud)).toEqual([
            'app/layout.tsx',
            'next.config.ts',
        ]);
    });

    it('sets up for Tencil Cloud without a daemon or pairing', async () => {
        const root = project({
            'package.json': JSON.stringify({ devDependencies: { vite: '8.0.0', tencil: '1' } }),
            'vite.config.ts': CREATE_VITE_CONFIG,
        });
        const lines: string[] = [];
        await runInit({ root, yes: true, skipInstall: true, cloud: true, log: l => lines.push(l) });
        const output = lines.join('\n');
        expect(readFileSync(join(root, 'vite.config.ts'), 'utf8')).toContain('tencil()');
        expect(output).toContain('TENCIL_CLOUD=<project key>');
        expect(output).toContain('Preview');
        expect(output).not.toMatch(/is running|Pair/);
    });

    it('finds the apps in a monorepo root, skipping node_modules', async () => {
        const root = project({
            'package.json': JSON.stringify({ private: true }),
            'apps/web/package.json': JSON.stringify({ dependencies: { next: '16.0.0' } }),
            'apps/web/app/layout.tsx': CREATE_NEXT_APP_LAYOUT,
            'apps/admin/package.json': JSON.stringify({ devDependencies: { vite: '8.0.0' } }),
            'apps/admin/vite.config.ts': CREATE_VITE_CONFIG,
            'packages/ui/package.json': '{}',
            'node_modules/some-app/package.json': JSON.stringify({ dependencies: { next: '1' } }),
        });
        const apps = await findApps(root);
        expect(apps.map(app => [relative(root, app.dir).split(sep).join('/'), app.label])).toEqual([
            ['apps/admin', 'Vite'],
            ['apps/web', 'Next.js'],
        ]);
    });

    it('asks for manual steps when the pages router has no _document', async () => {
        const plan = await planInit(
            project({
                'package.json': JSON.stringify({ dependencies: { next: '15.0.0' } }),
                'next.config.mjs': 'export default {};\n',
                'pages/_app.tsx': 'export default function App() { return null; }\n',
            }),
        );
        expect(plan.framework.kind).toBe('next-pages');
        expect(plan.edits).toHaveLength(0);
        expect(plan.manual[0]).toContain('_document');
    });

    it('finds the package manager from a parent lockfile', () => {
        const root = project({ 'pnpm-lock.yaml': '', 'apps/web/package.json': '{}' });
        expect(detectPackageManager(join(root, 'apps/web'))).toBe('pnpm');
    });
});

describe('diffLines', () => {
    it('shows a replaced line as removal then addition', () => {
        expect(diffLines('a\nb', 'a\nc').filter(l => l.kind !== 'same')).toEqual([
            { kind: 'remove', text: 'b' },
            { kind: 'add', text: 'c' },
        ]);
    });

    it('marks only inserted lines', () => {
        const lines = diffLines('a\nb\nc', 'a\nx\nb\nc');
        expect(lines.filter(l => l.kind !== 'same')).toEqual([{ kind: 'add', text: 'x' }]);
    });
});

describe('what setup suggests next', () => {
    it('knows whether the folder it runs in already loads Tencil', async () => {
        const { nextSteps } = await import('../cli/commands/setup.ts');
        const project = (layout: string) => {
            const root = mkdtempSync(join(tmpdir(), 'tencil-next-'));
            mkdirSync(join(root, 'app'));
            writeFileSync(
                join(root, 'package.json'),
                JSON.stringify({ dependencies: { next: '16.0.0' } }),
            );
            writeFileSync(join(root, 'app', 'layout.tsx'), layout);
            return root;
        };
        const wired = `import { Tencil } from 'tencil/react';\n\nexport default function RootLayout({ children }) {\n    return (\n        <html>\n            <body>\n                {children}\n                <Tencil />\n            </body>\n        </html>\n    );\n}\n`;
        expect(await nextSteps(project(wired))).toMatch(
            /already loads Tencil[\s\S]*another project/,
        );
        expect(await nextSteps(project(CREATE_NEXT_APP_LAYOUT))).toMatch(/Next, add Tencil to/);
        expect(await nextSteps(tmpdir())).toMatch(/Next, in each project/);
    });
});
