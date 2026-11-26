import { useEffect, useRef, useState } from 'preact/hooks';
import type { Recording } from '../lib/voice.ts';
import { Shimmer } from './shimmer.tsx';

/** Enough bars to fill the box; the newest level comes in on the right. */
const BARS = 48;
/** How often the meter takes a new level, so it scrolls at a steady pace. */
const SAMPLE_MS = 50;

/**
 * What dictation is doing, inside the prompt box: a live level meter across
 * the box and the time while recording, then a shimmer while Whisper writes it down.
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

/** The last few seconds of the microphone's level, set straight on the DOM. */
function LevelMeter({ recording }: { recording: { current: Recording | null } }) {
    const bars = useRef<HTMLSpanElement>(null);
    useEffect(() => {
        const history = new Array<number>(BARS).fill(0);
        let frame = 0;
        let last = 0;
        let peak = 0;
        const tick = (time: number) => {
            // The loudest moment since the last sample, so short syllables still show.
            peak = Math.max(peak, recording.current?.level() ?? 0);
            if (time - last >= SAMPLE_MS) {
                last = time;
                history.shift();
                history.push(peak);
                peak = 0;
                const children = bars.current?.children ?? [];
                for (let i = 0; i < BARS; i++) {
                    const bar = children[i] as HTMLElement | undefined;
                    bar?.style.setProperty(
                        'transform',
                        `scaleY(${0.12 + (history[i] ?? 0) * 0.88})`,
                    );
                }
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
