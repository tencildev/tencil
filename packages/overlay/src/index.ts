import type { BuildInfo } from '@tencildev/protocol';
import { h, render } from 'preact';
import { App } from './components/app.tsx';
import { connect } from './lib/connection.ts';
import { installPicker } from './lib/element-picker.ts';
import { watchNextIndicator } from './lib/next-devtools.ts';
import { setHost } from './lib/overlay-host.ts';
import { styles } from './styles.ts';

declare global {
    interface Window {
        __TENCIL__?: { version: 1; bridgeUrl: string; destroy(): void };
    }
}

const DEFAULT_BRIDGE = 'http://localhost:4747';

function bridgeUrlFromScript(): string {
    const script = document.currentScript as HTMLScriptElement | null;
    if (script?.dataset.bridge) return script.dataset.bridge;
    if (script?.src) return new URL(script.src).origin;
    return DEFAULT_BRIDGE;
}

/** The build a Tencil Cloud loader put on our script tag (see `cloudLoader`). */
function buildFromScript(): BuildInfo | undefined {
    const data = (document.currentScript as HTMLScriptElement | null)?.dataset;
    if (!data?.tencilProject || !data.tencilRepo || !data.tencilBranch || !data.tencilSha) {
        return undefined;
    }
    return {
        projectKey: data.tencilProject,
        repo: data.tencilRepo,
        branch: data.tencilBranch,
        sha: data.tencilSha,
    };
}

function mount(bridgeUrl: string, build: BuildInfo | undefined): void {
    const host = document.createElement('tencil-overlay');
    host.setAttribute('data-tencil', '');
    host.style.cssText =
        'position:fixed;inset:0;pointer-events:none;z-index:2147483646;display:block;contain:layout style;';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = styles;
    // Pages with a strict CSP usually already pass a nonce to their own scripts.
    const nonce = document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce;
    if (nonce) style.nonce = nonce;
    shadow.append(style);
    const container = document.createElement('div');
    shadow.append(container);

    setHost(host);
    document.body.append(host);

    // Frameworks occasionally wipe <body> children during hydration; put us back.
    const keepAlive = new MutationObserver(() => {
        if (!host.isConnected) document.body.append(host);
    });
    keepAlive.observe(document.body, { childList: true });

    const uninstall = installPicker(host);
    const unwatchNext = watchNextIndicator();
    render(h(App, {}), container);
    connect(bridgeUrl, build);

    window.__TENCIL__ = {
        version: 1,
        bridgeUrl,
        destroy() {
            keepAlive.disconnect();
            uninstall();
            unwatchNext();
            render(null, container);
            host.remove();
            window.__TENCIL__ = undefined;
        },
    };
}

if (typeof window !== 'undefined' && !window.__TENCIL__) {
    // `currentScript` is only set while this runs, so read the tag before waiting for <body>.
    const bridgeUrl = bridgeUrlFromScript();
    const build = buildFromScript();
    if (document.body) mount(bridgeUrl, build);
    else {
        document.addEventListener('DOMContentLoaded', () => mount(bridgeUrl, build), {
            once: true,
        });
    }
}
