import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    addImport,
    addTencilToBody,
    addVitePlugin,
    renameFromFixhere,
    usesFixhere,
} from './codemods.ts';
import { detectPackageManager, findApps } from './detect-framework.ts';
import { diffLines } from './diff.ts';
import { planInit } from './run-init.ts';

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

describe('projects set up as Fixhere', () => {
    it('renames the Next.js integration', () => {
        const layout = `import { Fixhere } from 'fixhere/react';

export default function RootLayout({ children }) {
    return (
        <html>
            <body>
                {children}
                <Fixhere port={4800} />
            </body>
        </html>
    );
}
`;
        expect(usesFixhere(layout)).toBe(true);
        const after = renameFromFixhere(layout);
        expect(after).toContain("import { Tencil } from 'tencil/react';");
        expect(after).toContain('<Tencil port={4800} />');
        expect(after).not.toMatch(/fixhere/i);
    });

    it('renames the Vite plugin', () => {
        const config = `import react from '@vitejs/plugin-react';
import fixhere from "fixhere/vite";
import { defineConfig } from 'vite';

export default defineConfig({ plugins: [react(), fixhere()] });
`;
        const after = renameFromFixhere(config);
        expect(after).toContain('import tencil from "tencil/vite";');
        expect(after).toContain('plugins: [react(), tencil()]');
        expect(usesFixhere(after)).toBe(false);
        expect(usesFixhere(CREATE_VITE_CONFIG)).toBe(false);
    });
});
