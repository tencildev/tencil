import { originOf } from './origins.ts';
import { isLoaded, loadScript, unload } from './page.ts';

const DAEMON_URL = 'http://localhost:4747';
const ENABLED_KEY = 'enabledOrigins';

type TabState = 'on' | 'off' | 'no-daemon';

const titles: Record<TabState, string> = {
    on: 'Tencil is on for this site. Click to turn it off.',
    off: 'Turn on Tencil for this site',
    'no-daemon': "Tencil isn't running. Start it with `tencil start`, then click again.",
};

async function enabledOrigins(): Promise<string[]> {
    const stored = await chrome.storage.local.get(ENABLED_KEY);
    return (stored[ENABLED_KEY] as string[] | undefined) ?? [];
}

async function setEnabled(origin: string, enabled: boolean): Promise<void> {
    const others = (await enabledOrigins()).filter(o => o !== origin);
    await chrome.storage.local.set({ [ENABLED_KEY]: enabled ? [...others, origin] : others });
}

async function show(tabId: number, state: TabState): Promise<void> {
    await Promise.all([
        chrome.action.setBadgeText({ tabId, text: { on: 'ON', off: '', 'no-daemon': '!' }[state] }),
        chrome.action.setBadgeBackgroundColor({
            tabId,
            color: state === 'no-daemon' ? '#d93025' : '#1a1a1a',
        }),
        chrome.action.setTitle({ tabId, title: titles[state] }),
    ]);
}

async function daemonRunning(): Promise<boolean> {
    try {
        return (await fetch(`${DAEMON_URL}/tencil.js`, { method: 'HEAD' })).ok;
    } catch {
        return false;
    }
}

async function inject(tabId: number): Promise<void> {
    if (!(await daemonRunning())) return show(tabId, 'no-daemon');
    const target = { tabId };
    const [loaded] = await chrome.scripting.executeScript({
        target,
        world: 'MAIN',
        func: loadScript,
        args: [`${DAEMON_URL}/tencil.js`],
    });
    // Files from the extension aren't subject to the page's CSP. The overlay finds the
    // daemon on its default address, though a strict `connect-src` can still block it.
    if (loaded?.result === 'blocked') {
        await chrome.scripting.executeScript({ target, world: 'MAIN', files: ['overlay.js'] });
    }
    await show(tabId, 'on');
}

chrome.action.onClicked.addListener(async tab => {
    const origin = tab.url ? originOf(tab.url) : undefined;
    if (tab.id === undefined || !origin) return;
    const tabId = tab.id;
    try {
        const enabled = (await enabledOrigins()).includes(origin);
        const [loaded] = await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: isLoaded,
        });
        if (enabled || loaded?.result) {
            await setEnabled(origin, false);
            await chrome.scripting.executeScript({
                target: { tabId },
                world: 'MAIN',
                func: unload,
            });
            return await show(tabId, 'off');
        }
        // Remember the site only where we may load into it again on our own (local
        // dev servers). Anywhere else the click's one-time access covers this page only.
        if (await chrome.permissions.contains({ origins: [`${origin}/*`] })) {
            await setEnabled(origin, true);
        }
        await inject(tabId);
    } catch (error) {
        console.warn('Tencil could not load into this page', error);
        await show(tabId, 'off');
    }
});

chrome.tabs.onUpdated.addListener(async (tabId, change, tab) => {
    // A new page starts without the overlay; the badge has to say so too.
    if (change.status === 'loading') return show(tabId, 'off');
    if (change.status !== 'complete' || !tab.url) return;
    const origin = originOf(tab.url);
    if (!origin || !(await enabledOrigins()).includes(origin)) return;
    try {
        await inject(tabId);
    } catch (error) {
        console.warn('Tencil could not load into this page', error);
    }
});
