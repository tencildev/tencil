import { describe, expect, it } from 'vitest';
import { CHANGELOG_URL, changelogUrl } from './changelog.ts';

describe('changelogUrl', () => {
    it("links to a release's own page, dots replaced by dashes", () => {
        expect(changelogUrl('0.11.0')).toBe('https://tencil.dev/changelog/0-11-0');
        expect(changelogUrl('12.3.45')).toBe('https://tencil.dev/changelog/12-3-45');
    });

    it('links to the overview without a version or for one without a page', () => {
        expect(CHANGELOG_URL).toBe('https://tencil.dev/changelog');
        expect(changelogUrl()).toBe(CHANGELOG_URL);
        expect(changelogUrl('0.12.0-beta.1')).toBe(CHANGELOG_URL);
        expect(changelogUrl('0.12.0+build.5')).toBe(CHANGELOG_URL);
        expect(changelogUrl('latest')).toBe(CHANGELOG_URL);
    });
});
