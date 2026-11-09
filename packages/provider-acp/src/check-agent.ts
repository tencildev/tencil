import { tmpdir } from 'node:os';
import { type AcpAgent, agentSpawner, type FindOptions } from './agents.ts';
import { AgentConnection, errorMessage, type SpawnAgent } from './connection.ts';

export interface AgentCheck {
    /** What stops the agent running pins, in a sentence for setup. */
    problem?: string;
    /** The name and version it gave, e.g. `OpenCode 1.17.11`. */
    about?: string;
}

/**
 * Start the agent once and shake hands, for setup. ACP has no way to ask
 * whether the agent is signed in short of starting a session, so a missing
 * login only shows on the first pin.
 */
export async function checkAgent(
    agent: AcpAgent,
    options: FindOptions & { spawn?: SpawnAgent; cwd?: string } = {},
): Promise<AgentCheck> {
    let connection: AgentConnection | undefined;
    try {
        const spawn = agentSpawner(agent, options);
        connection = new AgentConnection(agent.label, spawn(options.cwd ?? tmpdir()), {
            notification: () => {},
            request: method => {
                throw new Error(`Tencil doesn't handle ${method}`);
            },
            closed: () => {},
            log: () => {},
        });
        const { agentInfo } = await connection.initialize('0.0.0');
        return agentInfo ? { about: `${agentInfo.name} ${agentInfo.version}` } : {};
    } catch (error) {
        return { problem: errorMessage(error) };
    } finally {
        connection?.close();
    }
}
