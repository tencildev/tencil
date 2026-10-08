import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { ArrowUpIcon } from "./icons.tsx";

interface Props {
  placeholder: string;
  autoFocus?: boolean;
  disabled?: boolean;
  busy?: boolean;
  onSubmit: (text: string) => void | Promise<void>;
  onCancel?: () => void;
  /** Extra controls rendered left of the send button. */
  children?: ComponentChildren;
}

/** Enter sends, Shift+Enter adds a line, Escape cancels. */
export function PromptInput({
  placeholder,
  autoFocus,
  disabled,
  busy,
  onSubmit,
  onCancel,
  children,
}: Props) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) ref.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  useEffect(() => {
    const textarea = ref.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, [text]);

  const canSend = text.trim().length > 0 && !disabled && !busy;
  const submit = async () => {
    if (!canSend) return;
    const value = text.trim();
    await onSubmit(value);
    setText("");
  };

  return (
    <div class="prompt-input">
      <textarea
        ref={ref}
        rows={1}
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        onInput={(event) => setText((event.target as HTMLTextAreaElement).value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            void submit();
          } else if (event.key === "Escape") {
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
    </div>
  );
}
