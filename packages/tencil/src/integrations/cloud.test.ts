import { describe, expect, it } from 'vitest';
import { cloudLoader, resolveCloudBuild } from './cloud.ts';

const KEY = 'proj_3fK9xQ2mVb7Lw1Za';
const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

const vercelPreview = {
    TENCIL_CLOUD: KEY,
    VERCEL_ENV: 'preview',
    VERCEL_GIT_REPO_OWNER: 'acme',
    VERCEL_GIT_REPO_SLUG: 'shop',
    VERCEL_GIT_COMMIT_REF: 'feat/checkout',
    VERCEL_GIT_COMMIT_SHA: SHA,
};

describe('resolveCloudBuild', () => {
    it('is off without a project key, whatever else is set', () => {
        expect(resolveCloudBuild({ ...vercelPreview, TENCIL_CLOUD: undefined })).toEqual({
            kind: 'off',
        });
        expect(resolveCloudBuild({})).toEqual({ kind: 'off' });
    });

    it('takes the build from Vercel preview env vars', () => {
        expect(resolveCloudBuild(vercelPreview)).toEqual({
            kind: 'on',
            url: 'https://cloud.tencil.dev',
            build: { projectKey: KEY, repo: 'acme/shop', branch: 'feat/checkout', sha: SHA },
        });
    });

    it('never loads on a production deployment', () => {
        const vercel = resolveCloudBuild({ ...vercelPreview, VERCEL_ENV: 'production' });
        expect(vercel).toMatchObject({
            kind: 'refused',
            reason: expect.stringMatching(/production/),
        });

        const netlify = resolveCloudBuild({
            TENCIL_CLOUD: KEY,
            NETLIFY: 'true',
            CONTEXT: 'production',
            REPOSITORY_URL: 'https://github.com/acme/shop',
            HEAD: 'main',
            COMMIT_REF: SHA,
        });
        expect(netlify.kind).toBe('refused');

        const explicit = resolveCloudBuild({ ...vercelPreview, TENCIL_CLOUD_ENV: 'production' });
        expect(explicit.kind).toBe('refused');
    });

    it('reads Netlify, Cloudflare Pages and GitHub Actions builds', () => {
        expect(
            resolveCloudBuild({
                TENCIL_CLOUD: KEY,
                NETLIFY: 'true',
                CONTEXT: 'deploy-preview',
                REPOSITORY_URL: 'https://github.com/acme/shop.git',
                HEAD: 'fix/footer',
                COMMIT_REF: SHA,
            }),
        ).toMatchObject({ kind: 'on', build: { repo: 'acme/shop', branch: 'fix/footer' } });

        expect(
            resolveCloudBuild({
                TENCIL_CLOUD: KEY,
                TENCIL_CLOUD_REPO: 'acme/shop',
                CF_PAGES_BRANCH: 'fix/footer',
                CF_PAGES_COMMIT_SHA: SHA,
            }),
        ).toMatchObject({ kind: 'on', build: { branch: 'fix/footer', sha: SHA } });

        expect(
            resolveCloudBuild({
                TENCIL_CLOUD: KEY,
                GITHUB_REPOSITORY: 'acme/shop',
                GITHUB_HEAD_REF: 'fix/footer',
                GITHUB_REF_NAME: '12/merge',
                GITHUB_SHA: SHA,
            }),
        ).toMatchObject({ kind: 'on', build: { repo: 'acme/shop', branch: 'fix/footer' } });
    });

    it('lets options and TENCIL_CLOUD_* override the host', () => {
        const resolved = resolveCloudBuild(
            {
                ...vercelPreview,
                TENCIL_CLOUD_BRANCH: 'from-env',
                TENCIL_CLOUD_URL: 'http://localhost:8130/',
            },
            { repo: 'acme/other' },
        );
        expect(resolved).toMatchObject({
            kind: 'on',
            url: 'http://localhost:8130',
            build: { repo: 'acme/other', branch: 'from-env' },
        });
    });

    it('refuses a build it cannot map to code', () => {
        const missing = resolveCloudBuild({ TENCIL_CLOUD: KEY });
        expect(missing).toMatchObject({
            kind: 'refused',
            reason: expect.stringMatching(/No repository, branch, commit/),
        });
        expect(resolveCloudBuild({ ...vercelPreview, TENCIL_CLOUD: 'x' }).kind).toBe('refused');
        expect(resolveCloudBuild(vercelPreview, { repo: 'not a repo' }).kind).toBe('refused');
        expect(resolveCloudBuild(vercelPreview, { sha: 'HEAD' }).kind).toBe('refused');
        expect(resolveCloudBuild(vercelPreview, { url: 'javascript:alert(1)' }).kind).toBe(
            'refused',
        );
    });
});

/** Runs a loader against a fake page and returns the scripts it added. */
function run(code: string) {
    const appended: Array<{ src: string; async: boolean; dataset: Record<string, string> }> = [];
    const document = {
        querySelector: (selector: string) =>
            appended.find(s => selector.includes(`"${s.src}"`)) ?? null,
        createElement: () => ({ src: '', async: false, dataset: {} }),
        head: { appendChild: (script: (typeof appended)[number]) => appended.push(script) },
    };
    new Function('document', code)(document);
    new Function('document', code)(document);
    return appended;
}

describe('cloud loader', () => {
    it('loads the overlay from Tencil Cloud once, with the build on the tag', () => {
        const resolved = resolveCloudBuild(vercelPreview);
        if (resolved.kind !== 'on') throw new Error('expected on');
        expect(run(cloudLoader(resolved))).toEqual([
            {
                src: 'https://cloud.tencil.dev/tencil.js',
                async: true,
                dataset: {
                    bridge: 'https://cloud.tencil.dev',
                    tencilProject: KEY,
                    tencilRepo: 'acme/shop',
                    tencilBranch: 'feat/checkout',
                    tencilSha: SHA,
                },
            },
        ]);
    });

    it('keeps a hostile branch name inside its string', () => {
        const branch = '</script><script>alert(1)</script>"; alert(2); "';
        const code = cloudLoader({
            url: 'https://cloud.tencil.dev',
            build: { projectKey: KEY, repo: 'acme/shop', branch, sha: SHA },
        });
        expect(code).not.toContain('</script>');
        expect(run(code)[0]?.dataset.tencilBranch).toBe(branch);
    });
});
