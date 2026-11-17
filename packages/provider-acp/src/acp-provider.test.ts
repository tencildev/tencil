import {
    chmodSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { ProviderInfo, ProviderMessage, ThreadSink, ThreadStep } from '@tencildev/protocol';
import { FakeAcpAgent, waitFor } from '@tencildev/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { AcpProvider, type AcpProviderOptions } from './acp-provider.ts';
import type { AcpAgent } from './agents.ts';
import { checkAgent } from './check-agent.ts';
import type { AgentProcess } from './connection.ts';
import type { AgentModels, ModelCache } from './models.ts';

const PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const AGENT: AcpAgent = {
    id: 'fake',
    label: 'Fake',
    command: 'fake-acp',
    website: 'https://example.com/fake',
};

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
    while (cleanup.length) await cleanup.pop()?.();
});

const tmp = () => realpathSync.native(mkdtempSync(join(tmpdir(), 'tencil-acp-')));

/** A repository with the dev site in a subfolder, like a monorepo app. */
function repository(): { root: string; app: string } {
    const root = tmp();
    mkdirSync(join(root, '.git'));
    const app = join(root, 'apps', 'web');
    mkdirSync(app, { recursive: true });
    return { root, app };
}

function setup(options: Partial<AcpProviderOptions> = {}, fake = new FakeAcpAgent()) {
    const { root, app } = repository();
    const create = (extra: Partial<AcpProviderOptions> = {}) => {
        const provider = new AcpProvider({
            agent: AGENT,
            projectRoot: app,
            spawn: cwd => fake.spawn(cwd) as unknown as AgentProcess,
            ...options,
            ...extra,
        });
        cleanup.push(() => provider.dispose());
        return provider;
    };
    return { root, fake, provider: create(), create };
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
    const replies = () => [...messages.values()].filter(m => m.role === 'assistant');
    const reply = (text?: string) =>
        waitFor(
            () =>
                replies().find(m => !m.streaming && (text === undefined || m.text === text)) &&
                statuses.at(-1)?.status === 'idle' &&
                replies().find(m => !m.streaming && (text === undefined || m.text === text)),
            { message: `final assistant message${text ? ` "${text}"` : ''}` },
        );
    const lastStatus = () => statuses.at(-1)?.status;
    return { sink, messages, steps, statuses, reply, lastStatus, isGone: () => gone };
}

const newThread = (text = 'Tighten the hero') => ({ title: text, text, attachments: [] });

describe('ACP provider', () => {
    it('becomes ready, naming the repository the site is in', async () => {
        const { provider, root, fake } = setup();
        await provider.start();
        expect(provider.info()).toMatchObject({
            id: 'fake',
            label: 'Fake',
            state: 'ready',
            target: basename(root),
        });
        // Started in the checkout, which agents read their config from.
        expect(fake.started).toEqual([root]);
        expect(fake.requestsOf('initialize')[0]).toMatchObject({
            protocolVersion: 1,
            clientCapabilities: {
                fs: { readTextFile: true, writeTextFile: true },
                terminal: false,
            },
        });
    });

    it('streams a turn onto the session it starts in the repository root', async () => {
        const { provider, fake, root } = setup();
        const { providerThreadId } = await provider.createThread(newThread());
        const { sink, messages, reply } = recordingSink();
        provider.watch(providerThreadId, sink);

        expect((await reply()).text).toBe('Done: Tighten the hero');
        expect([...messages.values()].map(m => [m.role, m.text])).toEqual([
            ['user', 'Tighten the hero'],
            ['assistant', 'Done: Tighten the hero'],
        ]);
        expect(fake.requestsOf('session/new')[0]).toEqual({ cwd: root, mcpServers: [] });
        expect(fake.sessions.get(providerThreadId)?.cwd).toBe(root);
    });

    it('sends follow-ups to the same session', async () => {
        const { provider, fake } = setup();
        const { providerThreadId } = await provider.createThread(newThread());
        const { sink, reply, messages } = recordingSink();
        provider.watch(providerThreadId, sink);
        await reply();

        await provider.sendMessage({ providerThreadId, text: 'And the footer', attachments: [] });
        await reply('Done: And the footer');
        expect(fake.requestsOf('session/prompt').map(params => params.sessionId)).toEqual([
            providerThreadId,
            providerThreadId,
        ]);
        expect(fake.requestsOf('session/new')).toHaveLength(1);
        expect([...messages.values()].map(m => m.text)).toEqual([
            'Tighten the hero',
            'Done: Tighten the hero',
            'And the footer',
            'Done: And the footer',
        ]);
    });

    it('sends images ahead of the text when the agent takes them', async () => {
        const { provider, fake } = setup();
        await provider.createThread({
            ...newThread('Look at this'),
            attachments: [{ name: 'shot.png', dataUrl: PNG, mimeType: 'image/png' }],
        });
        await waitFor(() => fake.requestsOf('session/prompt').length === 1, { message: 'prompt' });
        expect(fake.requestsOf('session/prompt')[0]?.prompt).toEqual([
            { type: 'image', mimeType: 'image/png', data: PNG.split(',')[1] },
            { type: 'text', text: 'Look at this' },
        ]);
    });

    it('sends the text alone to an agent that takes no images', async () => {
        const fake = new FakeAcpAgent();
        fake.capabilities.image = false;
        const { provider } = setup({}, fake);
        await provider.createThread({
            ...newThread('Look at this'),
            attachments: [{ name: 'shot.png', dataUrl: PNG, mimeType: 'image/png' }],
        });
        await waitFor(() => fake.requestsOf('session/prompt').length === 1, { message: 'prompt' });
        expect(fake.requestsOf('session/prompt')[0]?.prompt).toEqual([
            { type: 'text', text: 'Look at this' },
        ]);
    });

    it('shows tool calls, thoughts and the plan as steps, and the reply around them', async () => {
        const fake = new FakeAcpAgent();
        const { provider, root } = setup({}, fake);
        fake.updates = [
            {
                sessionUpdate: 'agent_thought_chunk',
                content: { type: 'text', text: '**Finding the hero**\n\nIt is in' },
            },
            { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: ' src.' } },
            {
                sessionUpdate: 'agent_message_chunk',
                content: { type: 'text', text: 'Looking.' },
            },
            {
                sessionUpdate: 'plan',
                entries: [
                    { content: 'Find the hero', priority: 'high', status: 'completed' },
                    { content: 'Tighten it', priority: 'high', status: 'in_progress' },
                ],
            },
            {
                sessionUpdate: 'tool_call',
                toolCallId: 'read-1',
                title: 'Read `src/hero.tsx`',
                kind: 'read',
                status: 'pending',
            },
            { sessionUpdate: 'tool_call_update', toolCallId: 'read-1', status: 'completed' },
            {
                sessionUpdate: 'tool_call',
                toolCallId: 'edit-1',
                title: 'Edit',
                kind: 'edit',
                status: 'in_progress',
                locations: [{ path: join(root, 'src', 'hero.tsx') }],
            },
            { sessionUpdate: 'tool_call_update', toolCallId: 'edit-1', status: 'completed' },
            {
                sessionUpdate: 'tool_call',
                toolCallId: 'run-1',
                title: '`pnpm test`',
                kind: 'execute',
                status: 'in_progress',
            },
            {
                sessionUpdate: 'tool_call_update',
                toolCallId: 'run-1',
                status: 'failed',
                content: [{ type: 'content', content: { type: 'text', text: '1 test failed\n…' } }],
            },
        ];
        const { providerThreadId } = await provider.createThread(newThread());
        const { sink, steps, reply } = recordingSink();
        provider.watch(providerThreadId, sink);

        expect((await reply()).text).toBe('Looking.\n\nDone: Tighten the hero');
        expect(
            [...steps.values()].map(({ label, status, detail }) => ({ label, status, detail })),
        ).toEqual([
            { label: 'Thought', status: 'done', detail: 'Finding the hero' },
            { label: 'Plan: 1 of 2 done', status: 'skipped', detail: 'Tighten it' },
            { label: 'Read src/hero.tsx', status: 'done', detail: undefined },
            { label: 'Edit hero.tsx', status: 'done', detail: undefined },
            { label: 'pnpm test', status: 'failed', detail: '1 test failed' },
        ]);
    });

    it('ignores an agent echoing the prompt back while it runs', async () => {
        const fake = new FakeAcpAgent();
        fake.echoPrompts = true;
        const { provider } = setup({}, fake);
        const { providerThreadId } = await provider.createThread(newThread());
        const { sink, messages, reply } = recordingSink();
        provider.watch(providerThreadId, sink);
        await reply();
        expect([...messages.values()].map(m => m.text)).toEqual([
            'Tighten the hero',
            'Done: Tighten the hero',
        ]);
    });

    it('interrupts the turn in progress and settles idle', async () => {
        const fake = new FakeAcpAgent();
        fake.holdTurns = true;
        const { provider } = setup({}, fake);
        const { providerThreadId } = await provider.createThread(newThread());
        const { sink, messages, lastStatus } = recordingSink();
        provider.watch(providerThreadId, sink);
        await waitFor(() => [...messages.values()].some(m => m.streaming), {
            message: 'first chunk',
        });
        expect(lastStatus()).toBe('working');

        await provider.interrupt(providerThreadId);
        await waitFor(() => lastStatus() === 'idle', { message: 'idle after the interrupt' });
        expect(fake.requestsOf('session/cancel')).toEqual([{ sessionId: providerThreadId }]);
        const partial = [...messages.values()].find(m => m.role === 'assistant');
        expect(partial).toMatchObject({ text: 'Done: Tight', streaming: false });
    });

    it('sends a message written during a turn once that turn ends', async () => {
        const fake = new FakeAcpAgent();
        fake.holdTurns = true;
        const { provider } = setup({}, fake);
        const { providerThreadId } = await provider.createThread(newThread());
        const { sink, messages, statuses, reply } = recordingSink();
        provider.watch(providerThreadId, sink);
        await waitFor(() => [...messages.values()].some(m => m.streaming), {
            message: 'first chunk',
        });

        await provider.sendMessage({ providerThreadId, text: 'Also the footer', attachments: [] });
        expect(fake.requestsOf('session/prompt')).toHaveLength(1);
        fake.holdTurns = false;
        fake.release();
        await reply('Done: Also the footer');
        expect(fake.requestsOf('session/prompt')).toHaveLength(2);
        // Working throughout: the first turn's end doesn't flash the pin done.
        expect(statuses.slice(0, -1).every(s => s.status === 'working')).toBe(true);
    });

    it('answers permission requests by the permission level, and refuses unknown requests', async () => {
        const toolCall = (kind: string) => ({ toolCallId: kind, title: `Do ${kind}`, kind });
        const options = [
            { optionId: 'always', name: 'Always', kind: 'allow_always' },
            { optionId: 'once', name: 'Allow', kind: 'allow_once' },
            { optionId: 'no', name: 'Reject', kind: 'reject_once' },
        ];
        const answers = async (permissions?: AcpProviderOptions['permissions']) => {
            const fake = new FakeAcpAgent();
            fake.ask = [
                ...['read', 'edit', 'execute'].map(kind => ({
                    method: 'session/request_permission',
                    params: { toolCall: toolCall(kind), options },
                })),
                {
                    method: 'session/request_permission',
                    params: { toolCall: toolCall('fetch'), options: [] },
                },
                { method: 'terminal/create', params: { command: 'ls' } },
            ];
            const { provider } = setup({ permissions }, fake);
            const { providerThreadId } = await provider.createThread(newThread());
            const { sink, reply } = recordingSink();
            provider.watch(providerThreadId, sink);
            await reply();
            return fake.answers.map(answer => {
                const { outcome, error } = answer as {
                    outcome?: { outcome: string; optionId?: string };
                    error?: { code: number };
                };
                return outcome ? (outcome.optionId ?? outcome.outcome) : error?.code;
            });
        };

        expect(await answers()).toEqual(['once', 'once', 'once', 'cancelled', -32601]);
        expect(await answers('edits')).toEqual(['once', 'once', 'no', 'cancelled', -32601]);
        expect(await answers('read-only')).toEqual(['once', 'no', 'no', 'cancelled', -32601]);
    });

    it('reads and writes files for the agent, and refuses writes when read-only', async () => {
        const fake = new FakeAcpAgent();
        const folder = tmp();
        const file = join(folder, 'nested', 'a.txt');
        fake.ask = [
            { method: 'fs/write_text_file', params: { path: file, content: 'one\ntwo\nthree' } },
            { method: 'fs/read_text_file', params: { path: file } },
            { method: 'fs/read_text_file', params: { path: file, line: 2, limit: 1 } },
            { method: 'fs/read_text_file', params: { path: 'relative.txt' } },
        ];
        const { provider } = setup({}, fake);
        const { providerThreadId } = await provider.createThread(newThread());
        const { sink, reply } = recordingSink();
        provider.watch(providerThreadId, sink);
        await reply();
        expect(readFileSync(file, 'utf8')).toBe('one\ntwo\nthree');
        expect(fake.answers).toEqual([
            {},
            { content: 'one\ntwo\nthree' },
            { content: 'two' },
            { error: expect.objectContaining({ code: -32602 }) },
        ]);

        const readOnly = new FakeAcpAgent();
        readOnly.ask = [{ method: 'fs/write_text_file', params: { path: file, content: 'x' } }];
        const second = setup({ permissions: 'read-only' }, readOnly).provider;
        const thread = await second.createThread(newThread());
        const recorder = recordingSink();
        second.watch(thread.providerThreadId, recorder.sink);
        await recorder.reply();
        expect(readOnly.answers).toEqual([{ error: expect.objectContaining({ code: -32603 }) }]);
        expect(readFileSync(file, 'utf8')).toBe('one\ntwo\nthree');
    });

    it('reports a turn that ended early as an error', async () => {
        const fake = new FakeAcpAgent();
        fake.stopNextPrompt = 'max_tokens';
        const { provider } = setup({}, fake);
        const { providerThreadId } = await provider.createThread(newThread());
        const { sink, statuses, lastStatus } = recordingSink();
        provider.watch(providerThreadId, sink);
        await waitFor(() => lastStatus() === 'error', { message: 'error status' });
        expect(statuses.at(-1)?.detail).toBe('Fake reached its output limit before it finished');
    });

    it('reports a failed prompt on the pin', async () => {
        const fake = new FakeAcpAgent();
        fake.failNextPrompt = { code: -32603, message: 'Model overloaded' };
        const { provider } = setup({}, fake);
        const { providerThreadId } = await provider.createThread(newThread());
        const { sink, statuses, lastStatus } = recordingSink();
        provider.watch(providerThreadId, sink);
        await waitFor(() => lastStatus() === 'error', { message: 'error status' });
        expect(statuses.at(-1)?.detail).toBe('Model overloaded');
    });

    it('reports an error when the agent dies mid-turn, and carries on with a new process', async () => {
        const fake = new FakeAcpAgent();
        fake.crashNextPrompt = true;
        const logged: string[] = [];
        const { provider } = setup({ log: message => logged.push(message) }, fake);
        const { providerThreadId } = await provider.createThread(newThread());
        const { sink, statuses, lastStatus, reply } = recordingSink();
        provider.watch(providerThreadId, sink);
        await waitFor(() => lastStatus() === 'error', { message: 'error status' });
        expect(statuses.at(-1)?.detail).toBe('Fake stopped before the turn finished');
        expect(logged).toContain('Fake stopped: fake agent crashed');

        await provider.sendMessage({ providerThreadId, text: 'Try again', attachments: [] });
        await reply('Done: Try again');
        expect(fake.processes).toBe(2);
        expect(fake.requestsOf('session/load')).toHaveLength(1);
    });

    describe('models', () => {
        const PICKLE = { value: 'opencode/big-pickle', name: 'Big Pickle' };
        const SOL = { value: 'openai/gpt-6.1-sol', name: 'GPT-6.1 Sol' };

        function withModels() {
            const fake = new FakeAcpAgent();
            fake.models = { choices: [PICKLE, SOL], defaultModel: PICKLE.value };
            return fake;
        }

        async function runThread(provider: AcpProvider, model?: string) {
            const { providerThreadId } = await provider.createThread({ ...newThread(), model });
            const { sink, reply } = recordingSink();
            provider.watch(providerThreadId, sink);
            await reply();
            return providerThreadId;
        }

        const listed = (model: { value: string; name: string }, group = 'Fake') => ({
            id: model.value,
            label: model.name,
            group,
            agent: 'fake',
        });

        it("lists none until a session names them, then the agent's models and default", async () => {
            const fake = withModels();
            const { provider } = setup({}, fake);
            expect(await provider.listModels()).toEqual({ models: [] });

            await runThread(provider);
            expect(await provider.listModels()).toEqual({
                models: [listed(PICKLE), listed(SOL)],
                defaultModel: PICKLE.value,
            });
            expect(fake.requestsOf('session/set_config_option')).toEqual([]);
        });

        it('puts a new session on the picked model before its first prompt', async () => {
            const fake = withModels();
            const { provider } = setup({}, fake);
            const sessionId = await runThread(provider, SOL.value);

            expect(fake.sessions.get(sessionId)?.model).toBe(SOL.value);
            expect(fake.requestsOf('session/set_config_option')).toEqual([
                { sessionId, configId: 'model', value: SOL.value },
            ]);
            const methods = fake.requests.map(request => request.method);
            expect(methods.indexOf('session/set_config_option')).toBeLessThan(
                methods.indexOf('session/prompt'),
            );
            // Picking a model for one pin doesn't change the agent's default.
            expect((await provider.listModels()).defaultModel).toBe(PICKLE.value);
        });

        it("stays on the default when the agent doesn't offer the picked model", async () => {
            const fake = withModels();
            const logged: string[] = [];
            const { provider } = setup({ log: message => logged.push(message) }, fake);
            const sessionId = await runThread(provider, 'gone/model');

            expect(fake.requestsOf('session/set_config_option')).toEqual([]);
            expect(fake.sessions.get(sessionId)?.model).toBe(PICKLE.value);
            expect(logged).toContain("Fake doesn't offer gone/model here; it runs on its default");
        });

        it('groups the models the way the agent does', async () => {
            const fake = new FakeAcpAgent();
            fake.models = {
                choices: [
                    {
                        group: 'anthropic',
                        name: 'Anthropic',
                        options: [{ value: 'a/opus', name: 'Opus' }],
                    },
                    { group: 'openai', name: 'OpenAI', options: [{ value: 'o/sol', name: 'Sol' }] },
                ],
                defaultModel: 'a/opus',
            };
            const { provider } = setup({}, fake);
            await runThread(provider);
            expect((await provider.listModels()).models).toEqual([
                listed({ value: 'a/opus', name: 'Opus' }, 'Anthropic'),
                listed({ value: 'o/sol', name: 'Sol' }, 'OpenAI'),
            ]);
        });

        it('follows a change to the list, keeping the default', async () => {
            const fake = withModels();
            const { provider } = setup({}, fake);
            await runThread(provider);

            const LUNA = { value: 'openai/gpt-6-luna', name: 'GPT-6 Luna' };
            fake.models = { choices: [PICKLE, SOL, LUNA], defaultModel: SOL.value };
            fake.announceModels();
            const models = await waitFor(
                async () => {
                    const list = await provider.listModels();
                    return list.models.length === 3 && list;
                },
                { message: 'the new list' },
            );
            expect(models.defaultModel).toBe(PICKLE.value);
        });

        it("learns them from a session it loads, without taking that session's model for the default", async () => {
            const fake = withModels();
            const { provider, create } = setup({}, fake);
            const sessionId = await runThread(provider, SOL.value);
            await provider.dispose();

            const restarted = create();
            const { sink, lastStatus } = recordingSink();
            restarted.watch(sessionId, sink);
            await waitFor(() => lastStatus() === 'idle', { message: 'replayed' });
            expect(await restarted.listModels()).toEqual({
                models: [listed(PICKLE), listed(SOL)],
            });
        });

        it('keeps them for other projects and the next start, through the cache', async () => {
            const fake = withModels();
            const saved: AgentModels[] = [];
            const models: ModelCache = { get: async () => saved.at(-1), set: m => saved.push(m) };
            const { provider, create } = setup({ models }, fake);
            await runThread(provider);

            const other = create();
            expect(await other.listModels()).toEqual(await provider.listModels());
            expect(fake.processes).toBe(1);
        });
    });

    describe('after a restart', () => {
        it('replays a session with the ids the pin already has, then continues it', async () => {
            const fake = new FakeAcpAgent();
            const { provider, create } = setup({}, fake);
            const first = recordingSink();
            const { providerThreadId } = await provider.createThread(newThread());
            provider.watch(providerThreadId, first.sink);
            await first.reply();
            await provider.dispose();

            const second = recordingSink();
            const restarted = create();
            restarted.watch(providerThreadId, second.sink);
            await waitFor(() => second.lastStatus() === 'idle', { message: 'replayed as idle' });
            expect([...second.messages.values()].map(m => [m.id, m.text])).toEqual(
                [...first.messages.values()].map(m => [m.id, m.text]),
            );
            // The times it was first seen at aren't known after a restart, but the order is.
            const [user, assistant] = [...second.messages.values()];
            expect(user!.createdAt < assistant!.createdAt).toBe(true);

            await restarted.sendMessage({ providerThreadId, text: 'Again', attachments: [] });
            await second.reply('Done: Again');
            expect(fake.requestsOf('session/load')).toHaveLength(1);
            expect(new Set(second.messages.keys()).size).toBe(4);
        });

        it('loads a session once when a follow-up comes during the replay', async () => {
            const fake = new FakeAcpAgent();
            const { provider, create } = setup({}, fake);
            const first = recordingSink();
            const { providerThreadId } = await provider.createThread(newThread());
            provider.watch(providerThreadId, first.sink);
            await first.reply();
            await provider.dispose();

            const second = recordingSink();
            const restarted = create();
            restarted.watch(providerThreadId, second.sink);
            await restarted.sendMessage({ providerThreadId, text: 'Again', attachments: [] });
            await second.reply('Done: Again');
            expect(fake.requestsOf('session/load')).toHaveLength(1);
        });

        it('resumes a session without a replay when the agent only resumes', async () => {
            const fake = new FakeAcpAgent();
            fake.capabilities = { ...fake.capabilities, loadSession: false, resume: true };
            const { provider, create } = setup({}, fake);
            const first = recordingSink();
            const { providerThreadId } = await provider.createThread(newThread());
            provider.watch(providerThreadId, first.sink);
            await first.reply();
            await provider.dispose();

            const second = recordingSink();
            const restarted = create();
            restarted.watch(providerThreadId, second.sink);
            await waitFor(() => second.lastStatus() === 'idle', { message: 'idle' });
            expect(second.messages.size).toBe(0);

            await restarted.sendMessage({ providerThreadId, text: 'Again', attachments: [] });
            await second.reply('Done: Again');
            expect(fake.requestsOf('session/resume')).toEqual([
                expect.objectContaining({ sessionId: providerThreadId }),
            ]);
            // New ids, so they can't overwrite the messages the pin kept.
            const before = new Set(first.messages.keys());
            expect([...second.messages.keys()].some(id => before.has(id))).toBe(false);
        });

        it('says clearly that an agent which can neither load nor resume cannot continue', async () => {
            const fake = new FakeAcpAgent();
            fake.capabilities = { ...fake.capabilities, loadSession: false, resume: false };
            const { provider, create } = setup({}, fake);
            const first = recordingSink();
            const { providerThreadId } = await provider.createThread(newThread());
            provider.watch(providerThreadId, first.sink);
            await first.reply();
            await provider.dispose();

            const second = recordingSink();
            const restarted = create();
            restarted.watch(providerThreadId, second.sink);
            await waitFor(() => second.lastStatus() === 'idle', { message: 'idle' });
            await expect(
                restarted.sendMessage({ providerThreadId, text: 'Again', attachments: [] }),
            ).rejects.toThrow("Fake can't pick up this conversation again");
            expect(second.statuses.at(-1)).toEqual({
                status: 'error',
                detail: "Fake can't pick up this conversation again: it can't load or resume sessions. Start a new pin to go on.",
            });
        });

        it('reports a session the agent no longer has as gone', async () => {
            const { provider } = setup();
            const { sink, isGone } = recordingSink();
            provider.watch('no-such-session', sink);
            await waitFor(isGone, { message: 'gone' });
        });
    });

    describe('the process', () => {
        it('closes when idle, and loads the session into the next one', async () => {
            const fake = new FakeAcpAgent();
            const { provider } = setup({ idleCloseMs: 10 }, fake);
            const { providerThreadId } = await provider.createThread(newThread());
            const { sink, reply } = recordingSink();
            provider.watch(providerThreadId, sink);
            await reply();
            await waitFor(() => fake.alive === 0, { message: 'idle process closed' });

            await provider.sendMessage({ providerThreadId, text: 'And again', attachments: [] });
            await reply('Done: And again');
            expect(fake.processes).toBe(2);
            expect(fake.requestsOf('session/load')).toHaveLength(1);
        });

        it('stays while a turn runs, however long', async () => {
            const fake = new FakeAcpAgent();
            fake.holdTurns = true;
            const { provider } = setup({ idleCloseMs: 5 }, fake);
            const { providerThreadId } = await provider.createThread(newThread());
            const { sink, reply } = recordingSink();
            provider.watch(providerThreadId, sink);
            await new Promise(resolve => setTimeout(resolve, 40));
            expect(fake.alive).toBe(1);
            fake.release();
            await reply();
        });

        it("stays when closing would strand sessions the agent can't take up again", async () => {
            const fake = new FakeAcpAgent();
            fake.capabilities = { ...fake.capabilities, loadSession: false, resume: false };
            const { provider } = setup({ idleCloseMs: 5 }, fake);
            const { providerThreadId } = await provider.createThread(newThread());
            const { sink, reply } = recordingSink();
            provider.watch(providerThreadId, sink);
            await reply();
            await new Promise(resolve => setTimeout(resolve, 40));
            expect(fake.alive).toBe(1);
        });

        it('closes the process it started on dispose', async () => {
            const { provider, fake } = setup();
            await provider.start();
            expect(fake.alive).toBe(1);
            await provider.dispose();
            await waitFor(() => fake.alive === 0, { message: 'process closed' });
        });
    });

    describe('availability', () => {
        it('says how to sign in when the agent wants a login, and tries again later', async () => {
            const fake = new FakeAcpAgent();
            fake.signedOut = true;
            const { provider } = setup({ recheckMs: 5 }, fake);
            const infos: ProviderInfo[] = [];
            provider.onInfoChange(info => infos.push(info));
            await provider.start();

            await expect(provider.createThread(newThread())).rejects.toThrow(
                'Fake is not signed in. Run `fake login`.',
            );
            await waitFor(() => provider.info().state === 'ready', { message: 'ready again' });
            expect(infos.map(info => info.state)).toEqual(['ready', 'unauthorized', 'ready']);
            expect(infos[1]?.detail).toBe('Fake is not signed in. Run `fake login`.');
        });

        it("prefers the preset's own sign-in hint", async () => {
            const fake = new FakeAcpAgent();
            fake.signedOut = true;
            const { provider } = setup(
                { agent: { ...AGENT, login: 'Run `fake auth login`, or set FAKE_KEY' } },
                fake,
            );
            await expect(provider.createThread(newThread())).rejects.toThrow(
                'Fake is not signed in. Run `fake auth login`, or set FAKE_KEY.',
            );
        });

        it('says where to get an agent that is not installed, and notices it once it is', async () => {
            const fake = new FakeAcpAgent();
            const bin = tmp();
            const { provider } = setup({
                spawn: undefined,
                recheckMs: 5,
                find: { env: { PATH: bin } },
            });
            await provider.start();
            expect(provider.info()).toMatchObject({
                state: 'unavailable',
                detail: "Fake isn't installed: there's no `fake-acp` on the PATH. Get it from https://example.com/fake.",
            });
            expect(fake.processes).toBe(0);
        });

        it('reports why an agent fails to start', async () => {
            const { root } = repository();
            const windows = process.platform === 'win32';
            // A space in the path, as under C:\Users\First Last, and on Windows npm's kind of shim.
            const folder = join(root, 'old agent');
            mkdirSync(folder);
            const old = join(folder, windows ? 'agent.cmd' : 'agent');
            writeFileSync(
                old,
                windows
                    ? `@echo error: unknown command 'acp' 1>&2\r\n@exit /b 2\r\n`
                    : `#!/bin/sh\necho "error: unknown command 'acp'" >&2\nexit 2\n`,
            );
            chmodSync(old, 0o755);
            const { provider } = setup({
                spawn: undefined,
                agent: { ...AGENT, command: `"${old}" acp` },
                recheckMs: 60_000,
            });
            await provider.start();
            expect(provider.info()).toMatchObject({ state: 'unavailable' });
            expect(provider.info().detail).toContain("unknown command 'acp'");
        });
    });

    describe('threads', () => {
        it("lists the agent's sessions in the project, newest first", async () => {
            const { provider, fake, root } = setup();
            fake.addSession({ cwd: root, title: 'Older', updatedAt: '2026-01-01T00:00:00.000Z' });
            fake.addSession({
                cwd: root,
                title: 'Newer\n\nmore',
                updatedAt: '2026-02-01T00:00:00.000Z',
            });
            fake.addSession({ cwd: '/elsewhere', title: 'Other project' });

            const { project, threads } = await provider.listThreads();
            expect(project.name).toBe(basename(root));
            expect(threads).toMatchObject([
                { title: 'Newer', status: 'idle', agent: 'fake' },
                { title: 'Older', updatedAt: '2026-01-01T00:00:00.000Z' },
            ]);
            expect(threads).toHaveLength(2);
        });

        it('lists none when the agent cannot list sessions', async () => {
            const fake = new FakeAcpAgent();
            fake.capabilities.list = false;
            const { provider, root } = setup({}, fake);
            fake.addSession({ cwd: root, title: 'Hidden' });
            expect((await provider.listThreads()).threads).toEqual([]);
        });

        it('opens a session started outside Tencil with its conversation', async () => {
            const { provider, fake, root } = setup();
            const session = fake.addSession({
                cwd: root,
                history: [
                    { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'Hi' } },
                    {
                        sessionUpdate: 'tool_call',
                        toolCallId: 't',
                        title: 'Read a.ts',
                        status: 'completed',
                    },
                    {
                        sessionUpdate: 'agent_message_chunk',
                        content: { type: 'text', text: 'Hello' },
                    },
                    {
                        sessionUpdate: 'agent_message_chunk',
                        content: { type: 'text', text: ' there' },
                    },
                ],
            });
            const { sink, messages, steps, lastStatus } = recordingSink();
            provider.watch(session.sessionId, sink);
            await waitFor(() => lastStatus() === 'idle', { message: 'replayed' });
            expect([...messages.values()].map(m => [m.role, m.text, m.streaming])).toEqual([
                ['user', 'Hi', false],
                ['assistant', 'Hello there', false],
            ]);
            // Steps of a past turn aren't shown again.
            expect(steps.size).toBe(0);
        });
    });

    describe('setup check', () => {
        it('names the agent when it answers, and says what is wrong when it does not', async () => {
            const fake = new FakeAcpAgent();
            const spawn = () => fake.spawn() as unknown as AgentProcess;
            expect(await checkAgent(AGENT, { spawn })).toEqual({ about: 'fake-acp 1.0.0' });
            await waitFor(() => fake.alive === 0, { message: 'closed after use' });
            expect(await checkAgent(AGENT, { env: { PATH: tmp() } })).toEqual({
                problem:
                    "Fake isn't installed: there's no `fake-acp` on the PATH. Get it from https://example.com/fake.",
            });
        });
    });
});
