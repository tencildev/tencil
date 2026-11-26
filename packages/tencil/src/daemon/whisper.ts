import { execFile } from 'node:child_process';
import { accessSync, constants, readdirSync, statSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, delimiter, join } from 'node:path';
import { defaultDataDir } from './thread-store.ts';

/**
 * A Whisper install on this machine: whisper.cpp's `whisper-cli` with a ggml
 * model, or the `whisper` command from openai-whisper. Tencil never installs
 * either; voice input only shows up where one is set up.
 */
export type Whisper =
    | { kind: 'whisper.cpp'; command: string; model: string }
    | { kind: 'openai-whisper'; command: string; model?: string };

export interface FindWhisperOptions {
    /** The model saved in `settings.json`; `TENCIL_WHISPER_MODEL` wins over it. */
    model?: string;
    env?: Record<string, string | undefined>;
    home?: string;
    dataDir?: string;
    /** Folders searched besides the PATH; login services get a bare one. */
    extraBins?: string[];
}

export interface WhisperStatus {
    whisper?: Whisper;
    /** Why there's no voice input although part of Whisper is here. */
    hint?: string;
}

const WHISPER_CPP = ['whisper-cli', 'whisper-cpp'];
const executable = (name: string) => (process.platform === 'win32' ? `${name}.exe` : name);
/** Fast and good in most languages first; the test model Homebrew ships last of all. */
const MODEL_PREFERENCE = ['large-v3-turbo', 'small', 'base', 'medium', 'large-v3', 'large', 'tiny'];

/** Where whisper.cpp models are commonly kept, besides Tencil's own folder. */
export function modelFolders(home: string, dataDir: string): string[] {
    return [
        join(dataDir, 'whisper'),
        join(home, '.cache', 'whisper.cpp'),
        join(home, '.cache', 'whisper-cpp'),
        join(home, 'whisper.cpp', 'models'),
        '/opt/homebrew/share/whisper-cpp',
        '/usr/local/share/whisper-cpp',
    ];
}

/**
 * Finds Whisper. A chosen model (`whisperModel` in `settings.json`, or
 * `TENCIL_WHISPER_MODEL`) is a ggml file for whisper.cpp, or a model name
 * (`base`, `turbo`) for openai-whisper. Without one, whisper.cpp uses the best
 * model in the usual folders, and openai-whisper its own default.
 */
export function findWhisper(options: FindWhisperOptions = {}): WhisperStatus {
    const env = options.env ?? process.env;
    const home = options.home ?? homedir();
    const dataDir = options.dataDir ?? defaultDataDir();
    const bins = [
        ...(env.PATH ?? '').split(delimiter).filter(Boolean),
        ...(options.extraBins ?? ['/opt/homebrew/bin', '/usr/local/bin', join(home, '.local/bin')]),
    ];
    const chosen = env.TENCIL_WHISPER_MODEL?.trim() || options.model?.trim() || undefined;

    const cpp = findCommand(WHISPER_CPP.map(executable), bins);
    if (cpp) {
        const model = chosen && isFile(chosen) ? chosen : bestModel(modelFolders(home, dataDir));
        if (model) return { whisper: { kind: 'whisper.cpp', command: cpp, model } };
    }
    const python = findCommand([executable('whisper')], bins);
    if (python) {
        return {
            whisper: {
                kind: 'openai-whisper',
                command: python,
                ...(chosen && !chosen.includes('/') && { model: chosen }),
            },
        };
    }
    if (!cpp) return {};
    return {
        hint: chosen
            ? `Voice input needs a whisper.cpp model, and ${chosen} isn't a file.`
            : `Voice input needs a whisper.cpp model. Put a ggml-*.bin file in ${join(dataDir, 'whisper')}, or set whisperModel in ${join(dataDir, 'settings.json')} to one.`,
    };
}

function findCommand(names: string[], bins: string[]): string | undefined {
    for (const dir of bins) {
        for (const name of names) {
            const path = join(dir, name);
            try {
                accessSync(path, constants.X_OK);
                if (statSync(path).isFile()) return path;
            } catch {
                // Not here.
            }
        }
    }
    return undefined;
}

function isFile(path: string): boolean {
    try {
        return statSync(path).isFile();
    } catch {
        return false;
    }
}

/** The preferred ggml model in these folders, skipping the test models whisper.cpp ships. */
export function bestModel(folders: string[]): string | undefined {
    const models = folders.flatMap(folder => {
        try {
            return readdirSync(folder)
                .filter(name => /^ggml-.+\.bin$/.test(name) && !name.includes('for-tests'))
                .map(name => join(folder, name));
        } catch {
            return [];
        }
    });
    const rank = (path: string) => {
        const name = basename(path, '.bin').replace(/^ggml-/, '');
        const index = MODEL_PREFERENCE.findIndex(
            preferred => name === preferred || name.startsWith(`${preferred}.`),
        );
        return index === -1 ? MODEL_PREFERENCE.length : index;
    };
    return models.sort((a, b) => rank(a) - rank(b))[0];
}

export type Transcribe = (wav: Buffer) => Promise<string>;

/** The longest a transcription may take; a first openai-whisper run downloads its model. */
const TIMEOUT_MS = 5 * 60_000;

/** Runs Whisper on a WAV clip and returns what was said. */
export function whisperTranscriber(whisper: Whisper): Transcribe {
    return async wav => {
        const dir = await mkdtemp(join(tmpdir(), 'tencil-voice-'));
        try {
            const file = join(dir, 'clip.wav');
            await writeFile(file, wav);
            if (whisper.kind === 'whisper.cpp') {
                const output = await run(whisper.command, [
                    '--model',
                    whisper.model,
                    '--file',
                    file,
                    '--language',
                    'auto',
                    '--no-timestamps',
                    '--no-prints',
                ]);
                return cleanTranscript(output);
            }
            await run(whisper.command, [
                file,
                ...(whisper.model ? ['--model', whisper.model] : []),
                '--output_format',
                'txt',
                '--output_dir',
                dir,
                '--verbose',
                'False',
                '--fp16',
                'False',
            ]);
            return cleanTranscript(await readFile(join(dir, 'clip.txt'), 'utf8'));
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    };
}

function run(command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(
            command,
            args,
            { timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
            (error, stdout, stderr) => {
                if (!error) return resolve(stdout);
                const detail = stderr.trim().split('\n').at(-1);
                reject(
                    new Error(
                        `${basename(command)} failed${detail ? `: ${detail}` : ` (${error.message})`}`,
                    ),
                );
            },
        );
    });
}

/**
 * One line of text, without the markers Whisper writes for what isn't speech:
 * `[BLANK_AUDIO]` anywhere, and lines that are only `(music)` or `*sighs*`.
 */
export function cleanTranscript(output: string): string {
    return output
        .split('\n')
        .filter(line => !/^\s*(\(.*\)|\*.*\*)\s*$/.test(line))
        .join(' ')
        .replace(/\[[^\]]*\]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
