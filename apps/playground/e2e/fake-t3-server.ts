import { FakeT3Server } from '@tencil/testing';

/** Fake T3 Code for the browser tests; Playwright starts this as a web server. */
const port = Number(process.env.FAKE_T3_PORT ?? 47390);
const server = await FakeT3Server.start({
    port,
    chunkDelayMs: 25,
    reply: text =>
        `Updated it.\n\n- Changed **${text.split('\n')[0]?.slice(0, 40)}**\n- Kept the rest as is`,
});
console.log(`Fake T3 Code listening on ${server.url}`);
process.on('SIGTERM', () => void server.close().then(() => process.exit(0)));
