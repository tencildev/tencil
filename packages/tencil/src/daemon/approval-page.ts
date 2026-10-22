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
        <p class="warn">Once allowed, any script on that site can send prompts to your coding
        agent while Tencil runs, so only allow sites you trust.</p>
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
        `<p>Go back to the site; the overlay connects on its own.</p>
        <p class="muted">To take it back, remove it from <code>allowed-origins.json</code> in
        Tencil's data folder and restart the daemon.</p>
        <script>setTimeout(() => window.close(), 600)</script>`,
    );
}

export function errorPage(message: string): string {
    return page("Couldn't allow this site", `<p>${escapeHtml(message)}</p>`);
}

function page(title: string, body: string): string {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Tencil</title>
<style>
    :root { color-scheme: dark; }
    body {
        margin: 0; min-height: 100vh; display: grid; place-items: center;
        background: hsl(60 4% 7%); color: hsl(120 2% 90%);
        font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif;
    }
    main {
        width: min(440px, calc(100vw - 32px)); padding: 24px; border-radius: 14px;
        background: hsl(90 2% 10%);
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.06), 0 16px 40px -8px rgba(0, 0, 0, 0.6);
    }
    h1 { margin: 0 0 12px; font-size: 16px; font-weight: 600; overflow-wrap: anywhere; }
    p { margin: 0 0 12px; color: hsl(100 2% 76%); overflow-wrap: anywhere; }
    strong { color: hsl(120 2% 90%); }
    .warn { color: #f5b84a; }
    .muted { color: hsl(96 2% 52%); font-size: 13px; }
    form { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
    button {
        font: inherit; font-weight: 500; padding: 7px 14px; border-radius: 8px;
        border: 0; cursor: pointer; background: hsl(214 67% 51%); color: white;
    }
    button.secondary { background: hsl(90 2% 13%); color: hsl(120 2% 90%); }
    code { font-size: 12px; }
</style>
</head>
<body><main><h1>${title}</h1>${body}</main></body>
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
