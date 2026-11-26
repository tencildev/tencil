/** Whisper works on 16 kHz mono audio; converting here keeps ffmpeg off the machine. */
export const SAMPLE_RATE = 16_000;
/** Longer clips stop by themselves; the daemon takes about two minutes at most. */
export const MAX_RECORDING_MS = 115_000;

export interface Recording {
    /** Stops and returns the clip as base64 WAV, or undefined when nothing was recorded. */
    stop(): Promise<string | undefined>;
    /** Stops and throws the clip away. */
    cancel(): void;
    /** How loud the microphone is right now, from 0 to 1, for a level meter. */
    level(): number;
}

/** Can this page record? Needs a secure page (localhost counts) and MediaRecorder. */
export function canRecord(): boolean {
    return (
        typeof MediaRecorder !== 'undefined' &&
        typeof navigator !== 'undefined' &&
        typeof navigator.mediaDevices?.getUserMedia === 'function'
    );
}

/**
 * Starts recording from the microphone. The browser asks for permission on the
 * page's own address the first time. `onLimit` runs when the clip hits the limit.
 */
export async function startRecording(onLimit: () => void): Promise<Recording> {
    let stream: MediaStream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
        throw new Error(microphoneError(error));
    }
    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    recorder.addEventListener('dataavailable', event => {
        if (event.data.size > 0) chunks.push(event.data);
    });
    const stopped = new Promise<void>(resolve =>
        recorder.addEventListener('stop', () => resolve(), { once: true }),
    );
    const limit = setTimeout(onLimit, MAX_RECORDING_MS);
    const meter = levelMeter(stream);
    const finish = async () => {
        clearTimeout(limit);
        meter.close();
        if (recorder.state !== 'inactive') recorder.stop();
        await stopped;
        for (const track of stream.getTracks()) track.stop();
    };
    recorder.start();
    return {
        async stop() {
            await finish();
            if (chunks.length === 0) return undefined;
            const blob = new Blob(chunks, { type: recorder.mimeType });
            const samples = await toMono16k(await blob.arrayBuffer());
            return samples.length === 0 ? undefined : toBase64(encodeWav(samples, SAMPLE_RATE));
        },
        cancel() {
            void finish();
        },
        level: meter.level,
    };
}

/** Loudness of the stream, read on demand; silent where Web Audio isn't available. */
function levelMeter(stream: MediaStream): { level: () => number; close: () => void } {
    try {
        const context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        context.createMediaStreamSource(stream).connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        return {
            level: () => {
                analyser.getFloatTimeDomainData(samples);
                let sum = 0;
                for (const sample of samples) sum += sample * sample;
                // Speech sits around 0.02–0.2 RMS; stretch that over the meter.
                return Math.min(1, Math.sqrt(sum / samples.length) * 6);
            },
            close: () => void context.close(),
        };
    } catch {
        return { level: () => 0, close: () => {} };
    }
}

function microphoneError(error: unknown): string {
    const name = error instanceof DOMException ? error.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
        return 'Microphone blocked. Allow it for this site in the address bar.';
    }
    if (name === 'NotFoundError') return 'No microphone found.';
    return error instanceof Error ? error.message : String(error);
}

/** Decodes what MediaRecorder made (WebM, MP4) and resamples it to 16 kHz mono. */
async function toMono16k(data: ArrayBuffer): Promise<Float32Array> {
    const context = new AudioContext();
    let decoded: AudioBuffer;
    try {
        decoded = await context.decodeAudioData(data);
    } finally {
        void context.close();
    }
    const length = Math.ceil(decoded.duration * SAMPLE_RATE);
    if (length === 0) return new Float32Array(0);
    const offline = new OfflineAudioContext(1, length, SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    return (await offline.startRendering()).getChannelData(0);
}

/** 16-bit PCM WAV of mono samples in [-1, 1]. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
    const bytes = new Uint8Array(44 + samples.length * 2);
    const view = new DataView(bytes.buffer);
    const text = (offset: number, value: string) => {
        for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
    };
    text(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    text(8, 'WAVE');
    text(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    text(36, 'data');
    view.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) {
        const sample = Math.max(-1, Math.min(1, samples[i] ?? 0));
        view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }
    return bytes;
}

export function toBase64(bytes: Uint8Array): string {
    let binary = '';
    // In slices: spreading megabytes into one call overflows the stack.
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
}

/** Puts dictated text where the caret is, with a space on either side where needed. */
export function insertText(
    value: string,
    text: string,
    selection: { start: number; end: number } = { start: value.length, end: value.length },
): { value: string; caret: number } {
    const before = value.slice(0, selection.start);
    const after = value.slice(selection.end);
    const lead = before.length > 0 && !/\s$/.test(before) ? ' ' : '';
    const trail = after.length > 0 && !/^\s/.test(after) ? ' ' : '';
    const inserted = `${lead}${text}${trail}`;
    return { value: before + inserted + after, caret: before.length + lead.length + text.length };
}
