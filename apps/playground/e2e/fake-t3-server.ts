import { CODEX_PROVIDER, FakeT3Server, type FakeToolCall } from '@tencildev/testing';

const DEMO_TOOLS: FakeToolCall[] = [
    { type: 'file_search', durationMs: 900, fields: { pattern: 'PricingCard' } },
    {
        type: 'command_execution',
        durationMs: 700,
        fields: { input: 'cat src/components/pricing-card.tsx' },
    },
    { type: 'command_execution', durationMs: 600, fields: { input: 'cat src/styles.css' } },
    { type: 'file_search', durationMs: 1200, fields: { pattern: '--accent' } },
    {
        type: 'file_change',
        durationMs: 1800,
        fields: { fileName: 'src/components/pricing-card.tsx' },
    },
    { type: 'file_change', durationMs: 1100, fields: { fileName: 'src/styles.css' } },
    { type: 'command_execution', durationMs: 2600, fields: { input: 'pnpm typecheck' } },
    { type: 'command_execution', durationMs: 1400, fields: { input: 'pnpm test pricing-card' } },
];

/** Fake T3 Code for the browser tests; Playwright starts this as a web server. */
const port = Number(process.env.FAKE_T3_PORT ?? 47390);
/** `FAKE_T3_DEMO=1`: every turn plays a run of tool calls first, to look at the overlay by hand. */
const demo = process.env.FAKE_T3_DEMO === '1';
const server = await FakeT3Server.start({
    port,
    chunkDelayMs: 25,
    ...(demo ? { protocol: 2 as const, tools: DEMO_TOOLS } : {}),
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
