/** The changelog on tencil.dev: every release, newest first. */
export const CHANGELOG_URL = 'https://tencil.dev/changelog';

/**
 * One release's changelog page, `/changelog/0-11-0` for 0.11.0. Only plain
 * releases get a page, so anything else (a prerelease, a build tag) links to
 * the overview instead.
 */
export function changelogUrl(version?: string): string {
    return version && /^\d+\.\d+\.\d+$/.test(version)
        ? `${CHANGELOG_URL}/${version.replaceAll('.', '-')}`
        : CHANGELOG_URL;
}
