import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { ProviderInfo, ProviderMessage, ThreadSink, ThreadStep } from '@tencildev/protocol';
import { FakeCodexAppServer, type FakeCodexItem, waitFor } from '@tencildev/testing';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppServerProcess } from './app-server.ts';
import { CodexProvider, type CodexProviderOptions } from './codex-provider.ts';
import { NOT_INSTALLED } from './find-codex.ts';
import { codexProblem, listCodexProjects } from './projects.ts';

const PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
    while (cleanup.length) await cleanup.pop()?.();
});

const tmp = () => realpathSync.native(mkdtempSync(join(tmpdir(), 'tencil-codex-')));

/** A repository with the dev site in a subfolder, like a monorepo app. */
function repository(): { root: string; app: string } {
    const root = tmp();
    mkdirSync(join(root, '.git'));
    const app = join(root, 'apps', 'web');
    mkdirSync(app, { recursive: true });
    return { root, app };
}

function setup(options: Partial<CodexProviderOptions> = {}, codex = new FakeCodexAppServer()) {
    const { root, app } = repository();
    const create = (extra: Partial<CodexProviderOptions> = {}) => {
        const provider = new CodexProvider({
            projectRoot: app,
            spawn: () => codex.spawn() as unknown as AppServerProcess,
            ...options,
            ...extra,
        });
        cleanup.push(() => provider.dispose());
        return provider;
    };
    return { root, codex, provider: create(), create };
}

function recordingSink() {
    const messages = new Map<string, ProviderMessage>();
    const steps = new Map<string, ThreadStep>();
    const statuses: Array<{ status: string; detail?: string }> = [];
    let gone = false;
    const sink: ThreadSink = {
        message: message => messages.set(message.id, message),
        step: step => steps.set(step.id, step),
        status: (status, detail) => statuses.push({ status, detail }),
        gone: () => {
            gone = true;
        },
    };
    const reply = () =>
        waitFor(() => [...messages.values()].find(m => m.role === 'assistant' && !m.streaming), {
            message: 'final assistant message',
        });
    const lastStatus = () => statuses.at(-1)?.status;
    return { sink, messages, steps, statuses, reply, lastStatus, isGone: () => gone };
}

const newThread = (text = 'Tighten the hero', extra: { model?: string } = {}) => ({
    title: text,
    text,
    attachments: [],
    ...extra,
});

describe('Codex provider', () => {
    it('becomes ready, naming the repository the site is in', async () => {
        const { provider, root } = setup();
        await provider.start();
        expect(provider.info()).toMatchObject({
            id: 'codex',
            state: 'ready',
            target: basename(root),
        });
    });

    it('streams a turn onto the thread and names it, in the repository root', async () => {
        const { provider, codex, root } = setup();
        const { providerThreadId } = await provider.createThread(newThread());
        const { sink, messages, reply, lastStatus } = recordingSink();
        provider.watch(providerThreadId, sink);

        expect((await reply()).text).toBe('Done: Tighten the hero');
        await waitFor(() => lastStatus() === 'idle', { message: 'idle after the turn' });
        expect([...messages.values()].map(m => [m.role, m.text])).toEqual([
            ['user', 'Tighten the hero'],
            ['assistant', 'Done: Tighten the hero'],
        ]);
        const thread = codex.threads.get(providerThreadId);
        expect(thread).toMatchObject({ cwd: root, name: 'Tighten the hero' });
    });

    it('defaults to full access, because nobody is at a terminal', async () => {
        const { provider, codex } = setup();
        await provider.createThread(newThread());
        expect(codex.requestsOf('thread/start')[0]).toMatchObject({
            sandbox: 'danger-full-access',
            approvalPolicy: 'never',
        });
    });

    it('applies its permissions to new threads and to threads it resumes', async () => {
        const permissions = {
            sandbox: 'workspace-write',
            approvalPolicy: 'on-request',
            approvalsReviewer: 'auto_review',
        } as const;
        const { provider, codex, create } = setup({ permissions });
        const { providerThreadId } = await provider.createThread(newThread());
        expect(codex.requestsOf('thread/start')[0]).toMatchObject(permissions);
        await provider.dispose();

        await create().sendMessage({ providerThreadId, text: 'Again', attachments: [] });
        expect(codex.requestsOf('thread/resume')[0]).toMatchObject({
            threadId: providerThreadId,
            ...permissions,
        });
    });

    it('asks for summaries of its reasoning, the only way to get any', async () => {
        const { provider, codex } = setup();
        await provider.createThread(newThread());
        expect(codex.requestsOf('turn/start')[0]?.summary).toBe('concise');
    });

    it('sends images ahead of the text', async () => {
        const { provider, codex } = setup();
        await provider.createThread({
            ...newThread('Look at this'),
            attachments: [{ name: 'shot.png', dataUrl: PNG, mimeType: 'image/png' }],
        });
        expect(codex.requestsOf('turn/start')[0]?.input).toEqual([
            { type: 'image', url: PNG },
            { type: 'text', text: 'Look at this', text_elements: [] },
        ]);
    });

    it('reports tool calls and file changes as steps', async () => {
        const codex = new FakeCodexAppServer();
        codex.items = [
            {
                type: 'commandExecution',
                command: "/bin/zsh -lc 'pnpm test'",
                status: 'completed',
                commandActions: [{ type: 'unknown', command: 'pnpm test' }],
            },
            {
                type: 'commandExecution',
                command: "/bin/zsh -lc 'cat a.ts'",
                status: 'completed',
                commandActions: [
                    { type: 'read', command: 'cat a.ts', name: 'a.ts', path: '/repo/a.ts' },
                ],
            },
            {
                type: 'fileChange',
                status: 'completed',
                changes: [{ path: '/repo/src/hero.tsx', kind: { type: 'update' } }],
            },
            { type: 'mcpToolCall', server: 'docs', tool: 'search', status: 'failed' },
            { type: 'webSearch', query: 'container queries' },
            { type: 'reasoning', summary: ['**Weighing options**\n\nA long thought.'] },
            { type: 'commandExecution', command: 'rm -rf x', status: 'declined' },
        ] as FakeCodexItem[];
        const { provider } = setup({}, codex);
        const { providerThreadId } = await provider.createThread(newThread());
        const { sink, steps, reply } = recordingSink();
        provider.watch(providerThreadId, sink);
        await reply();

        expect(
            [...steps.values()].map(({ label, status, detail }) => ({ label, status, detail })),
        ).toEqual([
            { label: 'Ran pnpm test', status: 'done', detail: undefined },
            { label: 'Read a.ts', status: 'done', detail: undefined },
            { label: 'Edited hero.tsx', status: 'done', detail: undefined },
            { label: 'Using search', status: 'failed', detail: 'docs' },
            { label: 'Searched the web for container queries', status: 'done', detail: undefined },
            { label: 'Thought', status: 'done', detail: 'Weighing options' },
            {
                label: 'Running rm -rf x',
                status: 'failed',
                detail: 'Refused: it needs approval, and nobody is here to give it',
            },
        ]);
    });

    it('refuses what Codex asks to do, so an unattended turn never hangs', async () => {
        const codex = new FakeCodexAppServer();
        codex.requestApproval = [
            { method: 'item/commandExecution/requestApproval', params: { command: 'rm -rf /' } },
            { method: 'item/fileChange/requestApproval', params: { reason: 'write outside' } },
            { method: 'item/permissions/requestApproval', params: {} },
            { method: 'mcpServer/elicitation/request', params: {} },
            { method: 'something/new', params: {} },
        ];
        const logged: string[] = [];
        const { provider } = setup({ log: message => logged.push(message) }, codex);
        const { providerThreadId } = await provider.createThread(newThread());
        const { sink, reply } = recordingSink();
        provider.watch(providerThreadId, sink);
        await reply();

        expect(codex.answers).toEqual([
            { decision: 'decline' },
            { decision: 'decline' },
            { permissions: {}, scope: 'turn' },
            { action: 'decline', content: null, _meta: null },
            { error: expect.objectContaining({ code: -32601 }) },
        ]);
        expect(logged).toContain('Refused, nobody is here to approve it: rm -rf /');
    });

    it('interrupts the turn in progress and settles idle', async () => {
        const codex = new FakeCodexAppServer();
        codex.holdTurns = true;
        const { provider } = setup({}, codex);
        const { providerThreadId } = await provider.createThread(newThread());
        const { sink, messages, lastStatus } = recordingSink();
        provider.watch(providerThreadId, sink);
        await waitFor(() => lastStatus() === 'working', { message: 'working' });
        await waitFor(() => [...messages.values()].some(m => m.streaming), {
            message: 'first chunk',
        });

        await provider.interrupt(providerThreadId);
        await waitFor(() => lastStatus() === 'idle', { message: 'idle after the interrupt' });
        const partial = [...messages.values()].find(m => m.role === 'assistant');
        expect(partial?.streaming).toBe(false);
    });

    it('adds a message sent during a turn to that turn', async () => {
        const codex = new FakeCodexAppServer();
        codex.holdTurns = true;
        const { provider } = setup({}, codex);
        const { providerThreadId } = await provider.createThread(newThread());
        const { sink, reply, messages } = recordingSink();
        provider.watch(providerThreadId, sink);
        await waitFor(() => [...messages.values()].some(m => m.streaming), {
            message: 'first chunk',
        });

        await provider.sendMessage({
            providerThreadId,
            text: 'Also the footer',
            attachments: [],
        });
        codex.release();
        expect((await reply()).text).toBe('Done: Tighten the hero And: Also the footer');
        expect(codex.requestsOf('thread/resume')).toEqual([]);
    });

    it('resumes a thread after the idle process closed, with the same conversation', async () => {
        const codex = new FakeCodexAppServer();
        const { provider } = setup({ idleCloseMs: 10 }, codex);
        const { providerThreadId } = await provider.createThread(newThread());
        const { sink, reply, statuses, messages } = recordingSink();
        provider.watch(providerThreadId, sink);
        await reply();
        await waitFor(() => codex.alive === 0, { message: 'idle process closed' });
        expect(statuses.at(-1)?.status).toBe('idle');

        messages.clear();
        await provider.sendMessage({ providerThreadId, text: 'And again', attachments: [] });
        expect((await reply()).text).toBe('Done: And again');
        expect(codex.processes).toBe(2);
        expect(codex.requestsOf('thread/resume')).toHaveLength(1);
    });

    it('keeps the process while a turn runs, however long', async () => {
        const codex = new FakeCodexAppServer();
        codex.holdTurns = true;
        const { provider } = setup({ idleCloseMs: 5 }, codex);
        const { providerThreadId } = await provider.createThread(newThread());
        const { sink, reply } = recordingSink();
        provider.watch(providerThreadId, sink);
        await new Promise(resolve => setTimeout(resolve, 40));
        expect(codex.alive).toBe(1);
        codex.release();
        await reply();
    });

    it('keeps the process while a call waits on a slow Codex, however short the idle time', async () => {
        const codex = new FakeCodexAppServer();
        codex.answerDelayMs = 20;
        const { provider } = setup({ idleCloseMs: 5 }, codex);
        const { providerThreadId } = await provider.createThread(newThread());
        const { sink, reply } = recordingSink();
        provider.watch(providerThreadId, sink);
        expect((await reply()).text).toBe('Done: Tighten the hero');
        expect(codex.processes).toBe(1);
    });

    it('replays a thread from Codex after a restart, with ids that line up', async () => {
        const codex = new FakeCodexAppServer();
        const { provider, create } = setup({}, codex);
        const first = recordingSink();
        const { providerThreadId } = await provider.createThread(newThread());
        provider.watch(providerThreadId, first.sink);
        await first.reply();
        await waitFor(() => first.lastStatus() === 'idle', { message: 'idle' });
        await provider.dispose();

        const second = recordingSink();
        create().watch(providerThreadId, second.sink);
        await second.reply();
        expect([...second.messages.keys()]).toEqual([...first.messages.keys()]);
        expect(second.messages.get([...first.messages.keys()][0]!)?.text).toBe('Tighten the hero');
        await waitFor(() => second.lastStatus() === 'idle', { message: 'replayed as idle' });
    });

    it('reads the whole thread when Codex has no paginated history for it', async () => {
        const { provider, codex, root } = setup();
        const thread = codex.addThread({
            cwd: root,
            legacy: true,
            items: [
                {
                    turnId: 't1',
                    startedAtMs: 5_000,
                    item: {
                        type: 'userMessage',
                        id: 'u1',
                        content: [{ type: 'text', text: 'From before' }],
                    },
                },
                {
                    turnId: 't1',
                    startedAtMs: 5_000,
                    item: { type: 'agentMessage', id: 'a1', text: 'Long ago' },
                },
            ],
        });
        const { sink, messages, reply } = recordingSink();
        provider.watch(thread.id, sink);
        await reply();
        expect([...messages.values()].map(m => [m.id, m.text, m.createdAt])).toEqual([
            ['u1', 'From before', new Date(5_000).toISOString()],
            ['a1', 'Long ago', new Date(5_000).toISOString()],
        ]);
    });

    it('reports a thread Codex no longer has as gone', async () => {
        const { provider } = setup();
        const { sink, isGone } = recordingSink();
        provider.watch('no-such-thread', sink);
        await waitFor(isGone, { message: 'gone' });
    });

    it('reports a failed turn on the pin', async () => {
        const codex = new FakeCodexAppServer();
        codex.failNextTurn = {
            message: 'Usage limit reached',
            codexErrorInfo: 'usageLimitExceeded',
        };
        const { provider } = setup({}, codex);
        const { providerThreadId } = await provider.createThread(newThread());
        const { sink, statuses, lastStatus } = recordingSink();
        provider.watch(providerThreadId, sink);
        await waitFor(() => lastStatus() === 'error', { message: 'error status' });
        expect(statuses.at(-1)?.detail).toBe('Usage limit reached');
        expect(provider.info().state).not.toBe('unauthorized');
    });

    it('asks for a login when a turn finds the session has lapsed', async () => {
        const codex = new FakeCodexAppServer();
        codex.failNextTurn = {
            message: 'Unauthorized',
            codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 401 } },
        };
        const { provider } = setup({ recheckMs: 60_000 }, codex);
        await provider.createThread(newThread());
        await waitFor(() => provider.info().state === 'unauthorized', {
            message: 'unauthorized',
        });
        expect(provider.info().detail).toContain('codex login');
    });

    it('reports an error when Codex dies mid-turn, and carries on with a new process', async () => {
        const codex = new FakeCodexAppServer();
        codex.crashNextTurn = true;
        const { provider } = setup({}, codex);
        const { providerThreadId } = await provider.createThread(newThread());
        const { sink, statuses, lastStatus, reply, messages } = recordingSink();
        provider.watch(providerThreadId, sink);
        await waitFor(() => lastStatus() === 'error', { message: 'error status' });
        expect(statuses.at(-1)?.detail).toBe('Codex stopped before the turn finished');

        messages.clear();
        await provider.sendMessage({ providerThreadId, text: 'Try again', attachments: [] });
        expect((await reply()).text).toBe('Done: Try again');
    });

    it('reports a turn Codex refused to start, instead of working forever', async () => {
        const { provider, codex } = setup();
        const { providerThreadId } = await provider.createThread(newThread());
        const { sink, reply, lastStatus } = recordingSink();
        provider.watch(providerThreadId, sink);
        await reply();
        codex.threads.delete(providerThreadId);

        await expect(
            provider.sendMessage({ providerThreadId, text: 'Again', attachments: [] }),
        ).rejects.toThrow('thread not found');
        expect(lastStatus()).toBe('error');
    });

    describe('availability', () => {
        it('says how to sign in, and notices the login', async () => {
            const codex = new FakeCodexAppServer();
            codex.account = null;
            const { provider } = setup({ recheckMs: 5 }, codex);
            const infos: ProviderInfo[] = [];
            provider.onInfoChange(info => infos.push(info));
            await provider.start();
            expect(provider.info()).toMatchObject({
                state: 'unauthorized',
                detail: 'Codex is not signed in. Run `codex login`.',
            });

            codex.account = { type: 'chatgpt' };
            await waitFor(() => provider.info().state === 'ready', { message: 'ready' });
            expect(infos.map(info => info.state)).toEqual(['unauthorized', 'ready']);
        });

        it('says what stops it starting, and notices Codex once it is there', async () => {
            const codex = new FakeCodexAppServer();
            let installed = false;
            const { provider } = setup({
                recheckMs: 5,
                spawn: () => {
                    if (!installed) throw new Error(NOT_INSTALLED);
                    return codex.spawn() as unknown as AppServerProcess;
                },
            });
            await provider.start();
            expect(provider.info()).toMatchObject({
                state: 'unavailable',
                detail: NOT_INSTALLED,
            });
            expect(codex.processes).toBe(0);

            installed = true;
            await waitFor(() => provider.info().state === 'ready', { message: 'ready' });
        });

        it('reports why a Codex too old to serve this fails to start', async () => {
            const { root } = repository();
            const windows = process.platform === 'win32';
            // A space in the path, as under C:\Users\First Last, and on Windows npm's kind of shim.
            const folder = join(root, 'old codex');
            mkdirSync(folder);
            const old = join(folder, windows ? 'codex.cmd' : 'codex');
            writeFileSync(
                old,
                windows
                    ? `@echo error: unrecognized subcommand 'app-server' 1>&2\r\n@exit /b 2\r\n`
                    : `#!/bin/sh\necho "error: unrecognized subcommand 'app-server'" >&2\nexit 2\n`,
            );
            chmodSync(old, 0o755);
            const { provider } = setup({ spawn: undefined, command: old, recheckMs: 60_000 });
            await provider.start();
            expect(provider.info()).toMatchObject({ state: 'unavailable' });
            expect(provider.info().detail).toContain('unrecognized subcommand');
        });

        it('reports a binary that cannot be started', async () => {
            const { provider } = setup({
                spawn: undefined,
                command: join(tmp(), 'missing'),
                recheckMs: 60_000,
            });
            await provider.start();
            expect(provider.info().state).toBe('unavailable');
        });

        it('closes the process it started on dispose', async () => {
            const { provider, codex } = setup();
            await provider.start();
            expect(codex.alive).toBe(1);
            await provider.dispose();
            await waitFor(() => codex.alive === 0, { message: 'process closed' });
        });
    });

    describe('threads and models', () => {
        it("lists the project's threads, newest first, with their name or first line", async () => {
            const { provider, codex, root } = setup();
            codex.addThread({
                cwd: root,
                name: 'Named',
                updatedAt: 200,
                branch: 'main',
                items: [],
            });
            codex.addThread({
                cwd: root,
                preview: 'First line\n\n<tencil-context>…',
                updatedAt: 100,
                items: [{ turnId: 't', item: { type: 'userMessage' }, startedAtMs: 1 }],
            });
            codex.addThread({ cwd: '/elsewhere', name: 'Other project', updatedAt: 300 });

            const { project, threads } = await provider.listThreads();
            expect(project.name).toBe(basename(root));
            expect(threads).toMatchObject([
                { title: 'Named', branch: 'main', agent: 'codex', status: 'idle' },
                { title: 'First line', agent: 'codex' },
            ]);
            expect(threads[0]?.updatedAt).toBe(new Date(200_000).toISOString());
        });

        it("lists visible models and Codex's default", async () => {
            const { provider } = setup();
            const { models, defaultModel } = await provider.listModels();
            expect(models.map(model => model.id)).toEqual(['gpt-test', 'gpt-test-mini']);
            expect(models[0]).toEqual({
                id: 'gpt-test',
                label: 'GPT Test',
                group: 'Codex',
                agent: 'codex',
            });
            expect(defaultModel).toBe('gpt-test');
        });

        it('takes the default from the config, and offers it even if Codex lists no such model', async () => {
            const codex = new FakeCodexAppServer();
            codex.configModel = 'my-local-model';
            const { provider } = setup({}, codex);
            const { models, defaultModel } = await provider.listModels();
            expect(defaultModel).toBe('my-local-model');
            expect(models[0]?.id).toBe('my-local-model');
        });

        it('puts --model ahead of the config', async () => {
            const codex = new FakeCodexAppServer();
            codex.configModel = 'gpt-test-mini';
            const { provider } = setup({ model: 'gpt-test' }, codex);
            expect((await provider.listModels()).defaultModel).toBe('gpt-test');
        });

        it('starts a thread on the picked model, else --model, else names none', async () => {
            const { provider, codex, create } = setup();
            await provider.createThread(newThread('Picked', { model: 'gpt-test-mini' }));
            await provider.createThread(newThread('Unknown', { model: 'gpt-removed' }));
            await provider.createThread(newThread('None'));
            await create({ model: 'gpt-test' }).createThread(newThread('Flag'));
            expect(codex.requestsOf('thread/start').map(params => params.model)).toEqual([
                'gpt-test-mini',
                undefined,
                undefined,
                'gpt-test',
            ]);
        });
    });

    describe('one-shot helpers', () => {
        const spawnOf = (codex: FakeCodexAppServer) => () =>
            codex.spawn() as unknown as AppServerProcess;

        it('lists the folders Codex has threads in that still exist, once each', async () => {
            const codex = new FakeCodexAppServer();
            const folder = tmp();
            codex.addThread({ cwd: folder, name: 'One', updatedAt: 3 });
            codex.addThread({ cwd: folder, name: 'Two', updatedAt: 2 });
            codex.addThread({ cwd: join(folder, 'deleted'), name: 'Three', updatedAt: 1 });
            expect(await listCodexProjects({ spawn: spawnOf(codex) })).toEqual([
                { workspaceRoot: folder, title: basename(folder) },
            ]);
            await waitFor(() => codex.alive === 0, { message: 'closed after use' });
        });

        it('says what stops Codex running pins', async () => {
            const codex = new FakeCodexAppServer();
            expect(await codexProblem({ spawn: spawnOf(codex) })).toBeUndefined();
            codex.account = null;
            expect(await codexProblem({ spawn: spawnOf(codex) })).toContain('codex login');
            expect(await codexProblem({ command: join(tmp(), 'missing') })).toContain('ENOENT');
        });
    });
});
