import type { Thread, ThreadMessage } from "@fixhere/protocol";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { provider, send, threads } from "../connection.ts";
import { inboxOpen, layoutTick, openThreadId } from "../state.ts";
import {
  CheckIcon,
  CloseIcon,
  CodeIcon,
  ExternalIcon,
  StopIcon,
  TrashIcon,
  UndoIcon,
} from "./icons.tsx";
import { Markdown } from "./markdown.tsx";
import { pinNumbers } from "./Pins.tsx";
import { PromptInput } from "./PromptInput.tsx";
import { popoverPosition, resolveAnchor } from "./position.ts";

const WIDTH = 380;

export function ThreadPanel() {
  layoutTick.value;
  const id = openThreadId.value;
  const thread = id ? threads.value.get(id) : undefined;
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(320);

  useLayoutEffect(() => {
    if (ref.current) setHeight(ref.current.offsetHeight);
  });

  if (!thread) return null;
  // Pinned threads float beside their pin; unpinned ones dock to the right edge.
  const point = thread.anchor ? resolveAnchor(thread.anchor) : null;
  const placement = point
    ? popoverPosition(point, { width: WIDTH, height })
    : {
        left: window.innerWidth - WIDTH - (inboxOpen.value ? 372 : 16),
        top: 16,
        origin: "top right",
      };
  const { left, top, origin } = placement;

  return (
    <div
      ref={ref}
      class={`popover thread${point ? "" : " thread-docked"}`}
      style={{
        left: `${left}px`,
        top: `${top}px`,
        width: `${WIDTH}px`,
        transformOrigin: origin,
      }}
    >
      <Header thread={thread} />
      <Messages thread={thread} />
      <StatusLine thread={thread} />
      <PromptInput
        placeholder={thread.provider.threadId ? "Reply…" : "Waiting for the agent…"}
        disabled={!thread.provider.threadId}
        onSubmit={(text) => {
          send({ type: "thread.reply", threadId: thread.id, text });
        }}
        onCancel={() => {
          openThreadId.value = null;
        }}
      />
    </div>
  );
}

function Header({ thread }: { thread: Thread }) {
  const context = thread.context;
  const component = context?.components[0];
  const source = component?.source;
  return (
    <div class="thread-header">
      <div class="thread-heading">
        {context ? (
          <>
            <span class="thread-number">#{pinNumbers.value.get(thread.id)}</span>
            <span class="chip" title={context.selector}>
              <CodeIcon />
              {component?.name ?? `<${context.tagName}>`}
            </span>
            {source && (
              <span class="thread-source" title={source.file}>
                {source.file.split("/").pop()}
                {source.line ? `:${source.line}` : ""}
              </span>
            )}
          </>
        ) : (
          <span class="thread-title" title={thread.title}>
            {thread.title}
          </span>
        )}
      </div>
      <div class="thread-tools">
        {thread.provider.url && (
          <a
            class="icon-button"
            href={thread.provider.url}
            target="_blank"
            rel="noreferrer"
            title={`Open in ${provider.value?.label ?? "agent"}`}
          >
            <ExternalIcon />
          </a>
        )}
        <button
          type="button"
          class="icon-button"
          title={thread.resolved ? "Reopen" : "Resolve"}
          onClick={() =>
            send({ type: "thread.resolve", threadId: thread.id, resolved: !thread.resolved })
          }
        >
          {thread.resolved ? <UndoIcon /> : <CheckIcon />}
        </button>
        <button
          type="button"
          class="icon-button"
          title="Delete pin (keeps the agent thread)"
          onClick={() => {
            send({ type: "thread.delete", threadId: thread.id });
            openThreadId.value = null;
          }}
        >
          <TrashIcon />
        </button>
        <button
          type="button"
          class="icon-button"
          title="Close (Esc)"
          onClick={() => {
            openThreadId.value = null;
          }}
        >
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}

function Messages({ thread }: { thread: Thread }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const last = thread.messages[thread.messages.length - 1];

  // Follow streaming output unless the user scrolled up to read.
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    if (nearBottom) element.scrollTop = element.scrollHeight;
  }, [last?.id, last?.text.length]);

  return (
    <div
      ref={ref}
      class="messages"
      data-scrolled={scrolled || undefined}
      onScroll={(event) => setScrolled((event.target as HTMLDivElement).scrollTop > 4)}
    >
      {thread.messages.map((message) =>
        message.role === "user" ? (
          <div key={message.id} class="message message-user">
            {message.text}
          </div>
        ) : (
          <AssistantMessage key={message.id} message={message} />
        ),
      )}
    </div>
  );
}

/** Only messages that were streaming when they mounted animate; history renders still. */
function AssistantMessage({ message }: { message: ThreadMessage }) {
  const [animate] = useState(message.streaming);
  return (
    <div class="message message-assistant">
      <Markdown text={message.text} animate={animate} />
    </div>
  );
}

/** Per-character color wave; screen readers get the plain label. */
function Shimmer({ text }: { text: string }) {
  const characters = [...text];
  return (
    <span class="shimmer">
      <span class="sr-only">{text}</span>
      {characters.map((character, index) => (
        <span key={index} aria-hidden="true" style={{ "--i": index, "--n": characters.length }}>
          {character}
        </span>
      ))}
    </span>
  );
}

function StatusLine({ thread }: { thread: Thread }) {
  if (thread.status === "starting") {
    return (
      <div class="status-line">
        <span class="live-dot" />
        <Shimmer text={`Starting a thread in ${provider.value?.label ?? "the agent"}…`} />
      </div>
    );
  }
  if (thread.status === "working") {
    return (
      <div class="status-line">
        <span class="live-dot" />
        <Shimmer text="Working…" />
        <button
          type="button"
          class="stop"
          onClick={() => send({ type: "thread.interrupt", threadId: thread.id })}
        >
          <StopIcon /> Stop
        </button>
      </div>
    );
  }
  if (thread.status === "waiting") {
    return (
      <div class="status-line status-waiting">
        {thread.statusDetail ?? "Waiting for input"}
        {thread.provider.url && (
          <a href={thread.provider.url} target="_blank" rel="noreferrer">
            Open
          </a>
        )}
      </div>
    );
  }
  if (thread.status === "error") {
    return (
      <div class="status-line status-error">{thread.statusDetail ?? "Something went wrong"}</div>
    );
  }
  return null;
}
