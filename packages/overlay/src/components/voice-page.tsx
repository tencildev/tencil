import type { ClientMessageInput, VoiceStatus } from '@tencildev/protocol';
import { send, voice } from '../lib/connection.ts';
import { canRecord } from '../lib/voice.ts';
import { MicIcon } from './icons.tsx';
import { SwitchRow } from './settings-panel.tsx';

/** Languages Whisper knows well; the rest are still heard with Automatic. */
const LANGUAGES = [
    'en',
    'nl',
    'de',
    'fr',
    'es',
    'it',
    'pt',
    'pl',
    'sv',
    'da',
    'no',
    'fi',
    'tr',
    'ru',
    'uk',
    'cs',
    'el',
    'he',
    'ar',
    'hi',
    'id',
    'ja',
    'ko',
    'zh',
];

const ENGINES: Record<NonNullable<VoiceStatus['engine']>, string> = {
    'whisper.cpp': 'whisper.cpp',
    'openai-whisper': 'openai-whisper',
};

/** The model the engine picks itself, for openai-whisper. */
const DEFAULT_MODEL = '';

function update(change: Omit<Extract<ClientMessageInput, { type: 'voice.update' }>, 'type'>) {
    send({ type: 'voice.update', ...change });
}

/** Voice input on this computer: on or off, which Whisper model, which language. */
export function VoicePage() {
    const status = voice.value;
    if (!status) return <p class="empty">Connecting…</p>;
    return (
        <>
            <SwitchRow
                label="Voice input"
                checked={status.enabled}
                onChange={enabled => update({ enabled })}
                help={
                    <>
                        Adds <MicIcon /> to the comment box. Whisper on this computer writes down
                        what you say; the audio never leaves it.
                    </>
                }
            />
            <WhisperStatus status={status} />
            {status.engine && status.models.length > 0 && <ModelPicker status={status} />}
            {status.engine && <LanguagePicker status={status} />}
        </>
    );
}

function WhisperStatus({ status }: { status: VoiceStatus }) {
    return (
        <div class="settings-section">
            <p class="settings-label">Whisper</p>
            {status.engine ? (
                <p class="settings-help">
                    Using {ENGINES[status.engine]}
                    {status.enabled ? '.' : ', once voice input is on.'}
                </p>
            ) : status.hint ? (
                <p class="settings-help">{status.hint}</p>
            ) : (
                <p class="settings-help">
                    Not found on this computer. Install whisper.cpp (
                    <code>brew install whisper-cpp</code>) and put a model such as{' '}
                    <code>ggml-large-v3-turbo.bin</code> in <code>~/.config/tencil/whisper</code>,
                    or install openai-whisper (<code>pip install openai-whisper</code>). Tencil
                    finds it without a restart.
                </p>
            )}
            {!canRecord() && (
                <p class="settings-help">
                    This page can't use the microphone. Pages on localhost or https can.
                </p>
            )}
        </div>
    );
}

function ModelPicker({ status }: { status: VoiceStatus }) {
    const ownDefault = status.engine === 'openai-whisper';
    const choices = [
        ...(ownDefault ? [{ id: DEFAULT_MODEL, label: "openai-whisper's default" }] : []),
        ...status.models,
    ];
    const current = status.model ?? DEFAULT_MODEL;
    return (
        <div class="settings-section">
            <p class="settings-label" id="tencil-voice-model-label">
                Model
            </p>
            <fieldset
                class="settings-options"
                aria-labelledby="tencil-voice-model-label"
                disabled={status.modelLocked}
            >
                {choices.map(choice => {
                    const selected = choice.id === current;
                    return (
                        <label
                            key={choice.id}
                            class={`target-option${selected ? ' selected' : ''}`}
                            title={choice.id || undefined}
                        >
                            <input
                                type="radio"
                                name="tencil-voice-model"
                                class="settings-radio"
                                checked={selected}
                                onChange={() => update({ model: choice.id || null })}
                            />
                            <span class="target-option-title">{choice.label}</span>
                        </label>
                    );
                })}
            </fieldset>
            <p class="settings-help">
                {status.modelLocked
                    ? 'Picked by TENCIL_WHISPER_MODEL, which the daemon was started with.'
                    : ownDefault
                      ? 'openai-whisper downloads a model the first time it uses it.'
                      : 'Bigger models hear better and take longer. Tencil looks for ggml models in ~/.config/tencil/whisper and the usual whisper.cpp folders.'}
            </p>
        </div>
    );
}

function LanguagePicker({ status }: { status: VoiceStatus }) {
    const names = languageNames();
    const options = LANGUAGES.map(code => ({ code, name: names?.of(code) ?? code })).sort((a, b) =>
        a.name.localeCompare(b.name),
    );
    // A language saved by hand that isn't in the list still shows.
    if (status.language !== 'auto' && !LANGUAGES.includes(status.language)) {
        options.unshift({
            code: status.language,
            name: names?.of(status.language) ?? status.language,
        });
    }
    return (
        <label class="settings-section settings-switch-row">
            <span class="settings-switch-text">
                <span class="settings-label">Language</span>
                <span class="settings-help">
                    Automatic hears any language. Picking yours is a little faster and sure of short
                    clips.
                </span>
            </span>
            <select
                class="settings-select"
                value={status.language}
                onChange={event => update({ language: event.currentTarget.value })}
                // Typing to pick a language is for the list, not the overlay's shortcuts.
                onKeyDown={event => {
                    if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation();
                }}
            >
                <option value="auto">Automatic</option>
                {options.map(option => (
                    <option key={option.code} value={option.code}>
                        {option.name}
                    </option>
                ))}
            </select>
        </label>
    );
}

function languageNames(): Intl.DisplayNames | undefined {
    try {
        return new Intl.DisplayNames([navigator.language, 'en'], { type: 'language' });
    } catch {
        return undefined;
    }
}
