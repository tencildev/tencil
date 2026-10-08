import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const FAKE_T3_PORT = 47390;
const DAEMON_PORT = 47391;
const APP_PORT = 5190;
// Fresh credentials and pin store per run, so local state never leaks in.
const configHome = mkdtempSync(join(tmpdir(), 'fixhere-e2e-'));

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
            env: { FAKE_T3_PORT: String(FAKE_T3_PORT) },
            reuseExistingServer: false,
        },
        {
            // The real daemon from the built CLI; it finds the playground's folder
            // from the Vite dev server's port, like it would on a developer's machine.
            command: `node ../../packages/fixhere/dist/cli.mjs daemon --port ${DAEMON_PORT}`,
            url: `http://127.0.0.1:${DAEMON_PORT}/health`,
            env: {
                FIXHERE_T3_URL: `http://127.0.0.1:${FAKE_T3_PORT}`,
                FIXHERE_T3_TOKEN: 'test-token',
                XDG_CONFIG_HOME: configHome,
            },
            reuseExistingServer: false,
        },
        {
            command: `vite --port ${APP_PORT} --strictPort`,
            url: `http://localhost:${APP_PORT}`,
            env: { FIXHERE_PORT: String(DAEMON_PORT) },
            reuseExistingServer: false,
        },
    ],
});
