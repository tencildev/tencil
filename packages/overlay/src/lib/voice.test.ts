import { describe, expect, it } from 'vitest';
import { encodeWav, insertText, toBase64 } from './voice.ts';

describe('the WAV a clip is sent as', () => {
    it('is 16-bit mono PCM at the given rate', () => {
        const wav = encodeWav(new Float32Array([0, 1, -1, 2]), 16_000);
        const view = new DataView(wav.buffer);
        const text = (offset: number) => String.fromCharCode(...wav.subarray(offset, offset + 4));
        expect(text(0)).toBe('RIFF');
        expect(text(8)).toBe('WAVE');
        expect(view.getUint16(22, true)).toBe(1);
        expect(view.getUint32(24, true)).toBe(16_000);
        expect(view.getUint16(34, true)).toBe(16);
        expect(view.getUint32(40, true)).toBe(8);
        // Out-of-range samples are clipped.
        expect([0, 1, 2, 3].map(i => view.getInt16(44 + i * 2, true))).toEqual([
            0, 32767, -32768, 32767,
        ]);
    });

    it('survives base64 for long clips', () => {
        const bytes = new Uint8Array(200_000).map((_, i) => i % 256);
        const decoded = Uint8Array.from(atob(toBase64(bytes)), c => c.charCodeAt(0));
        expect(decoded).toEqual(bytes);
    });
});

describe('dictated text', () => {
    it('goes at the end of an empty or finished prompt', () => {
        expect(insertText('', 'Make it blue')).toEqual({ value: 'Make it blue', caret: 12 });
        expect(insertText('Hi', 'there').value).toBe('Hi there');
        expect(insertText('Hi ', 'there').value).toBe('Hi there');
    });

    it('replaces the selection, spaced from the words around it', () => {
        const result = insertText('Make it red now', 'blue', { start: 8, end: 11 });
        expect(result.value).toBe('Make it blue now');
        expect(result.caret).toBe(12);
        expect(insertText('ab', 'x', { start: 1, end: 1 }).value).toBe('a x b');
    });
});
