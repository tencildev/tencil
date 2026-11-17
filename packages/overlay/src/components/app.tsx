import { useEffect, useState } from 'preact/hooks';
import { lastError, threads } from '../lib/connection.ts';
import { labels } from '../lib/shortcuts.ts';
import {
    dockHidden,
    dockHiddenAt,
    mode,
    openThreadId,
    setDockHidden,
    settingsOpen,
} from '../lib/state.ts';
import { dark } from '../lib/theme.ts';
import { Composer } from './composer.tsx';
import { Highlight } from './highlight.tsx';
import { Inbox, PENDING_OPEN_KEY, revealAnchor } from './inbox.tsx';
import { MeasureGuides } from './measure-guides.tsx';
import { Pins } from './pins.tsx';
import { SettingsPanel } from './settings-panel.tsx';
import { ThreadPanel } from './thread-panel.tsx';
import { Toolbar } from './toolbar.tsx';

export function App() {
    usePendingOpen();
    if (dockHidden.value) {
        return (
            <div class={`root${dark.value ? ' dark' : ''}`}>
                <HiddenNotice />
            </div>
        );
    }
    return (
        <div
            class={`root${mode.value === 'picking' ? ' picking' : ''}${dark.value ? ' dark' : ''}`}
        >
            <Highlight />
            <MeasureGuides />
            <Pins />
            <Composer />
            <ThreadPanel />
            <Inbox />
            <Toast />
            <Toolbar />
            {settingsOpen.value && mode.value !== 'picking' && <SettingsPanel />}
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

/** Right after the dock is hidden: how to bring it back. Gone after a few seconds. */
function HiddenNotice() {
    const at = dockHiddenAt.value;
    const [visible, setVisible] = useState(false);
    useEffect(() => {
        if (!at) return;
        setVisible(true);
        const timer = setTimeout(() => setVisible(false), 4000);
        return () => clearTimeout(timer);
    }, [at]);
    if (!at || !visible) return null;
    return (
        <div class="toast toast-info" role="status">
            Tencil is hidden. Press <kbd>{labels.value.hideDock}</kbd> to bring it back.
            <button type="button" class="hint-action" onClick={() => setDockHidden(false)}>
                Undo
            </button>
        </div>
    );
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
