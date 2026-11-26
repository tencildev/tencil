import { useEffect, useRef, useState } from 'preact/hooks';
import type { Recording } from '../lib/voice.ts';
import { Shimmer } from './shimmer.tsx';

const BARS = 5;

/**
 * What dictation is doing, inside the prompt box: a live level meter and the
 * time while recording, then a shimmer while Whisper writes it down.
 */
export function DictationStatus({
    state,
    recording,
}: {
    state: 'recording' | 'transcribing';
    recording: { current: Recording | null };
}) {
    return (
        <div class={`dictation dictation-${state}`} role="status">
            {state === 'recording' ? (
                <>
                    <span class="dictation-dot" aria-hidden="true" />
                    <LevelMeter recording={recording} />
                    <Elapsed />
                    <span class="dictation-hint">Esc to discard</span>
                </>
            ) : (
                <Shimmer text="Transcribing…" />
            )}
        </div>
    );
}

/** Bars that follow the microphone, set straight on the DOM every frame. */
function LevelMeter({ recording }: { recording: { current: Recording | null } }) {
    const bars = useRef<HTMLSpanElement>(null);
    useEffect(() => {
        let frame = 0;
        // Each bar reacts a little differently, so it reads as a voice, not a block.
        const weights = [0.55, 0.85, 1, 0.75, 0.5];
        const heights = new Array<number>(BARS).fill(0);
        const tick = () => {
            const level = recording.current?.level() ?? 0;
            const children = bars.current?.children ?? [];
            for (let i = 0; i < BARS; i++) {
                const target = level * (weights[i] ?? 1);
                // Rise fast, fall slowly.
                heights[i] = Math.max(target, (heights[i] ?? 0) * 0.82);
                const bar = children[i] as HTMLElement | undefined;
                bar?.style.setProperty('transform', `scaleY(${0.2 + (heights[i] ?? 0) * 0.8})`);
            }
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [recording]);
    return (
        <span class="dictation-level" ref={bars} aria-hidden="true">
            {Array.from({ length: BARS }, (_, i) => (
                <span key={i} />
            ))}
        </span>
    );
}

function Elapsed() {
    const [start] = useState(() => Date.now());
    const [now, setNow] = useState(start);
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 250);
        return () => clearInterval(timer);
    }, []);
    const seconds = Math.floor((now - start) / 1000);
    return (
        <span class="dictation-time">
            {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
        </span>
    );
}
