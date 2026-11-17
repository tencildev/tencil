/**
 * The page where the developer lets a site talk to the daemon. It's served by the
 * daemon itself, so the site asking can't frame it, script it or click it.
 */

/** No framing (clickjacking), no outside resources, forms only back to the daemon. */
export const APPROVAL_HEADERS = {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-frame-options': 'DENY',
    'content-security-policy':
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
};

export function confirmPage(origin: string): string {
    return page(
        `Let ${escapeHtml(origin)} use Tencil?`,
        `<p>The Tencil overlay on <strong>${escapeHtml(origin)}</strong> wants to connect to the
        daemon on this machine.</p>
        <p class="warn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/></svg><span>Once allowed, any script on that site can send prompts to your coding
        agent while Tencil runs, so only allow sites you trust.</span></p>
        <form method="post" action="/allow">
            <input type="hidden" name="origin" value="${escapeHtml(origin)}">
            <button type="button" class="secondary" onclick="window.close()">Cancel</button>
            <button type="submit">Allow</button>
        </form>`,
    );
}

export function allowedPage(origin: string): string {
    return page(
        `${escapeHtml(origin)} can use Tencil`,
        `<p class="done"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>Go back to the site; the overlay connects on its own.</p>
        <p class="muted">To take it back, remove it from <code>allowed-origins.json</code> in
        Tencil's data folder and restart the daemon.</p>
        <script>setTimeout(() => window.close(), 600)</script>`,
    );
}

export function errorPage(message: string): string {
    return page("Couldn't allow this site", `<p>${escapeHtml(message)}</p>`);
}

/** Tencil's mark, as in the overlay: the pin with a cursor cut out of it. */
const LOGO = `<svg class="logo" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path fill="#3b62ff" fill-rule="evenodd" transform="translate(3 3) scale(0.140625)" d="M80 0C106.51 0 128 21.4903 128 48V80C128 106.51 106.51 128 80 128H4C1.79086 128 0 126.209 0 124V48C0 21.4903 21.4903 0 48 0H80ZM102.06 31.19A4 4 0 0 0 96.81 25.94L17.67 59.86A4 4 0 0 0 17.98 67.33L48.1 77.37A4 4 0 0 1 50.63 79.9L60.67 110.02A4 4 0 0 0 68.14 110.33Z"/></svg>`;

/** Styled like the overlay's panels: same neutrals, accent, radius and shadow. */
function page(title: string, body: string): string {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Tencil</title>
<style>
    :root {
        --n-50: hsl(120 4% 97%); --n-100: hsl(120 2% 92%); --n-200: hsl(90 2% 82%);
        --n-500: hsl(96 2% 50%); --n-700: hsl(100 2% 28%); --n-950: hsl(60 4% 5%);
        --surface: #fff;
        --accent: hsl(214 67% 51%); --accent-hover: hsl(214 62% 45%);
        --warn: #b7791f; --warn-soft: hsl(38 80% 50% / 0.1);
        --done: #1a896b;
        --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
        --shadow: 0 0 0 1px rgba(0, 0, 0, 0.06), 0 4px 8px -2px rgba(0, 0, 0, 0.06),
            0 16px 40px -8px rgba(0, 0, 0, 0.16);
        color-scheme: light;
    }
    @media (prefers-color-scheme: dark) {
        :root {
            --n-50: hsl(60 4% 7%); --n-100: hsl(90 2% 13%); --n-200: hsl(100 2% 21%);
            --n-500: hsl(96 2% 52%); --n-700: hsl(100 2% 76%); --n-950: hsl(120 4% 96%);
            --surface: hsl(90 2% 10%);
            --accent-hover: hsl(214 67% 58%);
            --warn: #f5b84a; --warn-soft: hsl(38 90% 60% / 0.1);
            --done: #3dd6a4;
            --shadow: 0 0 0 1px rgba(255, 255, 255, 0.06), 0 16px 40px -8px rgba(0, 0, 0, 0.6);
            color-scheme: dark;
        }
    }
    * { box-sizing: border-box; }
    body {
        margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px;
        background: var(--n-50); color: var(--n-950);
        font: 13px/1.5 Geist, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        letter-spacing: 0.02rem; -webkit-font-smoothing: antialiased;
    }
    main {
        width: min(420px, 100%); padding: 20px; border-radius: 14px;
        background: var(--surface); box-shadow: var(--shadow);
        animation: enter 300ms var(--ease-out);
    }
    @keyframes enter { from { opacity: 0; transform: translateY(6px) scale(0.98); } }
    @media (prefers-reduced-motion: reduce) { main { animation: none; } }
    header {
        display: flex; align-items: center; gap: 7px;
        padding-bottom: 12px; margin-bottom: 16px; border-bottom: 1px solid var(--n-100);
    }
    header strong { font-size: 13px; font-weight: 600; }
    header span { margin-left: auto; color: var(--n-500); font-size: 12px; }
    .logo { flex: none; }
    h1 { margin: 0 0 8px; font-size: 15px; font-weight: 600; line-height: 1.4; overflow-wrap: anywhere; }
    p { margin: 0 0 12px; color: var(--n-700); overflow-wrap: anywhere; }
    strong { color: var(--n-950); font-weight: 600; }
    .warn {
        display: flex; gap: 8px; padding: 10px 12px; border-radius: 10px;
        background: var(--warn-soft); color: var(--warn);
    }
    .warn svg { flex: none; margin-top: 2px; }
    .done { display: flex; align-items: center; gap: 8px; color: var(--n-950); }
    .done svg { flex: none; color: var(--done); }
    .muted { color: var(--n-500); font-size: 12px; margin-bottom: 0; }
    form { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
    button {
        font: inherit; letter-spacing: inherit; font-weight: 500; height: 32px; padding: 0 14px;
        border-radius: 999px; border: 0; cursor: pointer; background: var(--accent); color: white;
        transition: background-color 150ms var(--ease-out), transform 150ms var(--ease-out);
    }
    button:hover { background: var(--accent-hover); }
    button:active { transform: scale(0.97); }
    button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    button.secondary { background: var(--n-100); color: var(--n-950); }
    button.secondary:hover { background: var(--n-200); }
    code {
        font: 11.5px ui-monospace, SFMono-Regular, Menlo, monospace;
        padding: 1px 5px; border-radius: 5px; background: var(--n-100); color: var(--n-950);
    }
</style>
</head>
<body><main>
<header>${LOGO}<strong>Tencil</strong><span>This machine</span></header>
<h1>${title}</h1>${body}
</main></body>
</html>
`;
}

function escapeHtml(text: string): string {
    return text.replace(
        /[&<>"']/g,
        char =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
    );
}
