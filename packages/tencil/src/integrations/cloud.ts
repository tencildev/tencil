import type { BuildInfo } from '@tencildev/protocol';

/** Where Tencil Cloud serves the overlay and its bridge. */
export const DEFAULT_CLOUD_URL = 'https://cloud.tencil.dev';

export interface TencilCloudOptions {
    /** Project key from the Tencil Cloud dashboard. Defaults to TENCIL_CLOUD. */
    project?: string;
    /** `owner/name` on GitHub. Defaults to the host's git env vars. */
    repo?: string;
    branch?: string;
    sha?: string;
    /** Tencil Cloud itself; only for testing against a local one. Defaults to TENCIL_CLOUD_URL. */
    url?: string;
}

export type CloudBuild =
    /** Not asked for: no project key. Builds stay exactly as without Tencil Cloud. */
    | { kind: 'off' }
    /** Asked for, but this build must not or cannot load it. */
    | { kind: 'refused'; reason: string }
    | { kind: 'on'; url: string; build: BuildInfo };

type Env = Record<string, string | undefined>;

const PROJECT_KEY = /^[A-Za-z0-9_-]{8,64}$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA = /^[0-9a-f]{7,64}$/i;

/**
 * Whether this build loads the overlay from Tencil Cloud. Only when a project key
 * is set, and never for a production deployment: the overlay lets reviewers make
 * an agent change the code, so it belongs on previews only. Repo, branch and
 * commit come from the host (Vercel, Netlify, Cloudflare Pages, GitHub Actions),
 * so the cloud knows which code the page was built from.
 */
export function resolveCloudBuild(env: Env, options: TencilCloudOptions = {}): CloudBuild {
    const projectKey = options.project ?? env.TENCIL_CLOUD;
    if (!projectKey) return { kind: 'off' };
    if (!PROJECT_KEY.test(projectKey)) {
        return { kind: 'refused', reason: 'TENCIL_CLOUD is not a Tencil Cloud project key.' };
    }

    const production = productionDeployment(env);
    if (production) {
        return { kind: 'refused', reason: `${production}: the overlay only loads on previews.` };
    }

    const repo = options.repo ?? env.TENCIL_CLOUD_REPO ?? hostRepo(env);
    const branch = options.branch ?? env.TENCIL_CLOUD_BRANCH ?? hostBranch(env);
    const sha = options.sha ?? env.TENCIL_CLOUD_SHA ?? hostSha(env);
    const missing = [!repo && 'repository', !branch && 'branch', !sha && 'commit'].filter(Boolean);
    if (missing.length) {
        return {
            kind: 'refused',
            reason: `No ${missing.join(', ')} found for this build. Set TENCIL_CLOUD_REPO, TENCIL_CLOUD_BRANCH and TENCIL_CLOUD_SHA.`,
        };
    }
    if (!REPO.test(repo as string)) {
        return { kind: 'refused', reason: `"${repo}" is not a GitHub repository (owner/name).` };
    }
    if (!SHA.test(sha as string)) {
        return { kind: 'refused', reason: `"${sha}" is not a commit hash.` };
    }

    const url = (options.url ?? env.TENCIL_CLOUD_URL ?? DEFAULT_CLOUD_URL).replace(/\/+$/, '');
    if (!/^https?:\/\//.test(url)) {
        return { kind: 'refused', reason: `TENCIL_CLOUD_URL "${url}" is not an http(s) URL.` };
    }
    return {
        kind: 'on',
        url,
        build: {
            projectKey,
            repo: repo as string,
            branch: branch as string,
            sha: (sha as string).toLowerCase(),
        },
    };
}

/** The host's name for a production deployment, if this is one. */
function productionDeployment(env: Env): string | undefined {
    if (env.VERCEL_ENV === 'production') return 'VERCEL_ENV is production';
    if (env.NETLIFY && env.CONTEXT === 'production') return 'Netlify CONTEXT is production';
    if (env.TENCIL_CLOUD_ENV === 'production') return 'TENCIL_CLOUD_ENV is production';
    return undefined;
}

function hostRepo(env: Env): string | undefined {
    if (env.VERCEL_GIT_REPO_OWNER && env.VERCEL_GIT_REPO_SLUG) {
        return `${env.VERCEL_GIT_REPO_OWNER}/${env.VERCEL_GIT_REPO_SLUG}`;
    }
    if (env.GITHUB_REPOSITORY) return env.GITHUB_REPOSITORY;
    // Netlify's REPOSITORY_URL looks like https://github.com/owner/name.
    const url = env.REPOSITORY_URL;
    const match = url?.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/);
    return match?.[1];
}

function hostBranch(env: Env): string | undefined {
    return (
        env.VERCEL_GIT_COMMIT_REF ??
        env.CF_PAGES_BRANCH ??
        (env.NETLIFY ? env.HEAD : undefined) ??
        env.GITHUB_HEAD_REF ??
        env.GITHUB_REF_NAME
    );
}

function hostSha(env: Env): string | undefined {
    return (
        env.VERCEL_GIT_COMMIT_SHA ??
        env.CF_PAGES_COMMIT_SHA ??
        (env.NETLIFY ? env.COMMIT_REF : undefined) ??
        env.GITHUB_SHA
    );
}

/** A JSON string literal that is also safe inside an inline `<script>`. */
function scriptString(value: string): string {
    return JSON.stringify(value).replace(/</g, '\\u003c');
}

/**
 * Browser code that loads the overlay from Tencil Cloud. The script tag carries
 * the build, which the overlay passes on when it connects.
 */
export function cloudLoader({ url, build }: { url: string; build: BuildInfo }): string {
    return `;(() => {
  if (typeof document === "undefined") return;
  const src = ${scriptString(`${url}/tencil.js`)};
  if (document.querySelector('script[src="' + src + '"]')) return;
  const script = document.createElement("script");
  script.src = src;
  script.async = true;
  script.dataset.bridge = ${scriptString(url)};
  script.dataset.tencilProject = ${scriptString(build.projectKey)};
  script.dataset.tencilRepo = ${scriptString(build.repo)};
  script.dataset.tencilBranch = ${scriptString(build.branch)};
  script.dataset.tencilSha = ${scriptString(build.sha)};
  document.head.appendChild(script);
})();`;
}
