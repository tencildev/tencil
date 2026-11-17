import { accessSync, constants, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import { type SpawnAgent, spawnAgent } from './connection.ts';

/** An agent that speaks ACP over stdio, and the command line that starts it that way. */
export interface AcpAgent {
    /** The provider id, e.g. `devin`, which `--provider` and project settings use. */
    id: string;
    label: string;
    /** E.g. `devin acp --model opus`. Quote a part with spaces. */
    command: string;
    /** Where to get it, for when it isn't installed. */
    website?: string;
    /** How to sign in, for when it says it isn't. Otherwise the agent's own words are used. */
    login?: string;
}

/**
 * Agents Tencil knows how to start, with the commands the ACP registry
 * (agentclientprotocol.com/registry) lists for them. Each runs under the
 * user's own install and login; Tencil installs none of them.
 */
export const ACP_PRESETS: readonly AcpAgent[] = [
    {
        id: 'devin',
        label: 'Devin',
        command: 'devin acp',
        website: 'https://docs.devin.ai/cli',
        login: 'Run `devin auth login`, or set WINDSURF_API_KEY.',
    },
    {
        id: 'gemini',
        label: 'Gemini CLI',
        command: 'gemini --acp',
        website: 'https://geminicli.com',
    },
    {
        id: 'copilot',
        label: 'GitHub Copilot',
        command: 'copilot --acp',
        website: 'https://github.com/features/copilot/cli',
    },
    {
        id: 'cursor',
        label: 'Cursor',
        command: 'cursor-agent acp',
        website: 'https://cursor.com/cli',
    },
    { id: 'opencode', label: 'OpenCode', command: 'opencode acp', website: 'https://opencode.ai' },
    { id: 'goose', label: 'goose', command: 'goose acp', website: 'https://block.github.io/goose' },
];

export interface FindOptions {
    env?: Record<string, string | undefined>;
    platform?: NodeJS.Platform;
}

/**
 * A command line as its parts, the way a shell splits it: spaces separate,
 * quotes group, and outside Windows a backslash escapes the next character.
 */
export function splitCommandLine(line: string, platform = process.platform): string[] {
    const parts: string[] = [];
    let current = '';
    let started = false;
    let quote: '"' | "'" | undefined;
    for (let index = 0; index < line.length; index++) {
        const char = line[index] as string;
        if (quote) {
            if (char === quote) quote = undefined;
            else if (char === '\\' && quote === '"' && /["\\]/.test(line[index + 1] ?? '')) {
                current += line[++index];
            } else current += char;
        } else if (char === '"' || char === "'") {
            quote = char;
            started = true;
        } else if (/\s/.test(char)) {
            if (started) parts.push(current);
            current = '';
            started = false;
        } else if (char === '\\' && platform !== 'win32' && index + 1 < line.length) {
            current += line[++index];
            started = true;
        } else {
            current += char;
            started = true;
        }
    }
    if (quote) throw new Error(`Unclosed ${quote} in \`${line}\``);
    if (started) parts.push(current);
    return parts;
}

/** The program a command starts, found the way a shell would: a path, or on the PATH. */
export function findProgram(program: string, options: FindOptions = {}): string | undefined {
    const platform = options.platform ?? process.platform;
    const env = options.env ?? process.env;
    const expanded = program.startsWith('~/') ? join(homedir(), program.slice(2)) : program;
    const extensions = platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : [''];
    const withExtensions = (path: string) => extensions.map(extension => path + extension);
    if (isAbsolute(expanded) || /[\\/]/.test(expanded)) {
        return withExtensions(expanded).find(isExecutable);
    }
    return (env.PATH ?? '')
        .split(platform === 'win32' ? ';' : delimiter)
        .filter(Boolean)
        .flatMap(dir => withExtensions(join(dir, expanded)))
        .find(isExecutable);
}

/** Whether this machine can start the agent: its program is on the PATH, or where its command says. */
export function isInstalled(agent: AcpAgent, options: FindOptions = {}): boolean {
    try {
        const [program] = splitCommandLine(agent.command, options.platform);
        return program !== undefined && findProgram(program, options) !== undefined;
    } catch {
        return false;
    }
}

export function notInstalled(agent: AcpAgent, program: string): string {
    const where = agent.website ? ` Get it from ${agent.website}.` : '';
    return `${agent.label} isn't installed: there's no \`${program}\` on the PATH.${where}`;
}

/** How to start the agent. Throws, saying how to fix it, when this machine can't. */
export function agentSpawner(
    agent: AcpAgent,
    options: FindOptions & { spawn?: SpawnAgent } = {},
): SpawnAgent {
    if (options.spawn) return options.spawn;
    const [program, ...args] = splitCommandLine(agent.command, options.platform);
    if (!program) throw new Error(`${agent.label} has no command to start it with`);
    const path = findProgram(program, options);
    if (!path) throw new Error(notInstalled(agent, program));
    return cwd => spawnAgent(path, args, cwd);
}

function isExecutable(path: string): boolean {
    try {
        accessSync(path, constants.X_OK);
        return statSync(path).isFile();
    } catch {
        return false;
    }
}
