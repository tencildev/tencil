import { useEffect, useState } from 'preact/hooks';
import {
    DEFAULT_SHORTCUTS,
    formatModifier,
    formatShortcut,
    isMac,
    isModifier,
    type PressAction,
    recording,
    resetShortcuts,
    type Shortcut,
    type Shortcuts,
    sameShortcut,
    sameShortcuts,
    setShortcuts,
    shortcutFrom,
    shortcuts,
} from '../lib/shortcuts.ts';

type Action = PressAction | 'measure';

const ROWS: { action: Action; label: string; help?: string }[] = [
    { action: 'comment', label: 'Comment' },
    { action: 'ruler', label: 'Ruler' },
    { action: 'measure', label: 'Measure', help: 'Held while hovering, with the ruler on.' },
    { action: 'hidePins', label: 'Hide pins' },
    { action: 'hideDock', label: 'Hide the dock', help: 'Also brings a hidden dock back.' },
];

const PRESS_ACTIONS: PressAction[] = ['comment', 'ruler', 'hidePins', 'hideDock'];

/** A recorded combination that another action already has: swap them, or not. */
interface Clash {
    action: PressAction;
    shortcut: Shortcut;
    other: PressAction;
}

/**
 * The overlay's shortcuts, recorded by pressing them: click a key, press the
 * new combination. Esc cancels, Backspace clears. Saved per browser.
 */
export function ShortcutsPage() {
    const [editing, setEditing] = useState<Action | null>(null);
    const [message, setMessage] = useState<{ action: Action; text: string } | null>(null);
    const [clash, setClash] = useState<Clash | null>(null);
    const current = shortcuts.value;

    useEffect(() => {
        recording.value = editing !== null;
    }, [editing]);
    // Closing the dialog mid-recording turns the page's shortcuts back on.
    useEffect(
        () => () => {
            recording.value = false;
        },
        [],
    );

    const stop = () => setEditing(null);
    const save = (next: Shortcuts) => {
        setShortcuts(next);
        setMessage(null);
        stop();
    };

    const record = (action: Action, event: KeyboardEvent) => {
        event.preventDefault();
        event.stopPropagation();
        const plain = !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
        if (event.key === 'Escape' && plain) return stop();
        if ((event.key === 'Backspace' || event.key === 'Delete') && plain) {
            if (action === 'hideDock') {
                setMessage({
                    action,
                    text: "Can't clear this one: it's how a hidden dock comes back.",
                });
                return stop();
            }
            return save({ ...current, [action]: null });
        }
        if (action === 'measure') {
            if (isModifier(event.key)) return save({ ...current, measure: event.key });
            setMessage({
                action,
                text: `Measure is held: press one key, ${isMac ? '⌥, ⇧, ⌃ or ⌘' : 'Alt, Shift, Ctrl or Win'}.`,
            });
            return;
        }
        const shortcut = shortcutFrom(event);
        if (!shortcut) return;
        if ('error' in shortcut) {
            setMessage({ action, text: shortcut.error });
            return;
        }
        const other = PRESS_ACTIONS.find(
            candidate => candidate !== action && sameShortcut(current[candidate], shortcut),
        );
        if (other) {
            setClash({ action, shortcut, other });
            setMessage(null);
            return stop();
        }
        save({ ...current, [action]: shortcut });
    };

    const swap = ({ action, shortcut, other }: Clash) => {
        const previous = current[action];
        if (other === 'hideDock' && !previous) {
            setMessage({ action, text: 'Give it a shortcut first: hide the dock needs one.' });
        } else {
            setShortcuts({ ...current, [action]: shortcut, [other]: previous });
            setMessage(null);
        }
        setClash(null);
    };

    return (
        <div class="settings-section">
            <p class="settings-help">
                Click a shortcut and press the new keys. <kbd>Esc</kbd> cancels,{' '}
                <kbd>{isMac ? '⌫' : 'Backspace'}</kbd> clears it.
            </p>
            <ul class="shortcut-list">
                {ROWS.map(({ action, label, help }) => {
                    const value = current[action];
                    const active = editing === action;
                    const text =
                        value === null
                            ? null
                            : typeof value === 'string'
                              ? formatModifier(value)
                              : formatShortcut(value);
                    return (
                        <li key={action} class="shortcut-row">
                            <span class="settings-switch-text">
                                <span class="settings-label" id={`tencil-shortcut-${action}`}>
                                    {label}
                                </span>
                                {help && <span class="settings-help">{help}</span>}
                            </span>
                            <button
                                type="button"
                                class={`shortcut-key${active ? ' recording' : ''}`}
                                aria-labelledby={`tencil-shortcut-${action}`}
                                aria-describedby={`tencil-shortcut-${action}-value`}
                                onClick={() => {
                                    setClash(null);
                                    setMessage(null);
                                    setEditing(active ? null : action);
                                }}
                                onKeyDown={event => {
                                    if (active) record(action, event);
                                }}
                                onBlur={() => {
                                    if (active) stop();
                                }}
                            >
                                <span id={`tencil-shortcut-${action}-value`}>
                                    {active ? (
                                        'Press keys…'
                                    ) : text ? (
                                        <kbd>{text}</kbd>
                                    ) : (
                                        <span class="shortcut-none">None</span>
                                    )}
                                </span>
                            </button>
                            {message?.action === action && (
                                <p class="shortcut-message" role="alert">
                                    {message.text}
                                </p>
                            )}
                            {clash?.action === action && (
                                <p class="shortcut-message" role="alert">
                                    {formatShortcut(clash.shortcut)} is already used for{' '}
                                    {ROWS.find(row => row.action === clash.other)?.label}.
                                    <span class="shortcut-message-actions">
                                        <button
                                            type="button"
                                            class="hint-action"
                                            onClick={() => swap(clash)}
                                        >
                                            Swap
                                        </button>
                                        <button
                                            type="button"
                                            class="shortcut-cancel"
                                            onClick={() => setClash(null)}
                                        >
                                            Cancel
                                        </button>
                                    </span>
                                </p>
                            )}
                        </li>
                    );
                })}
            </ul>
            <button
                type="button"
                class="shortcut-reset"
                disabled={isDefault(current)}
                onClick={() => {
                    stop();
                    setClash(null);
                    setMessage(null);
                    resetShortcuts();
                }}
            >
                Reset to defaults
            </button>
        </div>
    );
}

function isDefault(current: Shortcuts): boolean {
    return sameShortcuts(current, DEFAULT_SHORTCUTS);
}
