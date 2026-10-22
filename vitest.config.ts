import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
        environment: 'node',
        // An empty Claude Code home, so tests never see the developer's sessions.
        env: { CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'tencil-claude-home-')) },
    },
});
