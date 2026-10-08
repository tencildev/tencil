import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { addFixhereToBody, addImport, addVitePlugin, wrapNextConfig } from "./codemods.ts";
import { detectPackageManager } from "./detect.ts";
import { diffLines } from "./diff.ts";
import { planInit } from "./run.ts";

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

describe("addVitePlugin", () => {
  it("adds the plugin and import in the file's style", () => {
    expect(addVitePlugin(CREATE_VITE_CONFIG)).toBe(`import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fixhere from 'fixhere/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), fixhere()],
})
`);
  });

  it("appends to multi-line plugin arrays", () => {
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
    fixhere(),
  ],`);
  });

  it("creates plugins when there are none", () => {
    expect(
      addVitePlugin(`import { defineConfig } from "vite";\n\nexport default defineConfig({});\n`),
    ).toContain("plugins: [fixhere()],");
  });

  it("is idempotent and refuses shapes it can't edit", () => {
    const once = addVitePlugin(CREATE_VITE_CONFIG)!;
    expect(addVitePlugin(once)).toBe(once);
    expect(addVitePlugin("export default someFactory();\n")).toBeNull();
  });
});

describe("wrapNextConfig", () => {
  it("wraps the default export", () => {
    const result = wrapNextConfig(CREATE_NEXT_APP_CONFIG)!;
    expect(result).toContain(
      'import type { NextConfig } from "next";\nimport { withFixhere } from "fixhere/next";',
    );
    expect(result.trimEnd().endsWith("export default withFixhere(nextConfig);")).toBe(true);
  });

  it("wraps inline objects and CommonJS configs", () => {
    expect(wrapNextConfig("export default {\n  reactStrictMode: true,\n};\n")).toContain(
      "export default withFixhere({\n  reactStrictMode: true,\n});",
    );
    const cjs = wrapNextConfig(
      "/** @type {import('next').NextConfig} */\nmodule.exports = { reactStrictMode: true };\n",
    )!;
    expect(cjs.startsWith("const { withFixhere } = require(")).toBe(true);
    expect(cjs).toContain("module.exports = withFixhere({ reactStrictMode: true });");
  });

  it("is idempotent", () => {
    const once = wrapNextConfig(CREATE_NEXT_APP_CONFIG)!;
    expect(wrapNextConfig(once)).toBe(once);
  });
});

describe("addFixhereToBody", () => {
  it("adds <Fixhere /> as the last child of body", () => {
    const result = addFixhereToBody(CREATE_NEXT_APP_LAYOUT)!;
    expect(result).toContain(`        {children}
        <Fixhere />
      </body>`);
    expect(result).toContain('import "./globals.css";\nimport { Fixhere } from "fixhere/react";');
  });

  it("follows 4-space indentation and single quotes", () => {
    const result = addFixhereToBody(EYES_LAYOUT)!;
    expect(result).toContain(`                <Providers>{children}</Providers>
                <Fixhere />
            </body>`);
    expect(result).toContain("import { Fixhere } from 'fixhere/react';");
  });

  it("handles a body on one line and refuses files without one", () => {
    expect(
      addFixhereToBody('import x from "y";\nconst A = () => <body>{children}</body>;\n'),
    ).toContain("<body>{children}<Fixhere /></body>");
    expect(addFixhereToBody("export default function Page() { return null; }\n")).toBeNull();
  });
});

describe("addImport", () => {
  it("goes after multi-line imports and after directives when there are no imports", () => {
    const multi = 'import {\n  a,\n  b,\n} from "x";\n\nconst c = 1;\n';
    expect(addImport(multi, 'import d from "d";')).toBe(
      'import {\n  a,\n  b,\n} from "x";\nimport d from "d";\n\nconst c = 1;\n',
    );
    expect(addImport('"use client";\nconst a = 1;\n', 'import d from "d";')).toBe(
      '"use client";\nimport d from "d";\nconst a = 1;\n',
    );
  });
});

describe("planInit", () => {
  const project = (files: Record<string, string>) => {
    const root = mkdtempSync(join(tmpdir(), "fixhere-init-"));
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(join(root, path, ".."), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    return root;
  };

  it("plans the Next.js app router edits", async () => {
    const root = project({
      "package.json": JSON.stringify({ dependencies: { next: "16.0.0" } }),
      "next.config.ts": CREATE_NEXT_APP_CONFIG,
      "src/app/layout.tsx": CREATE_NEXT_APP_LAYOUT,
    });
    const plan = await planInit(root);
    expect(plan.framework.kind).toBe("next-app");
    expect(plan.edits.map((e) => e.path.replace(root, ""))).toEqual([
      "/next.config.ts",
      "/src/app/layout.tsx",
    ]);
    expect(plan.manual).toEqual([]);
  });

  it("plans Vite edits and falls back to instructions elsewhere", async () => {
    const vite = await planInit(
      project({
        "package.json": JSON.stringify({ devDependencies: { vite: "8.0.0" } }),
        "vite.config.ts": CREATE_VITE_CONFIG,
      }),
    );
    expect(vite.framework.kind).toBe("vite");
    expect(vite.edits).toHaveLength(1);

    const unknown = await planInit(project({ "package.json": "{}" }));
    expect(unknown.edits).toEqual([]);
    expect(unknown.manual[0]).toContain("fixhere.js");
  });

  it("asks for manual steps when the pages router has no _document", async () => {
    const plan = await planInit(
      project({
        "package.json": JSON.stringify({ dependencies: { next: "15.0.0" } }),
        "next.config.mjs": "export default {};\n",
        "pages/_app.tsx": "export default function App() { return null; }\n",
      }),
    );
    expect(plan.framework.kind).toBe("next-pages");
    expect(plan.edits).toHaveLength(1);
    expect(plan.manual[0]).toContain("_document");
  });

  it("finds the package manager from a parent lockfile", () => {
    const root = project({ "pnpm-lock.yaml": "", "apps/web/package.json": "{}" });
    expect(detectPackageManager(join(root, "apps/web"))).toBe("pnpm");
  });
});

describe("diffLines", () => {
  it("shows a replaced line as removal then addition", () => {
    expect(diffLines("a\nb", "a\nc").filter((l) => l.kind !== "same")).toEqual([
      { kind: "remove", text: "b" },
      { kind: "add", text: "c" },
    ]);
  });

  it("marks only inserted lines", () => {
    const lines = diffLines("a\nb\nc", "a\nx\nb\nc");
    expect(lines.filter((l) => l.kind !== "same")).toEqual([{ kind: "add", text: "x" }]);
  });
});
