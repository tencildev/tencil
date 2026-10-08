import { useEffect, useState } from 'preact/hooks';
import { lastError, threads } from '../lib/connection.ts';
import { mode, openThreadId } from '../lib/state.ts';
import { Composer } from './composer.tsx';
import { Highlight } from './highlight.tsx';
import { Inbox, PENDING_OPEN_KEY, revealAnchor } from './inbox.tsx';
import { Pins } from './pins.tsx';
import { SettingsPanel } from './settings-panel.tsx';
import { ThreadPanel } from './thread-panel.tsx';
import { Toolbar } from './toolbar.tsx';

export function App() {
    usePendingOpen();
    return (
        <div class={`root${mode.value === 'picking' ? ' picking' : ''}`}>
            <Highlight />
            <Pins />
            <Composer />
            <ThreadPanel />
            <Inbox />
            <SettingsPanel />
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
