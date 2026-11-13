import { chmodSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACP_PRESETS, agentSpawner, findProgram, isInstalled, splitCommandLine } from './agents.ts';

const tmp = () => realpathSync.native(mkdtempSync(join(tmpdir(), 'tencil-acp-bin-')));

/** An executable `name` in a folder of its own. */
function program(name: string): { dir: string; path: string } {
    const dir = tmp();
    const path = join(dir, name);
    writeFileSync(path, '#!/bin/sh\n');
    chmodSync(path, 0o755);
    return { dir, path };
}

describe('command lines', () => {
    it('splits on spaces and keeps quoted parts together', () => {
        expect(splitCommandLine('devin acp --model opus')).toEqual([
            'devin',
            'acp',
            '--model',
            'opus',
        ]);
        expect(splitCommandLine(`  "/Apps/My Agent/agent"   --flag 'a b' "" `)).toEqual([
            '/Apps/My Agent/agent',
            '--flag',
            'a b',
            '',
        ]);
        expect(splitCommandLine('agent --name "say \\"hi\\""')).toEqual([
            'agent',
            '--name',
            'say "hi"',
        ]);
    });

    it('escapes with a backslash, except on Windows where it separates folders', () => {
        expect(splitCommandLine('/my\\ agent acp', 'darwin')).toEqual(['/my agent', 'acp']);
        expect(splitCommandLine('C:\\Tools\\agent.exe acp', 'win32')).toEqual([
            'C:\\Tools\\agent.exe',
            'acp',
        ]);
    });

    it('refuses an unclosed quote', () => {
        expect(() => splitCommandLine('agent "acp')).toThrow('Unclosed "');
    });
});

describe('finding agents', () => {
    it('finds a program on the PATH, or at the path the command gives', () => {
        const { dir, path } = program('fake-acp');
        expect(findProgram('fake-acp', { env: { PATH: dir } })).toBe(path);
        expect(findProgram(path, { env: { PATH: '' } })).toBe(path);
        expect(findProgram('fake-acp', { env: { PATH: tmp() } })).toBeUndefined();
    });

    it('knows which presets are installed', () => {
        const { dir } = program('opencode');
        const installed = ACP_PRESETS.filter(agent => isInstalled(agent, { env: { PATH: dir } }));
        expect(installed.map(agent => agent.id)).toEqual(['opencode']);
    });

    it('starts each preset the way the ACP registry says to', () => {
        expect(Object.fromEntries(ACP_PRESETS.map(agent => [agent.id, agent.command]))).toEqual({
            devin: 'devin acp',
            gemini: 'gemini --acp',
            copilot: 'copilot --acp',
            cursor: 'cursor-agent acp',
            opencode: 'opencode acp',
            goose: 'goose acp',
        });
    });

    it('says how to get an agent that is missing', () => {
        const devin = ACP_PRESETS.find(agent => agent.id === 'devin')!;
        expect(() => agentSpawner(devin, { env: { PATH: tmp() } })).toThrow(
            "Devin isn't installed: there's no `devin` on the PATH. Get it from https://docs.devin.ai/cli.",
        );
    });
});
