import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { CODEX_PROVIDER, FakeT3Server } from '@tencildev/testing';

const REPO = 'github.com/tencildev/tencil';

/** Fake T3 Code for the browser tests; Playwright starts this as a web server. */
const port = Number(process.env.FAKE_T3_PORT ?? 47390);
const server = await FakeT3Server.start({
    port,
    label: 'Studio',
    // What the stand-in `t3` CLI prints, so Tencil signs in to `/mcp` as it would for real.
    pairingCode: process.env.FAKE_T3_PAIRING_CODE,
    projects: [
        {
            id: 'tencil',
            title: 'tencil',
            workspaceRoot: realpathSync.native(resolve(import.meta.dirname, '../../..')),
            repositoryIdentity: { canonicalKey: REPO },
        },
    ],
    linkedMachines: [
        {
            environmentId: 'env-macbook',
            label: 'MacBook Pro',
            projects: [
                {
                    id: 'tencil-mac',
                    title: 'tencil',
                    workspaceRoot: '/Users/me/Code/tencil',
                    repositoryIdentity: { canonicalKey: REPO },
                },
            ],
        },
        { environmentId: 'env-vps', label: 'VPS', status: 'expired', projects: [] },
    ],
    chunkDelayMs: 25,
    providers: [
        CODEX_PROVIDER,
        {
            instanceId: 'claudeAgent',
            driver: 'claudeAgent',
            displayName: 'Claude',
            enabled: true,
            installed: true,
            status: 'ready',
            models: [
                { slug: 'claude-test', name: 'Claude Test', isDefault: true },
                { slug: 'claude-test-mini', name: 'Claude Test Mini' },
            ],
        },
    ],
    reply: text =>
        `Updated it.\n\n- Changed **${text.split('\n')[0]?.slice(0, 40)}**\n- Kept the rest as is`,
});
console.log(`Fake T3 Code listening on ${server.url}`);
process.on('SIGTERM', () => void server.close().then(() => process.exit(0)));
