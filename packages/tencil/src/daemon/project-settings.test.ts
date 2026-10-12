import { mkdtempSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { ProjectProviders } from '@tencildev/bridge';
import { FakeAgentProvider } from '@tencildev/testing';
import { describe, expect, it } from 'vitest';
import { FileProjectSettings, projectSettingsPath } from './project-settings.ts';

function setup(path = join(mkdtempSync(join(tmpdir(), 'tencil-')), 'settings.json')) {
    const providers = new ProjectProviders({
        choices: [
            { id: 't3code', label: 'T3 Code' },
            { id: 'claude-code', label: 'Claude Code' },
        ],
        fallback: 't3code',
        create: id => new FakeAgentProvider({ id }),
        settings: new FileProjectSettings(path),
    });
    return { providers, path };
}

describe('FileProjectSettings', () => {
    it("sits next to the project's pins", () => {
        expect(projectSettingsPath('/Users/me/Code/eyes', '/data').split(sep).at(-1)).toMatch(
            /^eyes-[0-9a-f]{10}\.settings\.json$/,
        );
    });

    it("keeps the project's choices across restarts", async () => {
        const { providers, path } = setup();
        await providers.load();
        await providers.setDefault('claude-code');
        await providers.setModel('t3code', 'claudeAgent/claude-opus-5-5');
        await providers.setBatch(false);
        expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
            version: 1,
            provider: 'claude-code',
            models: { t3code: 'claudeAgent/claude-opus-5-5' },
            batch: false,
        });

        const reloaded = setup(path).providers;
        await reloaded.load();
        expect(reloaded.defaultId).toBe('claude-code');
        expect(reloaded.modelFor('t3code')).toBe('claudeAgent/claude-opus-5-5');
        expect(reloaded.batch).toBe(false);
    });

    it('starts from the defaults without a file', async () => {
        const { providers } = setup();
        await providers.load();
        expect(providers.defaultId).toBe('t3code');
        expect(providers.batch).toBe(true);
    });
});
