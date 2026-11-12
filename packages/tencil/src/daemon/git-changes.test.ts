import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GitChanges } from './git-changes.ts';

const BASE = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/** A repository with one commit of `app.txt` (ten lines) and `other.txt`. */
function repo() {
    const root = mkdtempSync(join(tmpdir(), 'tencil-git-'));
    const run = (...args: string[]) =>
        execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trimEnd();
    run('init', '--quiet', '--initial-branch=main');
    run('config', 'user.name', 'Test');
    run('config', 'user.email', 'test@example.com');
    run('config', 'commit.gpgsign', 'false');
    // Windows runners set autocrlf, which writes reverted files with CRLF.
    run('config', 'core.autocrlf', 'false');
    const write = (file: string, text: string) => {
        mkdirSync(dirname(join(root, file)), { recursive: true });
        writeFileSync(join(root, file), text);
    };
    const read = (file: string) => readFileSync(join(root, file), 'utf8');
    const lines = (changes: Record<number, string>) =>
        `${BASE.map((line, index) => changes[index] ?? line).join('\n')}\n`;
    write('app.txt', lines({}));
    write('other.txt', 'other\n');
    run('add', '--all');
    run('commit', '--quiet', '-m', 'Initial');
    return { root, run, write, read, lines, changes: new GitChanges(root) };
}

describe('GitChanges', () => {
    it('has no snapshots outside a Git repository', async () => {
        const root = mkdtempSync(join(tmpdir(), 'tencil-nogit-'));
        expect(await new GitChanges(root).snapshot()).toBeUndefined();
        rmSync(root, { recursive: true });
    });

    it('lists the files a turn changed, new ones included, and leaves the index alone', async () => {
        const { run, write, changes } = repo();
        write('other.txt', 'staged by me\n');
        run('add', 'other.txt');
        const from = (await changes.snapshot())!;
        write('app.txt', 'changed\n');
        write('src/new.txt', 'new\n');
        const to = (await changes.snapshot())!;

        expect(await changes.files([{ from, to }])).toEqual(['app.txt', 'src/new.txt']);
        expect(run('diff', '--cached', '--name-only')).toBe('other.txt');
        expect(run('status', '--porcelain', '--untracked-files=all')).toBe(
            ' M app.txt\nM  other.txt\n?? src/new.txt',
        );
    });

    it('reads HEAD, to tell when the agent committed', async () => {
        const { run, write, changes } = repo();
        expect(await changes.head()).toBe(run('rev-parse', 'HEAD'));
        write('app.txt', 'committed by the agent\n');
        run('commit', '--quiet', '-am', 'By the agent');
        expect(await changes.head()).toBe(run('rev-parse', 'HEAD'));

        const empty = mkdtempSync(join(tmpdir(), 'tencil-git-'));
        execFileSync('git', ['init', '--quiet'], { cwd: empty });
        expect(await new GitChanges(empty).head()).toBeUndefined();
    });

    it("reverts a pin's turns without the edits made in between", async () => {
        const { write, read, lines, changes } = repo();
        const first = (await changes.snapshot())!;
        write('app.txt', lines({ 1: 'agent 1' }));
        const second = (await changes.snapshot())!;
        // Someone else's edit between the turns.
        write('app.txt', lines({ 1: 'agent 1', 5: 'between' }));
        const third = (await changes.snapshot())!;
        write('app.txt', lines({ 1: 'agent 1', 5: 'between', 9: 'agent 2' }));
        const fourth = (await changes.snapshot())!;

        await changes.revert([
            { from: first, to: second },
            { from: third, to: fourth },
        ]);

        expect(read('app.txt')).toBe(lines({ 5: 'between' }));
    });

    it("reverts the agent's edits and keeps everyone else's", async () => {
        const { run, write, read, lines, changes } = repo();
        write('app.txt', lines({ 0: 'mine' }));
        const from = (await changes.snapshot())!;
        write('app.txt', lines({ 0: 'mine', 8: 'agent' }));
        write('src/new.txt', 'from the agent\n');
        const to = (await changes.snapshot())!;
        // Edited after the agent, elsewhere in the file.
        write('app.txt', lines({ 0: 'mine', 4: 'later', 8: 'agent' }));

        await changes.revert([{ from, to }]);

        expect(read('app.txt')).toBe(lines({ 0: 'mine', 4: 'later' }));
        expect(run('status', '--porcelain', '--untracked-files=all')).toBe(' M app.txt');
    });

    it("leaves the work tree alone when the agent's lines changed since", async () => {
        const { write, read, lines, changes } = repo();
        const from = (await changes.snapshot())!;
        write('app.txt', lines({ 2: 'agent' }));
        write('other.txt', 'agent too\n');
        const to = (await changes.snapshot())!;
        write('app.txt', lines({ 2: 'agent, then me' }));

        await expect(changes.revert([{ from, to }])).rejects.toThrow(
            /lines in app\.txt changed since/,
        );
        expect(read('app.txt')).toBe(lines({ 2: 'agent, then me' }));
        expect(read('other.txt')).toBe('agent too\n');
    });
});
