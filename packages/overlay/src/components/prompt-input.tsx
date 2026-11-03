import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { handOffBlocked } from '../lib/cloud-auth.ts';
import {
    commentsOn,
    insertMention,
    members,
    mentionQuery,
    type Suggestion,
    suggestionsFor,
} from '../lib/comments.ts';
import { Avatar } from './avatar.tsx';
import { ArrowUpIcon, TencilLogo } from './icons.tsx';

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

/**
 * Enter sends, Shift+Enter adds a line, Escape cancels. With comments on,
 * `@` suggests the agent and the members to mention.
 */
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
    const [caret, setCaret] = useState(initialText.length);
    const [active, setActive] = useState(0);
    /** The `@` whose popup Escape closed; it stays closed until another one. */
    const [dismissed, setDismissed] = useState<number | null>(null);
    const ref = useRef<HTMLTextAreaElement>(null);
    const nextCaret = useRef<number | null>(null);

    useEffect(() => {
        if (autoFocus) ref.current?.focus({ preventScroll: true });
    }, [autoFocus]);

    useEffect(() => {
        const textarea = ref.current;
        if (!textarea) return;
        textarea.style.height = 'auto';
        textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }, [text]);

    // Put the caret after an inserted mention once the new text is rendered.
    useLayoutEffect(() => {
        const textarea = ref.current;
        if (!textarea || nextCaret.current === null) return;
        textarea.setSelectionRange(nextCaret.current, nextCaret.current);
        nextCaret.current = null;
    }, [text]);

    const query = commentsOn.value && !disabled ? mentionQuery(text, caret) : null;
    const suggestions =
        query && query.start !== dismissed ? suggestionsFor(query.query, members.value) : [];
    const open = suggestions.length > 0;
    const highlighted = Math.min(active, suggestions.length - 1);

    const blocked = handOffBlocked(text);
    const canSend = text.trim().length > 0 && !disabled && !busy && !blocked;
    const submit = async () => {
        if (!canSend) return;
        const value = text.trim();
        await onSubmit(value);
        setText('');
        setCaret(0);
    };

    const pick = (suggestion: Suggestion) => {
        if (!query) return;
        const next = insertMention(text, query.start, caret, suggestion.handle);
        nextCaret.current = next.caret;
        setText(next.text);
        setCaret(next.caret);
        setActive(0);
    };

    const track = (event: Event) => {
        const textarea = event.currentTarget as HTMLTextAreaElement;
        setCaret(textarea.selectionStart);
    };

    return (
        <div class="prompt-input">
            {open && (
                <div class="target-menu mention-menu" role="listbox" id="tencil-mentions">
                    {suggestions.map((suggestion, index) => (
                        <button
                            key={suggestion.handle}
                            id={`tencil-mention-${index}`}
                            type="button"
                            role="option"
                            tabIndex={-1}
                            aria-selected={index === highlighted}
                            class={`target-option${index === highlighted ? ' selected' : ''}`}
                            // Keep the focus (and the caret) in the textarea.
                            onMouseDown={event => event.preventDefault()}
                            onMouseEnter={() => setActive(index)}
                            onClick={() => pick(suggestion)}
                        >
                            {suggestion.agent ? (
                                <span class="avatar avatar-agent">
                                    <TencilLogo size={18} />
                                </span>
                            ) : (
                                <Avatar name={suggestion.name} avatarUrl={suggestion.avatarUrl} />
                            )}
                            <span class="target-option-title">
                                {suggestion.agent ? 'Tencil' : suggestion.name}
                            </span>
                            <span class="target-option-meta">
                                {suggestion.agent ? 'Agent' : `@${suggestion.handle}`}
                            </span>
                        </button>
                    ))}
                </div>
            )}
            <textarea
                ref={ref}
                rows={1}
                value={text}
                placeholder={placeholder}
                disabled={disabled}
                aria-autocomplete={commentsOn.value ? 'list' : undefined}
                aria-controls={open ? 'tencil-mentions' : undefined}
                aria-activedescendant={open ? `tencil-mention-${highlighted}` : undefined}
                onInput={event => {
                    const textarea = event.target as HTMLTextAreaElement;
                    setText(textarea.value);
                    setCaret(textarea.selectionStart);
                    setActive(0);
                    // A new `@` (or the same one typed again) opens the popup again.
                    const typed = mentionQuery(textarea.value, textarea.selectionStart);
                    if (typed?.start !== dismissed) setDismissed(null);
                }}
                onKeyUp={track}
                onClick={track}
                onKeyDown={event => {
                    event.stopPropagation();
                    if (open) {
                        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                            event.preventDefault();
                            const step = event.key === 'ArrowDown' ? 1 : -1;
                            setActive(
                                (highlighted + step + suggestions.length) % suggestions.length,
                            );
                            return;
                        }
                        if ((event.key === 'Enter' || event.key === 'Tab') && !event.isComposing) {
                            event.preventDefault();
                            pick(suggestions[highlighted]!);
                            return;
                        }
                        if (event.key === 'Escape') {
                            event.preventDefault();
                            setDismissed(query!.start);
                            return;
                        }
                    }
                    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
                        event.preventDefault();
                        void submit();
                    } else if (event.key === 'Escape') {
                        event.preventDefault();
                        onCancel?.();
                    }
                }}
            />
            <div class="prompt-actions">
                <div class="prompt-extras">{children}</div>
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
            {blocked && <p class="hint prompt-hint">{blocked}</p>}
        </div>
    );
}
