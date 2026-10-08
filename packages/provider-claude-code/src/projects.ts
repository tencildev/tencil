import { basename } from 'node:path';
import { type AgentSdk, loadAgentSdk } from './load-sdk.ts';

export interface ClaudeCodeProjectSummary {
    workspaceRoot: string;
    title: string;
}

/** Folders Claude Code has sessions in, most recently used first. */
export async function listClaudeCodeProjects(options: {
    installDir: string;
    sdk?: AgentSdk;
}): Promise<ClaudeCodeProjectSummary[]> {
    const sdk = options.sdk ?? (await loadAgentSdk({ installDir: options.installDir }));
    const sessions = await sdk.listSessions({ includeProgrammatic: false });
    const seen = new Set<string>();
    const projects: ClaudeCodeProjectSummary[] = [];
    for (const session of sessions.sort((a, b) => b.lastModified - a.lastModified)) {
        if (!session.cwd || seen.has(session.cwd)) continue;
        seen.add(session.cwd);
        projects.push({ workspaceRoot: session.cwd, title: basename(session.cwd) });
    }
    return projects;
}
