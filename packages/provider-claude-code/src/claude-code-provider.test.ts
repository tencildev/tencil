import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProviderMessage, ThreadSink, ThreadStatus } from '@tencil/protocol';
import { FakeAgentSdk, waitFor } from '@tencil/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { ClaudeCodeProvider, type ClaudeCodeProviderOptions } from './claude-code-provider.ts';
import type { AgentSdk } from './load-sdk.ts';

const PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
    while (cleanup.length) await cleanup.pop()?.();
});

/** A repository with the dev site in a subfolder, like a monorepo app. */
function repository(): { root: string; app: string } {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'tencil-claude-')));
    mkdirSync(join(root, '.git'));
    const app = join(root, 'apps', 'web');
    mkdirSync(app, { recursive: true });
    return { root, app };
}

function setup(options: Partial<ClaudeCodeProviderOptions> = {}, sdk = new FakeAgentSdk()) {
    const { root, app } = repository();
    const create = () =>
        new ClaudeCodeProvider({
            projectRoot: app,
            installDir: join(root, 'sdk'),
            sdk: sdk as unknown as AgentSdk,
            ...options,
        });
    const provider = create();
    cleanup.push(() => provider.dispose());
    return { root, sdk, provider, create };
}

function recordingSink() {
    const messages = new Map<string, ProviderMessage>();
    const statuses: ThreadStatus[] = [];
    let gone = false;
    const sink: ThreadSink = {
        message: message => messages.set(message.id, message),
        status: status => statuses.push(status),
        gone: () => {
            gone = true;
        },
    };
    const reply = () =>
        waitFor(() => [...messages.values()].find(m => m.role === 'assistant' && !m.streaming), {
            message: 'final assistant message',
        });
    return { sink, messages, statuses, reply, isGone: () => gone };
}

describe('Claude Code provider', () => {
    it('is ready in the repository root', async () => {
        const { provider, root } = setup();
        await provider.start();
        expect(provider.info()).toMatchObject({
            state: 'ready',
            target: root.split(/[\\/]/).at(-1),
        });
    });

    it('starts a session and streams the reply back', async () => {
        const { provider, sdk, root } = setup({ model: 'claude-opus-5-5' });
        await provider.start();
        const created = await provider.createThread({
            title: 'Make it blue',
            text: 'Make the button blue',
            attachments: [{ name: 'shot.png', mimeType: 'image/png', dataUrl: PNG }],
        });
        expect(created.url).toBeUndefined();

        const { sink, messages, statuses, reply } = recordingSink();
        provider.watch(created.providerThreadId, sink);
        expect((await reply()).text).toBe('Done: Make the button blue');
        await waitFor(() => statuses.at(-1) === 'idle', { message: 'idle' });

        const user = [...messages.values()].find(m => m.role === 'user');
        expect(user?.text).toBe('Make the button blue');
        expect(sdk.queries[0]?.options).toMatchObject({
            sessionId: created.providerThreadId,
            title: 'Make it blue',
            cwd: root,
            model: 'claude-opus-5-5',
            includePartialMessages: true,
            permissionMode: 'bypassPermissions',
            permissionPrompts: 'none',
        });
        const sent = sdk.sessions.get(created.providerThreadId)?.entries[0] as {
            message: { content: Array<{ type: string; source?: { data: string } }> };
        };
        expect(sent.message.content[0]).toMatchObject({
            type: 'image',
            source: { data: PNG.split(',')[1] },
        });
    });

    it('streams partial text before the message completes', async () => {
        const sdk = new FakeAgentSdk();
        sdk.holdTurns = true;
        const { provider } = setup({}, sdk);
        const created = await provider.createThread({ title: 't', text: 'hello', attachments: [] });
        const { sink, messages, reply } = recordingSink();
        provider.watch(created.providerThreadId, sink);
        const partial = await waitFor(
            () => [...messages.values()].find(m => m.role === 'assistant' && m.streaming),
            { message: 'streaming message' },
        );
        expect(partial.text).toBe('Done: ');
        sdk.release();
        expect((await reply()).text).toBe('Done: hello');
    });

    it('continues the session with a follow-up', async () => {
        const { provider, sdk } = setup();
        const created = await provider.createThread({ title: 't', text: 'first', attachments: [] });
        const { sink, messages, reply } = recordingSink();
        provider.watch(created.providerThreadId, sink);
        await reply();

        await provider.sendMessage({
            providerThreadId: created.providerThreadId,
            text: 'second',
            attachments: [],
        });
        await waitFor(() => [...messages.values()].some(m => m.text === 'Done: second'), {
            message: 'second reply',
        });
        // Same process: the follow-up rides on the open input stream.
        expect(sdk.queries).toHaveLength(1);
    });

    it('resumes an idle session in a new process', async () => {
        const { provider, sdk } = setup({ idleCloseMs: 10 });
        const created = await provider.createThread({ title: 't', text: 'first', attachments: [] });
        const { sink, messages, reply } = recordingSink();
        provider.watch(created.providerThreadId, sink);
        await reply();
        await waitFor(() => sdk.queries[0]?.closed, { message: 'idle process closed' });

        await provider.sendMessage({
            providerThreadId: created.providerThreadId,
            text: 'second',
            attachments: [],
        });
        await waitFor(() => [...messages.values()].some(m => m.text === 'Done: second'), {
            message: 'second reply',
        });
        expect(sdk.queries[1]?.options).toMatchObject({ resume: created.providerThreadId });
    });

    it('interrupts a running turn', async () => {
        const sdk = new FakeAgentSdk();
        sdk.holdTurns = true;
        const { provider } = setup({}, sdk);
        const created = await provider.createThread({
            title: 't',
            text: 'long job',
            attachments: [],
        });
        const { sink, statuses, reply } = recordingSink();
        provider.watch(created.providerThreadId, sink);
        await waitFor(() => statuses.at(-1) === 'working', { message: 'working' });

        await provider.interrupt(created.providerThreadId);
        expect((await reply()).text).toBe('Done: l');
        await waitFor(() => statuses.at(-1) === 'idle', { message: 'idle after interrupt' });
        expect(statuses).not.toContain('error');
    });

    it('replays a session after a restart', async () => {
        const { provider, sdk, create } = setup();
        const created = await provider.createThread({ title: 't', text: 'first', attachments: [] });
        const live = recordingSink();
        provider.watch(created.providerThreadId, live.sink);
        await live.reply();
        await provider.dispose();

        const restarted = create();
        cleanup.push(() => restarted.dispose());
        const replay = recordingSink();
        restarted.watch(created.providerThreadId, replay.sink);
        await waitFor(() => replay.statuses.at(-1) === 'idle', { message: 'replayed status' });
        // Same ids as the live run, so the bridge doesn't show duplicates.
        expect([...replay.messages.keys()]).toEqual([...live.messages.keys()]);
        expect([...replay.messages.values()].map(m => m.text)).toEqual(['first', 'Done: first']);
        expect(sdk.queries).toHaveLength(1);
    });

    it('replays the conversation to every new watcher', async () => {
        const { provider } = setup();
        const created = await provider.createThread({ title: 't', text: 'first', attachments: [] });
        const first = recordingSink();
        provider.watch(created.providerThreadId, first.sink);
        await first.reply();

        const second = recordingSink();
        provider.watch(created.providerThreadId, second.sink);
        await waitFor(() => second.messages.size === 2, { message: 'snapshot' });
    });

    it('reports an error when Claude Code dies mid-turn', async () => {
        const sdk = new FakeAgentSdk();
        sdk.crashNextTurn = true;
        const { provider } = setup({}, sdk);
        const created = await provider.createThread({ title: 't', text: 'boom', attachments: [] });
        const { sink, statuses, messages } = recordingSink();
        provider.watch(created.providerThreadId, sink);
        await waitFor(() => statuses.at(-1) === 'error', { message: 'error status' });
        // What streamed before the crash stays, marked done.
        expect([...messages.values()].find(m => m.role === 'assistant')).toMatchObject({
            text: 'Done:',
            streaming: false,
        });
    });

    it('reports a session Claude Code no longer has as gone', async () => {
        const { provider } = setup();
        const { sink, isGone } = recordingSink();
        provider.watch('00000000-0000-4000-8000-000000000000', sink);
        await waitFor(() => isGone(), { message: 'gone' });
    });

    it("lists the repository's sessions, newest first", async () => {
        const { provider, sdk } = setup();
        const older = await provider.createThread({ title: 'Older', text: 'a', attachments: [] });
        const newer = await provider.createThread({ title: 'Newer', text: 'b', attachments: [] });
        await waitFor(() => sdk.sessions.get(newer.providerThreadId)?.entries.length === 2, {
            message: 'turns done',
        });
        sdk.sessions.get(newer.providerThreadId)!.updatedAt += 1_000;
        sdk.sessions.set('elsewhere', {
            id: 'elsewhere',
            dir: '/somewhere/else',
            entries: [],
            updatedAt: Date.now() + 5_000,
        });

        const { project, threads } = await provider.listThreads();
        expect(project.name).toMatch(/^tencil-claude-/);
        expect(threads.map(t => t.id)).toEqual([newer.providerThreadId, older.providerThreadId]);
        expect(threads[0]).toMatchObject({ title: 'Newer', branch: 'main', agent: 'claudeAgent' });
    });
});
