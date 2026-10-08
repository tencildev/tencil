import { useEffect, useState } from "preact/hooks";
import { lastError, threads } from "../connection.ts";
import { mode, openThreadId } from "../state.ts";
import { Composer } from "./Composer.tsx";
import { Highlight } from "./Highlight.tsx";
import { Inbox, PENDING_OPEN_KEY, revealAnchor } from "./Inbox.tsx";
import { Pins } from "./Pins.tsx";
import { ThreadPanel } from "./ThreadPanel.tsx";
import { Toolbar } from "./Toolbar.tsx";

export function App() {
  usePendingOpen();
  return (
    <div class={`root${mode.value === "picking" ? " picking" : ""}`}>
      <Highlight />
      <Pins />
      <Composer />
      <ThreadPanel />
      <Inbox />
      <Toast />
      <Toolbar />
    </div>
  );
}

function Toast() {
  const error = lastError.value;
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!error) return;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 5000);
    return () => clearTimeout(timer);
  }, [error?.at]);
  if (!error || !visible) return null;
  return <div class="toast">{error.message}</div>;
}

/** Opens the pin the inbox navigated to once threads have loaded. */
function usePendingOpen() {
  const loaded = threads.value;
  useEffect(() => {
    const id = sessionStorage.getItem(PENDING_OPEN_KEY);
    if (!id) return;
    const thread = loaded.get(id);
    if (!thread) return;
    sessionStorage.removeItem(PENDING_OPEN_KEY);
    openThreadId.value = id;
    revealAnchor(thread);
  }, [loaded]);
}
