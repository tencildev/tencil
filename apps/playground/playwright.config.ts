import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const FAKE_T3_PORT = 47390;
const DAEMON_PORT = 47391;
const APP_PORT = 5190;
const FAKE_REGISTRY_PORT = 47392;
// Fresh credentials and pin store per run, so local state never leaks in.
const configHome = mkdtempSync(join(tmpdir(), 'tencil-e2e-'));
// A stand-in for T3 Code's `t3` CLI that mints the fake's pairing code, as the real one would.
const PAIRING_CODE = 'E2E-PAIRING';
const t3Home = join(configHome, 't3');
const t3Cli = join(t3Home, 'runtime', 'versions', '0.0.45', 't3');
mkdirSync(join(t3Cli, '..'), { recursive: true });
writeFileSync(t3Cli, `#!/bin/sh\necho "Token: ${PAIRING_CODE}"\n`);
chmodSync(t3Cli, 0o755);

export default defineConfig({
    testDir: 'e2e',
    fullyParallel: false,
    workers: 1,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
    use: {
        baseURL: `http://localhost:${APP_PORT}`,
        trace: 'retain-on-failure',
        ...devices['Desktop Chrome'],
    },
    webServer: [
        {
            command: 'node --experimental-strip-types --no-warnings e2e/fake-t3-server.ts',
            url: `http://127.0.0.1:${FAKE_T3_PORT}/.well-known/t3/environment`,
            env: { FAKE_T3_PORT: String(FAKE_T3_PORT), FAKE_T3_PAIRING_CODE: PAIRING_CODE },
            reuseExistingServer: false,
        },
        {
            command: 'node --experimental-strip-types --no-warnings e2e/fake-registry.ts',
            url: `http://127.0.0.1:${FAKE_REGISTRY_PORT}/tencil/latest`,
            env: { FAKE_REGISTRY_PORT: String(FAKE_REGISTRY_PORT) },
            reuseExistingServer: false,
        },
        {
            // The real daemon from the built CLI; it finds the playground's folder
            // from the Vite dev server's port, like it would on a developer's machine.
            command: `node ../../packages/tencil/dist/cli.mjs daemon --port ${DAEMON_PORT}`,
            url: `http://127.0.0.1:${DAEMON_PORT}/health`,
            env: {
                TENCIL_T3_URL: `http://127.0.0.1:${FAKE_T3_PORT}`,
                TENCIL_T3_TOKEN: 'test-token',
                XDG_CONFIG_HOME: configHome,
                T3CODE_HOME: t3Home,
                // Update checks go to the fake registry, on CI too.
                TENCIL_REGISTRY_URL: `http://127.0.0.1:${FAKE_REGISTRY_PORT}`,
                CI: '',
            },
            reuseExistingServer: false,
        },
        {
            command: `vite --port ${APP_PORT} --strictPort`,
            url: `http://localhost:${APP_PORT}`,
            env: { TENCIL_PORT: String(DAEMON_PORT) },
            reuseExistingServer: false,
        },
    ],
});
