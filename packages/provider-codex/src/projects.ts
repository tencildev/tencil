import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { AppServer, errorMessage, type SpawnAppServer } from './app-server.ts';
import { appServerSpawner } from './find-codex.ts';
import type { AccountRead, CodexThread, Page } from './protocol.ts';
import { NOT_SIGNED_IN } from './transcript.ts';

export interface CodexProjectSummary {
    workspaceRoot: string;
    title: string;
}

interface OneShotOptions {
    command?: string;
    /** Replaces starting `codex app-server` (tests). */
    spawn?: SpawnAppServer;
}

/** Run one thing against a Codex process of its own. */
async function withServer<T>(
    options: OneShotOptions,
    use: (server: AppServer) => Promise<T>,
): Promise<T> {
    const server = new AppServer(appServerSpawner(options)(), {
        notification: () => {},
        request: method => {
            throw new Error(`Tencil doesn't handle ${method}`);
        },
        closed: () => {},
        log: () => {},
    });
    try {
        await server.initialize('0.0.0');
        return await use(server);
    } finally {
        server.close();
    }
}

/** Folders Codex has threads in that still exist, most recently used first. */
export async function listCodexProjects(
    options: OneShotOptions = {},
): Promise<CodexProjectSummary[]> {
    const { data } = await withServer(options, server =>
        server.request<Page<CodexThread>>('thread/list', {
            sortKey: 'updated_at',
            limit: 100,
            useStateDbOnly: true,
        }),
    );
    const folders = new Set(data.map(thread => thread.cwd));
    return [...folders]
        .filter(folder => existsSync(folder))
        .map(folder => ({ workspaceRoot: folder, title: basename(folder) }));
}

/** What stops Codex running pins on this machine, in a sentence for setup; nothing if all's well. */
export async function codexProblem(options: OneShotOptions = {}): Promise<string | undefined> {
    try {
        const { account, requiresOpenaiAuth } = await withServer(options, server =>
            server.request<AccountRead>('account/read', {}),
        );
        return !account && requiresOpenaiAuth ? NOT_SIGNED_IN : undefined;
    } catch (error) {
        return errorMessage(error);
    }
}
