import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bestModel, cleanTranscript, findWhisper, whisperTranscriber } from './whisper.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'tencil-whisper-'));

/** An executable shell script standing in for a Whisper command. */
function fakeCommand(dir: string, name: string, script: string): string {
    mkdirSync(dir, { recursive: true });
    const path = join(dir, name);
    writeFileSync(path, `#!/bin/sh\n${script}\n`);
    chmodSync(path, 0o755);
    return path;
}

function machine() {
    const home = tmp();
    const dataDir = join(home, '.config', 'tencil');
    const bin = join(home, 'bin');
    mkdirSync(bin, { recursive: true });
    const find = (env: Record<string, string> = {}, model?: string) =>
        findWhisper({ env: { PATH: bin, ...env }, home, dataDir, extraBins: [], model });
    return { home, dataDir, bin, find };
}

// The stand-in commands are shell scripts.
describe.skipIf(process.platform === 'win32')('finding Whisper', () => {
    it('finds nothing on a machine without it', () => {
        expect(machine().find()).toEqual({});
    });

    it("uses whisper.cpp with the best model in Tencil's folder", () => {
        const { dataDir, bin, find } = machine();
        const command = fakeCommand(bin, 'whisper-cli', 'exit 0');
        mkdirSync(join(dataDir, 'whisper'), { recursive: true });
        for (const name of ['ggml-tiny.bin', 'ggml-small.en.bin', 'notes.txt']) {
            writeFileSync(join(dataDir, 'whisper', name), '');
        }
        expect(find().whisper).toEqual({
            kind: 'whisper.cpp',
            command,
            model: join(dataDir, 'whisper', 'ggml-small.en.bin'),
        });
    });

    it('says what is missing when whisper.cpp has no model', () => {
        const { bin, find } = machine();
        fakeCommand(bin, 'whisper-cli', 'exit 0');
        const found = find();
        expect(found.whisper).toBeUndefined();
        expect(found.hint).toMatch(/needs a whisper\.cpp model/);
    });

    it('takes the model from settings, and from TENCIL_WHISPER_MODEL over that', () => {
        const { home, bin, find } = machine();
        fakeCommand(bin, 'whisper-cli', 'exit 0');
        const saved = join(home, 'saved.bin');
        const fromEnv = join(home, 'env.bin');
        writeFileSync(saved, '');
        writeFileSync(fromEnv, '');
        expect(find({}, saved).whisper).toMatchObject({ model: saved });
        expect(find({ TENCIL_WHISPER_MODEL: fromEnv }, saved).whisper).toMatchObject({
            model: fromEnv,
        });
        expect(find({}, join(home, 'gone.bin')).hint).toMatch(/isn't a file/);
    });

    it('falls back to openai-whisper, with a chosen model name', () => {
        const { bin, find } = machine();
        const command = fakeCommand(bin, 'whisper', 'exit 0');
        expect(find().whisper).toEqual({ kind: 'openai-whisper', command });
        expect(find({ TENCIL_WHISPER_MODEL: 'turbo' }).whisper).toEqual({
            kind: 'openai-whisper',
            command,
            model: 'turbo',
        });
    });

    it("skips the test models Homebrew's whisper.cpp ships", () => {
        const dir = tmp();
        writeFileSync(join(dir, 'for-tests-ggml-tiny.bin'), '');
        writeFileSync(join(dir, 'ggml-for-tests-tiny.bin'), '');
        expect(bestModel([dir])).toBeUndefined();
        writeFileSync(join(dir, 'ggml-medium.bin'), '');
        writeFileSync(join(dir, 'ggml-large-v3-turbo.bin'), '');
        expect(bestModel([dir])).toBe(join(dir, 'ggml-large-v3-turbo.bin'));
    });
});

describe.skipIf(process.platform === 'win32')('transcribing', () => {
    it('runs whisper.cpp on the clip and returns its text', async () => {
        const dir = tmp();
        // Prints its arguments' file, to show the clip reached it.
        const command = fakeCommand(
            dir,
            'whisper-cli',
            `while [ "$1" != "--file" ]; do shift; done
cat "$2" >/dev/null
printf '\\n Make the button blue.\\n [BLANK_AUDIO]\\n And bigger.\\n'`,
        );
        const transcribe = whisperTranscriber({ kind: 'whisper.cpp', command, model: 'm.bin' });
        expect(await transcribe(Buffer.from('RIFF'))).toBe('Make the button blue. And bigger.');
    });

    it("reads openai-whisper's text file", async () => {
        const dir = tmp();
        const command = fakeCommand(
            dir,
            'whisper',
            `while [ "$1" != "--output_dir" ]; do shift; done
printf 'Hallo wereld\\n' > "$2/clip.txt"`,
        );
        const transcribe = whisperTranscriber({ kind: 'openai-whisper', command });
        expect(await transcribe(Buffer.from('RIFF'))).toBe('Hallo wereld');
    });

    it('fails with what Whisper said', async () => {
        const command = fakeCommand(
            tmp(),
            'whisper-cli',
            'echo "failed to load model" >&2; exit 1',
        );
        const transcribe = whisperTranscriber({ kind: 'whisper.cpp', command, model: 'm.bin' });
        await expect(transcribe(Buffer.from('RIFF'))).rejects.toThrow(
            'whisper-cli failed: failed to load model',
        );
    });
});

describe('a transcript', () => {
    it("has no markers for what isn't speech", () => {
        expect(cleanTranscript(' (music)\n *sighs*\n Make it (much) wider [BLANK_AUDIO]\n')).toBe(
            'Make it (much) wider',
        );
    });
});
