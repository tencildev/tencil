import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addSourceAttributes, repositoryRoot } from './source-attributes.ts';

const ROOT = join(tmpdir(), 'repo');
const file = (path: string) => join(ROOT, path);

async function tag(code: string, path = 'src/card.tsx') {
    return (await addSourceAttributes(code, file(path), ROOT))?.code;
}

describe('addSourceAttributes', () => {
    it('tags host elements with their file, line and component', async () => {
        const code = `import { memo } from 'react';

export function Card({ title }: { title: string }) {
    return (
        <div className="card">
            <h2>{title}</h2>
            <Button />
        </div>
    );
}

const Footer = memo(() => <footer>ok</footer>);
`;
        const out = await tag(code);
        expect(out).toContain(
            '<div data-tencil-src={"src/card.tsx:5:9"} data-tencil-component={"Card"} className="card">',
        );
        expect(out).toContain(
            '<h2 data-tencil-src={"src/card.tsx:6:13"} data-tencil-component={"Card"}>',
        );
        expect(out).toContain('<Button />');
        expect(out).toContain(
            '<footer data-tencil-src={"src/card.tsx:12:27"} data-tencil-component={"Footer"}>',
        );
    });

    it('leaves document-level tags, components and tagged elements alone', async () => {
        const code = `export default function Layout({ children }) {
    return <html><head><title>x</title></head><body data-tencil-src="kept">{children}<Foo.Bar /></body></html>;
}`;
        const out = await tag(code, 'app/layout.jsx');
        expect(out).toBeUndefined();
    });

    it('works outside components and with non-ASCII text before the element', async () => {
        const out = await tag(
            'const label = "héllo 👋";\nexport const x = <span>{label}</span>;\n',
        );
        expect(out).toContain('<span data-tencil-src={"src/card.tsx:2:18"}>');
    });

    it('skips files it must not touch', async () => {
        const jsx = 'export const A = () => <div />;';
        expect(await addSourceAttributes(jsx, file('node_modules/x/a.jsx'), ROOT)).toBeUndefined();
        expect(await addSourceAttributes(jsx, file('src/a.ts'), ROOT)).toBeUndefined();
        expect(
            await addSourceAttributes(jsx, join(tmpdir(), 'elsewhere/a.tsx'), ROOT),
        ).toBeUndefined();
        expect(await addSourceAttributes('const = <div', file('src/a.tsx'), ROOT)).toBeUndefined();
    });

    it('drops query strings and returns a source map', async () => {
        const result = await addSourceAttributes(
            'export const A = () => <div />;',
            `${file('src/a.tsx')}?v=1`,
            ROOT,
        );
        expect(result?.code).toContain('"src/a.tsx:1:24"');
        expect(result?.map).toMatchObject({ sources: [expect.stringContaining('a.tsx')] });
    });
});

describe('repositoryRoot', () => {
    it('finds .git, else the outermost workspace root', () => {
        const base = mkdtempSync(join(tmpdir(), 'tencil-root-'));
        mkdirSync(join(base, 'mono/apps/web/src'), { recursive: true });
        writeFileSync(join(base, 'mono/pnpm-workspace.yaml'), 'packages: [apps/*]');
        writeFileSync(join(base, 'mono/apps/web/package.json'), '{}');
        expect(repositoryRoot(join(base, 'mono/apps/web'))).toBe(join(base, 'mono'));

        mkdirSync(join(base, 'mono/.git'));
        expect(repositoryRoot(join(base, 'mono/apps/web/src'))).toBe(join(base, 'mono'));

        mkdirSync(join(base, 'plain'));
        expect(repositoryRoot(join(base, 'plain'))).toBe(join(base, 'plain'));
    });
});
