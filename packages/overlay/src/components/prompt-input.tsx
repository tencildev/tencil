import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { lastError, transcribe, voice } from '../lib/connection.ts';
import { canRecord, insertText, type Recording, startRecording } from '../lib/voice.ts';
import { ArrowUpIcon, MicIcon, StopIcon } from './icons.tsx';

interface Props {
    placeholder: string;
    /** Text to start from, e.g. a queued comment being rewritten. */
    initialText?: string;
    autoFocus?: boolean;
    disabled?: boolean;
    busy?: boolean;
    onSubmit: (text: string) => void | Promise<void>;
    onCancel?: () => void;
    /** Extra controls rendered left of the send button. */
    children?: ComponentChildren;
}

type Dictation = 'idle' | 'starting' | 'recording' | 'transcribing';

/** Enter sends, Shift+Enter adds a line, Escape cancels (or stops a recording first). */
export function PromptInput({
    placeholder,
    initialText = '',
    autoFocus,
    disabled,
    busy,
    onSubmit,
    onCancel,
    children,
}: Props) {
    const [text, setText] = useState(initialText);
    const ref = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (autoFocus) ref.current?.focus({ preventScroll: true });
    }, [autoFocus]);

    useEffect(() => {
        const textarea = ref.current;
        if (!textarea) return;
        textarea.style.height = 'auto';
        textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }, [text]);

    const [dictation, setDictation] = useState<Dictation>('idle');
    const recording = useRef<Recording | null>(null);
    const mounted = useRef(true);
    // A closed popover mustn't leave the microphone on.
    useEffect(
        () => () => {
            mounted.current = false;
            recording.current?.cancel();
        },
        [],
    );

    const fail = (error: unknown) => {
        lastError.value = {
            message: error instanceof Error ? error.message : String(error),
            at: Date.now(),
        };
    };
    const stopDictation = async () => {
        const current = recording.current;
        if (!current) return;
        recording.current = null;
        setDictation('transcribing');
        try {
            const audio = await current.stop();
            const said = audio ? await transcribe(audio) : '';
            const textarea = ref.current;
            if (said && textarea && mounted.current) {
                const next = insertText(textarea.value, said, {
                    start: textarea.selectionStart,
                    end: textarea.selectionEnd,
                });
                setText(next.value);
                textarea.focus({ preventScroll: true });
                requestAnimationFrame(() => textarea.setSelectionRange(next.caret, next.caret));
            }
        } catch (error) {
            fail(error);
        } finally {
            setDictation('idle');
        }
    };
    const startDictation = async () => {
        setDictation('starting');
        try {
            const started = await startRecording(() => void stopDictation());
            // Closed while the browser asked for the microphone.
            if (!mounted.current) return started.cancel();
            recording.current = started;
            setDictation('recording');
        } catch (error) {
            setDictation('idle');
            fail(error);
        }
    };
    const toggleDictation = () => {
        if (dictation === 'idle') void startDictation();
        else if (dictation === 'recording') void stopDictation();
    };
    const cancelDictation = () => {
        recording.current?.cancel();
        recording.current = null;
        setDictation('idle');
    };
    const voiceStatus = voice.value;
    const showMic =
        voiceStatus !== null && (voiceStatus.available || voiceStatus.hint) && canRecord();

    const canSend = text.trim().length > 0 && !disabled && !busy && dictation === 'idle';
    const submit = async () => {
        if (!canSend) return;
        const value = text.trim();
        await onSubmit(value);
        setText('');
    };

    return (
        <div class="prompt-input">
            <textarea
                ref={ref}
                rows={1}
                value={text}
                placeholder={placeholder}
                disabled={disabled}
                onInput={event => setText((event.target as HTMLTextAreaElement).value)}
                onKeyDown={event => {
                    event.stopPropagation();
                    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
                        event.preventDefault();
                        void submit();
                    } else if (event.key === 'Escape') {
                        event.preventDefault();
                        if (dictation === 'recording') cancelDictation();
                        else onCancel?.();
                    }
                }}
            />
            <div class="prompt-actions">
                <div class="prompt-extras">{children}</div>
                {showMic && (
                    <button
                        type="button"
                        class={`mic${dictation === 'recording' ? ' mic-recording' : ''}`}
                        disabled={
                            !voiceStatus.available ||
                            disabled ||
                            dictation === 'starting' ||
                            dictation === 'transcribing'
                        }
                        onClick={toggleDictation}
                        aria-pressed={dictation === 'recording'}
                        aria-label={dictation === 'recording' ? 'Stop and transcribe' : 'Dictate'}
                        title={
                            !voiceStatus.available
                                ? voiceStatus.hint
                                : dictation === 'recording'
                                  ? 'Stop and transcribe (Escape throws it away)'
                                  : dictation === 'transcribing'
                                    ? 'Transcribing…'
                                    : 'Dictate (Whisper, on this machine)'
                        }
                    >
                        {dictation === 'transcribing' || dictation === 'starting' ? (
                            <span class="spinner" />
                        ) : dictation === 'recording' ? (
                            <StopIcon />
                        ) : (
                            <MicIcon />
                        )}
                    </button>
                )}
                <button
                    type="button"
                    class="send"
                    disabled={!canSend}
                    onClick={() => void submit()}
                    aria-label="Send"
                    title="Send (Enter)"
                >
                    {busy ? <span class="spinner" /> : <ArrowUpIcon />}
                </button>
            </div>
        </div>
    );
}
