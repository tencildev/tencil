/** Lives inside the shadow root, so nothing here leaks into (or from) the page. */
export const styles = /* css */ `
:host { all: initial; }
* { box-sizing: border-box; }

.root {
  /* Neutral scale (light). Panels read like a calm document; the toolbar stays dark. */
  --n-50: hsl(120 4% 97%);
  --n-100: hsl(120 2% 92%);
  --n-200: hsl(90 2% 82%);
  --n-400: hsl(105 2% 60%);
  --n-500: hsl(96 2% 50%);
  --n-600: hsl(105 2% 40%);
  --n-700: hsl(100 2% 28%);
  --n-900: hsl(90 2% 9%);
  --n-950: hsl(60 4% 5%);
  --surface: #fff;

  /* Pixelperfect primary scale. */
  --accent: hsl(214 67% 51%);
  --accent-soft: hsl(214 67% 51% / 0.12);
  --accent-text: hsl(214 58% 32%);
  --primary: hsl(214 62% 42%);
  --user-bg: hsl(212 81% 96%);
  --user-text: hsl(214 58% 32%);
  --live: hsl(214 67% 51%);
  --done: #1a896b;
  --warn: #b7791f;
  --error: #d93036;

  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --ease-text: cubic-bezier(0.22, 1, 0.36, 1);
  --press: scale(0.97);
  --radius: 14px;
  --shadow: 0 0 0 1px rgba(0, 0, 0, 0.06), 0 4px 8px -2px rgba(0, 0, 0, 0.06),
    0 16px 40px -8px rgba(0, 0, 0, 0.16);

  font: 13px/1.5 Geist, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  letter-spacing: 0.02rem;
  color: var(--n-950);
  color-scheme: light;
  -webkit-font-smoothing: antialiased;
}
@media (prefers-color-scheme: dark) {
  .root {
    --n-50: hsl(60 4% 7%);
    --n-100: hsl(90 2% 13%);
    --n-200: hsl(100 2% 21%);
    --n-400: hsl(100 2% 42%);
    --n-500: hsl(96 2% 52%);
    --n-600: hsl(105 2% 64%);
    --n-700: hsl(100 2% 76%);
    --n-900: hsl(120 2% 90%);
    --n-950: hsl(120 4% 96%);
    --surface: hsl(90 2% 10%);
    --accent-soft: hsl(214 67% 51% / 0.2);
    --accent-text: hsl(214 67% 69%);
    --primary: hsl(214 67% 69%);
    --user-bg: hsl(211 33% 14%);
    --user-text: hsl(215 82% 89%);
    --live: hsl(214 67% 60%);
    --done: #3dd6a4;
    --warn: #f5b84a;
    --error: #ff6369;
    --shadow: 0 0 0 1px rgba(255, 255, 255, 0.06), 0 16px 40px -8px rgba(0, 0, 0, 0.6);
    color-scheme: dark;
  }
}

/* Thin, theme-aware scrollbars everywhere inside the overlay. */
* { scrollbar-width: thin; scrollbar-color: var(--n-200) transparent; }
/*
 * Chromium and Safari: drawn by hand. Their standard thin scrollbar centers the
 * thumb in a wide track; here it keeps a gap from the content and hugs the edge.
 */
@supports selector(::-webkit-scrollbar) {
  * { scrollbar-width: auto; scrollbar-color: auto; }
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background: var(--n-200) padding-box; border-radius: 999px;
    border: solid transparent; border-width: 2px 2px 2px 4px;
  }
  ::-webkit-scrollbar-thumb:hover { background-color: var(--n-400); }
  .project-picker-list::-webkit-scrollbar-thumb { background-color: rgba(255, 255, 255, 0.2); }
}
.root.picking { cursor: crosshair; }
::selection { background: var(--accent); color: white; }

button { font: inherit; letter-spacing: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; }
a { color: inherit; }
kbd {
  font: 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  padding: 2px 5px; border-radius: 4px;
  background: rgba(255, 255, 255, 0.1); color: rgba(255, 255, 255, 0.6);
}

/* ------------------------------- highlight ------------------------------- */
/* Follows the cursor dozens of times a second: no transition, ever. */
.highlight {
  position: fixed; left: 0; top: 0;
  border: 1.5px solid var(--accent);
  background: var(--accent-soft);
  border-radius: 4px;
  pointer-events: none;
}
.highlight-label {
  position: fixed; left: 0; top: 0;
  display: flex; gap: 6px; align-items: center;
  padding: 3px 7px; border-radius: 6px;
  background: var(--accent); color: white;
  font-size: 11px; font-weight: 500; white-space: nowrap;
  pointer-events: none;
}
.highlight-size { opacity: 0.75; }

/* ---------------------------------- pins --------------------------------- */
.pin {
  position: fixed; left: 0; top: 0; width: 0; height: 0;
  pointer-events: auto;
  --pin: var(--accent);
}
.pin-body {
  position: absolute; left: 0; bottom: 0;
  min-width: 28px; height: 28px; padding: 0 8px;
  display: grid; place-items: center;
  border-radius: 14px 14px 14px 3px;
  background: var(--pin); color: white;
  font-size: 12px; font-weight: 600;
  border: 2px solid white;
  box-shadow: 0 4px 14px -2px rgba(0, 0, 0, 0.35);
  transform-origin: bottom left; touch-action: none;
  transition: transform 160ms var(--ease-out), opacity 160ms var(--ease-out), background-color 200ms ease;
  @starting-style { opacity: 0; transform: scale(0.85); }
}
.pin-open .pin-body { transform: scale(1.1); }
.pin:active .pin-body { transform: scale(0.94); }
/* Lifted while dragged; outranks :active, which holds for the whole drag. */
.pin.pin-dragging { cursor: grabbing; }
.pin.pin-dragging .pin-body { transform: scale(1.15); box-shadow: 0 10px 24px -4px rgba(0, 0, 0, 0.4); }
.pin-done { --pin: var(--done); }
.pin-waiting { --pin: #e69a10; }
.pin-error { --pin: #e5484d; }
.pin-resolved { --pin: #7b7d7a; }
.pin-resolved .pin-body { opacity: 0.8; }
.pin-draft .pin-body { background: white; border-color: var(--accent); color: var(--accent); }
/* Queued for a batch: not sent yet, so outlined rather than filled. */
.pin-queued .pin-body { background: white; color: var(--accent); border: 2px dashed var(--accent); }
.pin-working .pin-body::after {
  content: ""; position: absolute; inset: -6px;
  border-radius: 18px 18px 18px 6px;
  border: 2px solid transparent; border-top-color: var(--pin); border-right-color: var(--pin);
  animation: spin 700ms linear infinite;
}
.pin-static { position: relative; width: 28px; height: 28px; flex: none; pointer-events: none; }
.pin-static .pin-body { transform: none; border-color: var(--surface); box-shadow: none; }
@keyframes spin { to { transform: rotate(360deg); } }

/* -------------------------------- popovers -------------------------------- */
.popover {
  position: fixed;
  pointer-events: auto;
  background: var(--n-50);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  transition: opacity 180ms var(--ease-out), transform 180ms var(--ease-out);
  @starting-style { opacity: 0; transform: scale(0.96); }
}

.composer { padding: 10px; display: grid; gap: 8px; }
.composer-target { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 0 2px; }
.composer-provider {
  display: inline-flex; align-items: center; gap: 4px; min-width: 0; margin-left: auto;
  padding: 2px 6px; border-radius: 7px; color: var(--n-600); font-size: 12px;
}
.composer-provider-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.composer-provider svg { flex: none; transition: transform 150ms var(--ease-out); }
.composer-provider.open svg { transform: rotate(180deg); }
.target-menu {
  display: grid; max-height: 220px; overflow-y: auto; padding: 4px;
  background: var(--surface); border-radius: 12px; box-shadow: 0 0 0 1px var(--n-200);
  transition: opacity 150ms var(--ease-out), transform 150ms var(--ease-out);
  transform-origin: top right;
  @starting-style { opacity: 0; transform: scale(0.97); }
}
.target-option {
  display: flex; align-items: center; gap: 8px; width: 100%; min-width: 0;
  padding: 7px 8px; border-radius: 8px; text-align: left; font-size: 12px;
}
.target-option.selected { background: var(--n-100); }
.target-option-title { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.target-option-meta { color: var(--n-500); flex: none; }
.target-empty { margin: 0; padding: 7px 8px; color: var(--n-500); font-size: 12px; }
.menu-group {
  display: flex; align-items: center; gap: 6px; margin: 0;
  padding: 8px 8px 3px; color: var(--n-500); font-size: 11px; font-weight: 500;
}
.model-toggle { min-width: 0; max-width: 150px; font-size: 12px; }
.composer-batch { color: var(--accent-text); }
.model-toggle-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.model-toggle svg:last-child { flex: none; transition: transform 150ms var(--ease-out); }
.model-toggle.open { color: var(--n-950); background: var(--n-100); }
.model-toggle.open svg:last-child { transform: rotate(180deg); }
.thread-dot { width: 7px; height: 7px; border-radius: 999px; flex: none; background: var(--n-400); }
.inbox-item .thread-dot { margin: 7px 4px 0 2px; }
.thread-dot-working, .thread-dot-starting { background: var(--live); animation: live 1.6s ease-in-out infinite; }
.thread-dot-waiting { background: var(--warn); }
.thread-dot-error { background: var(--error); }
.thread-dot-idle { background: var(--done); }

/* Provider thread rows, after T3 Code's sidebar. */
.inbox-item.provider-item {
  display: grid; grid-template-columns: minmax(0, 1fr); gap: 3px; padding: 9px 10px;
}
.provider-item-project { display: flex; align-items: center; gap: 6px; min-width: 0; color: var(--n-500); font-size: 12px; }
.provider-item-project-name { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.provider-item-time { flex: none; font-variant-numeric: tabular-nums; }
.provider-item-state { flex: none; font-weight: 500; }
.state-working { color: var(--live); }
.state-waiting { color: var(--warn); }
.state-monitoring { color: var(--accent); }
.provider-item-title { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.provider-item-meta { display: flex; align-items: center; gap: 6px; min-width: 0; color: var(--n-500); font-size: 12px; }
.provider-item-branch { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.provider-item-pr { flex: none; color: var(--done); font-variant-numeric: tabular-nums; }
.provider-item-pins { flex: none; color: var(--accent); }
.provider-item-meta .agent-icon { margin-left: auto; }
.project-icon { width: 14px; height: 14px; border-radius: 4px; flex: none; object-fit: contain; }
.project-icon-emoji { font-size: 12px; line-height: 14px; text-align: center; }
.project-icon-letter { display: grid; place-items: center; background: var(--n-200); color: var(--n-700); font-size: 9px; font-weight: 600; text-transform: uppercase; }
.agent-icon { flex: none; }
.agent-mono { fill: var(--n-950); }
.agent-claude { fill: #d97757; }
.hint { margin: 0; padding: 0 2px; color: var(--warn); font-size: 12px; }

.chip {
  display: inline-flex; align-items: center; gap: 5px;
  max-width: 200px; padding: 2px 8px; border-radius: 999px;
  background: var(--accent-soft); color: var(--accent-text);
  font: 500 11px/18px ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: 0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

.prompt-input {
  display: grid; gap: 6px;
  background: var(--surface);
  box-shadow: 0 0 0 1px var(--n-200);
  border-radius: 12px;
  padding: 9px 8px 6px 11px;
  transition: box-shadow 150ms ease;
}
.prompt-input:focus-within { box-shadow: 0 0 0 1px var(--n-400), 0 0 0 4px var(--n-100); }
.prompt-input textarea {
  all: unset; display: block; width: 100%;
  min-height: 20px; max-height: 200px; overflow-y: auto;
  color: var(--n-950); font: inherit; letter-spacing: inherit; line-height: 1.5rem;
  white-space: pre-wrap; word-break: break-word;
}
.prompt-input textarea::placeholder { color: var(--n-500); }
.prompt-input textarea:disabled { opacity: 0.6; }
.prompt-actions { display: flex; align-items: center; justify-content: space-between; }
.prompt-extras { display: flex; gap: 4px; }
.send {
  width: 26px; height: 26px; border-radius: 999px;
  display: grid; place-items: center;
  background: var(--n-950); color: var(--n-50);
  transition: opacity 150ms ease, transform 160ms var(--ease-out);
}
.send:disabled { opacity: 0.25; cursor: default; }
.send:not(:disabled):active { transform: var(--press); }
.toggle {
  height: 24px; padding: 0 7px; border-radius: 7px;
  display: inline-flex; align-items: center; gap: 4px;
  color: var(--n-500);
}
.toggle-on { color: var(--n-950); background: var(--n-100); }

.spinner {
  width: 12px; height: 12px; border-radius: 999px;
  border: 2px solid currentColor; border-top-color: transparent;
  animation: spin 600ms linear infinite;
}

/* --------------------------------- thread -------------------------------- */
.thread { display: flex; flex-direction: column; max-height: min(560px, calc(100vh - 24px)); padding: 0 10px 10px; }
.thread-header {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 10px 2px 10px; border-bottom: 1px solid var(--n-200);
}
.thread-heading { display: flex; align-items: center; gap: 6px; min-width: 0; }
.thread-number { color: var(--n-600); font-weight: 500; font-size: 12px; }
.thread-source { color: var(--n-600); font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.thread-tools { display: flex; gap: 2px; flex: none; }
.thread-title { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-left: 2px; }
.thread-docked { max-height: calc(100vh - 100px); }
.icon-button {
  width: 26px; height: 26px; border-radius: 7px;
  display: grid; place-items: center; color: var(--n-600);
  text-decoration: none;
}

.messages { overflow-y: auto; padding: 16px 2px; min-height: 40px; }
.messages-list { display: flex; flex-direction: column; gap: 1.25rem; }
/* Fade the top edge once content scrolls under the header. */
.messages[data-scrolled] { mask-image: linear-gradient(to bottom, transparent 0, #000 2.5rem); }
.message { max-width: 100%; word-break: break-word; }
.message-user {
  align-self: flex-end; max-width: 85%;
  background: var(--user-bg); color: var(--user-text);
  padding: 0.75rem 0.875rem; border-radius: 1.125rem;
  line-height: 1.5rem; white-space: pre-wrap;
  transition: opacity 350ms var(--ease-text), transform 350ms var(--ease-text), filter 350ms var(--ease-text);
  @starting-style { opacity: 0; transform: translateY(8px); filter: blur(4px); }
}
.message-assistant { color: var(--n-950); }

/* Markdown, after the Eyes assistant: quiet weight, generous leading. */
.md { font-size: 13px; }
.md > * { margin: 0; }
.md > * + * { margin-top: 0.75rem; }
.md p, .md li { line-height: 1.5rem; }
.md strong { font-weight: 500; color: var(--n-950); }
.md a { font-weight: 500; color: var(--primary); text-decoration: underline; text-underline-offset: 2px; }
.md ul { list-style: disc; padding-left: 1.25rem; }
.md ol { list-style: decimal; padding-left: 1.25rem; }
.md li + li { margin-top: 0.375rem; }
.md li::marker { color: var(--n-400); }
.md .md-heading { font-size: 14px; font-weight: 500; line-height: 1.5rem; }
.md :not(pre) > code {
  border-radius: 0.5rem; background: var(--n-100); padding: 0.125rem 0.375rem;
  font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0;
}
.md pre {
  overflow-x: auto; border-radius: 0.875rem; background: var(--n-100); padding: 0.75rem;
  font: 12px/1.25rem ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0;
}
.md pre > code { background: transparent; padding: 0; }

/* Streaming words blur in as they arrive; the stream itself is the stagger. */
.w { display: inline-block; white-space: pre-wrap; animation: word-in 400ms var(--ease-text) both; }
@keyframes word-in { from { opacity: 0; filter: blur(6px); } to { opacity: 1; filter: blur(0); } }

.status-line {
  display: flex; align-items: center; gap: 0.5rem; height: 1.25rem;
  margin: 0 2px 10px; color: var(--n-600); font-size: 13px;
  transition: opacity 250ms var(--ease-out);
  @starting-style { opacity: 0; }
}
.status-waiting { color: var(--warn); }
.status-queued { height: auto; min-height: 1.25rem; margin-top: 12px; }
.status-queued .stop { margin-left: auto; flex: none; }
.status-queued .status-error { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.status-error { color: var(--error); }
.status-line a { margin-left: auto; color: var(--n-950); font-weight: 500; }
.status-line .delivery-commit { margin-left: 0; font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
.delivery-live { color: var(--n-950); }
.delivery-detail { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.live-dot {
  width: 6px; height: 6px; border-radius: 999px; background: var(--live); flex: none;
  animation: live 1.6s ease-in-out infinite;
}
@keyframes live { 0%, 100% { opacity: 0.3; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1); } }
.stop {
  margin-left: auto; display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 9px; border-radius: 999px; color: var(--n-700);
  box-shadow: 0 0 0 1px var(--n-200); font-size: 12px;
}

/* A color wave across the label, one character at a time. */
.shimmer { display: inline-flex; align-items: center; line-height: 1; user-select: none; }
.shimmer > span[aria-hidden] {
  display: inline-block; white-space: pre; color: var(--n-500);
  animation: shimmer-char 2.1s ease-in-out infinite;
  animation-delay: calc(var(--i) * 1.6s / var(--n));
}
@keyframes shimmer-char { 0% { color: var(--n-500); } 38% { color: var(--n-900); } 76%, 100% { color: var(--n-500); } }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

/* ---------------------------------- inbox --------------------------------- */
.inbox {
  position: fixed; right: 16px; top: 16px; bottom: 84px; width: 340px;
  display: flex; flex-direction: column;
  pointer-events: auto;
  background: var(--n-50); border-radius: var(--radius); box-shadow: var(--shadow);
  transition: opacity 220ms var(--ease-out), transform 220ms var(--ease-out);
  @starting-style { opacity: 0; transform: translateX(8px); }
}
.root:has(.dock-top-right) .inbox { top: 76px; bottom: 16px; }
.inbox-header { display: flex; align-items: center; gap: 10px; padding: 10px 10px 10px 16px; border-bottom: 1px solid var(--n-200); }
.inbox-header strong { font-size: 14px; font-weight: 500; }
.segmented { display: flex; margin-right: auto; background: var(--n-100); border-radius: 9px; padding: 2px; }
.segmented button { padding: 3px 10px; border-radius: 7px; color: var(--n-600); font-size: 12px; }
.segmented .active { background: var(--surface); color: var(--n-950); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08); }
.inbox-filter { display: flex; align-items: center; gap: 6px; padding: 10px 16px 6px; color: var(--n-600); font-size: 12px; cursor: pointer; }
/* Custom checkbox: the input stays the hit target, the check is an icon on top. */
.checkbox { position: relative; display: inline-grid; place-items: center; flex: none; width: 14px; height: 14px; }
.checkbox-input {
  appearance: none; margin: 0; width: 14px; height: 14px; border-radius: 4px; cursor: pointer;
  box-shadow: inset 0 0 0 1.5px var(--n-400);
  transition: background-color 150ms var(--ease-out), box-shadow 150ms var(--ease-out);
}
.checkbox-input:checked { background: var(--accent); box-shadow: none; }
.checkbox-input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.checkbox svg {
  position: absolute; width: 10px; height: 10px; color: white; stroke-width: 3; pointer-events: none;
  opacity: 0; transform: scale(0.6); transition: opacity 150ms var(--ease-out), transform 150ms var(--ease-out);
}
.checkbox-input:checked + svg { opacity: 1; transform: scale(1); }
.inbox-list { overflow-y: auto; padding: 0 6px 6px; }
.inbox-item { display: flex; gap: 10px; width: 100%; text-align: left; padding: 10px; border-radius: 12px; align-items: flex-start; }
.inbox-item.active { background: var(--n-100); }
.inbox-item-body { display: grid; gap: 2px; min-width: 0; }
.inbox-item-title { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.inbox-item-meta { color: var(--n-600); font-size: 12px; }
.inbox-item-preview { color: var(--n-600); font-size: 12px; line-height: 1.25rem; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.empty { color: var(--n-500); padding: 24px 10px; text-align: center; margin: 0; }
.empty kbd { background: var(--n-100); color: var(--n-700); }

/* -------------------------------- settings -------------------------------- */
/* Opens from the toolbar, on its open side (above it, or below when docked at the top). */
.settings-panel {
  width: 300px; pointer-events: auto;
  background: var(--n-50); border-radius: var(--radius); box-shadow: var(--shadow);
  transform-origin: bottom center;
  transition: opacity 180ms var(--ease-out), transform 180ms var(--ease-out);
  @starting-style { opacity: 0; transform: translateY(6px) scale(0.98); }
}
[class*="dock-top"] .settings-panel {
  transform-origin: top center;
  @starting-style { opacity: 0; transform: translateY(-6px) scale(0.98); }
}
.settings-header {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 10px 10px 10px 16px; border-bottom: 1px solid var(--n-200);
}
.settings-heading { display: grid; min-width: 0; }
.settings-heading strong { font-size: 14px; font-weight: 500; }
.settings-project { color: var(--n-600); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.settings-section { display: grid; gap: 6px; padding: 14px 16px 16px; }
.settings-section + .settings-section { border-top: 1px solid var(--n-200); }
.settings-label { margin: 0; font-weight: 500; }
.settings-help { margin: 0; color: var(--n-600); font-size: 12px; line-height: 1.4; }
.settings-switch-row { grid-template-columns: 1fr auto; align-items: center; gap: 16px; cursor: pointer; }
.settings-switch-text { display: grid; gap: 2px; }
.settings-account { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.settings-help svg { display: inline; width: 12px; height: 12px; vertical-align: -2px; }
.settings-switch {
  appearance: none; position: relative; flex: none; margin: 0;
  width: 30px; height: 18px; border-radius: 999px; cursor: pointer;
  background: var(--n-400); transition: background-color 150ms ease;
}
.settings-switch::before {
  content: ""; position: absolute; top: 2px; left: 2px;
  width: 14px; height: 14px; border-radius: 999px;
  background: white; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  transition: transform 160ms var(--ease-out);
}
.settings-switch:checked { background: var(--accent); }
.settings-switch:checked::before { transform: translateX(12px); }
.settings-switch:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.settings-options {
  display: grid; gap: 2px; margin: 0; padding: 4px; border: 0; min-width: 0;
  background: var(--surface); border-radius: 12px; box-shadow: 0 0 0 1px var(--n-200);
}
.settings-options .target-option { cursor: pointer; }
.settings-radio {
  appearance: none; margin: 0; width: 14px; height: 14px; border-radius: 999px; flex: none;
  box-shadow: inset 0 0 0 1.5px var(--n-400);
  transition: box-shadow 150ms var(--ease-out);
}
.settings-radio:checked { box-shadow: inset 0 0 0 4px var(--accent); }
.settings-radio:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.settings-status { margin: 2px 2px 0; color: var(--n-600); font-size: 12px; }

/* --------------------------------- toolbar -------------------------------- */
.toolbar-wrap {
  position: fixed;
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  pointer-events: none;
}
.toolbar-wrap[data-dragging] { cursor: grabbing; }
.toolbar { transition: scale 160ms var(--ease-out), box-shadow 160ms var(--ease-out); }
.toolbar-wrap[data-dragging] .toolbar {
  scale: 1.03;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.1), 0 24px 56px -10px rgba(0, 0, 0, 0.6);
}
.dock-bottom-center { left: 50%; bottom: 20px; transform: translateX(-50%); }
.dock-bottom-left { left: 20px; bottom: 20px; align-items: flex-start; }
.dock-bottom-right { right: 20px; bottom: 20px; align-items: flex-end; }
.dock-top-center { left: 50%; top: 20px; transform: translateX(-50%); flex-direction: column-reverse; }
.dock-top-left { left: 20px; top: 20px; align-items: flex-start; flex-direction: column-reverse; }
.dock-top-right { right: 20px; top: 20px; align-items: flex-end; flex-direction: column-reverse; }
.toolbar {
  pointer-events: auto;
  display: flex; align-items: center; gap: 2px;
  padding: 4px; border-radius: 999px;
  background: rgba(17, 17, 19, 0.92);
  backdrop-filter: blur(12px);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08), 0 12px 32px -8px rgba(0, 0, 0, 0.5);
  color: rgba(255, 255, 255, 0.62);
}
.toolbar-hint {
  padding: 5px 12px; border-radius: 999px;
  background: rgba(17, 17, 19, 0.92);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08), 0 8px 24px -8px rgba(0, 0, 0, 0.5);
  color: rgba(255, 255, 255, 0.7); font-size: 12px; white-space: nowrap;
  transition: opacity 200ms var(--ease-out), transform 200ms var(--ease-out);
  @starting-style { opacity: 0; transform: translateY(4px); }
}
.hint-warn { color: #f5b84a; }
.project-picker {
  pointer-events: auto; width: 320px; max-height: 320px; display: flex; flex-direction: column;
  padding: 10px; border-radius: 14px; background: rgba(17, 17, 19, 0.94);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08), 0 12px 32px -8px rgba(0, 0, 0, 0.5);
  color: rgba(255, 255, 255, 0.86);
  transition: opacity 200ms var(--ease-out), transform 200ms var(--ease-out);
  @starting-style { opacity: 0; transform: translateY(4px); }
}
.project-picker-title { margin: 0 4px 8px; font-weight: 500; }
.project-picker-empty { margin: 0 4px; color: rgba(255, 255, 255, 0.6); font-size: 12px; }
.project-picker-search {
  margin: 0 0 6px; padding: 6px 8px; border: 0; border-radius: 8px; outline: none;
  background: rgba(255, 255, 255, 0.06); color: inherit; font: inherit;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08);
  transition: box-shadow 150ms ease;
}
.project-picker-search::placeholder { color: rgba(255, 255, 255, 0.4); }
.project-picker-search:focus { box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.24); }
.project-picker-list { display: grid; gap: 2px; overflow-y: auto; }
@supports not selector(::-webkit-scrollbar) {
  .project-picker-list { scrollbar-color: rgba(255, 255, 255, 0.2) transparent; }
}
.project-picker-option {
  display: grid; gap: 1px; text-align: left; padding: 7px 8px; border-radius: 8px;
  transition: background-color 150ms ease, transform 160ms var(--ease-out);
}
.project-picker-option:active { transform: scale(0.99); }
.project-picker-name { font-weight: 500; }
.project-picker-root { font-size: 11px; color: rgba(255, 255, 255, 0.5); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; direction: rtl; text-align: left; }
.toolbar-hint:has(.hint-action) { display: flex; align-items: center; gap: 8px; pointer-events: auto; padding-right: 4px; }
.hint-action {
  padding: 2px 10px; border-radius: 999px; background: var(--accent); color: white; font-weight: 500;
  transition: transform 160ms var(--ease-out);
}
.hint-action:active { transform: var(--press); }
.hint-error { color: #ff8589; }
.status { position: relative; display: grid; }
.status-button { display: grid; place-items: center; height: 32px; padding: 0 8px 0 10px; border-radius: 999px; outline: none; cursor: default; }
.status-button:focus-visible { box-shadow: 0 0 0 2px var(--accent); }
.status-dot { position: relative; width: 8px; height: 8px; border-radius: 999px; background: rgba(255, 255, 255, 0.4); }
/* Scoped to the dot: .status-error alone also colours status lines in threads. */
.status-dot.status-ok { background: #3dd68c; }
.status-dot.status-warn { background: #f5b84a; }
.status-dot.status-error { background: #ff6369; }
/* The connection card, on the toolbar's open side, starting at the dot. */
.status-card {
  position: absolute; left: -4px; bottom: calc(100% + 14px); z-index: 1;
  width: 250px; padding: 10px 12px 12px; border-radius: 14px;
  /* Solid: a backdrop blur doesn't work inside the toolbar's own. */
  background: #161618;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08), 0 16px 40px -10px rgba(0, 0, 0, 0.6);
  color: rgba(255, 255, 255, 0.9); font-size: 12px; text-align: left; cursor: default;
  transform-origin: bottom left;
  transition: opacity 150ms var(--ease-out), transform 150ms var(--ease-out);
  @starting-style { opacity: 0; transform: translateY(4px) scale(0.97); }
}
[class*="dock-top"] .status-card {
  bottom: auto; top: calc(100% + 14px); transform-origin: top left;
  @starting-style { opacity: 0; transform: translateY(-4px) scale(0.97); }
}
[data-dragging] .status-card { display: none; }
.status-card-head { display: flex; align-items: center; gap: 7px; padding-bottom: 9px; margin-bottom: 8px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); }
.status-card-head strong { font-size: 13px; font-weight: 600; color: white; }
.status-card-head .status-card-muted { margin-left: auto; }
.status-card-muted { color: rgba(255, 255, 255, 0.45); }
.status-card-rows { display: grid; gap: 6px; margin: 0; }
.status-card-row { display: grid; grid-template-columns: 74px 1fr; gap: 8px; align-items: baseline; }
.status-card-row dt { color: rgba(255, 255, 255, 0.45); }
.status-card-row dd { display: flex; align-items: center; gap: 6px; min-width: 0; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.status-card-tone { width: 6px; height: 6px; border-radius: 999px; flex: none; background: rgba(255, 255, 255, 0.4); }
.status-card-tone.tone-ok { background: #3dd68c; }
.status-card-tone.tone-warn { background: #f5b84a; }
.status-card-tone.tone-error { background: #ff6369; }
.status-card-detail { margin: 10px 0 0; color: rgba(255, 255, 255, 0.6); line-height: 1.4; white-space: normal; }
.status-ping { position: absolute; inset: -3px; border-radius: 999px; border: 2px solid var(--accent); animation: ping 1.2s var(--ease-out) infinite; }
@keyframes ping { to { transform: scale(1.9); opacity: 0; } }
/* The separator line is also the drag handle; the hit area is wider than the line. */
.divider {
  position: relative; width: 11px; height: 28px; margin: 0 -2px;
  cursor: grab; touch-action: none;
}
.divider::before {
  content: ""; position: absolute; left: 5px; top: 5px; bottom: 5px; width: 1px;
  background: rgba(255, 255, 255, 0.1);
  transition: background-color 150ms ease;
}
.divider:focus-visible { outline: none; }
.divider:focus-visible::before { background: var(--accent); }
[data-dragging] .divider { cursor: grabbing; }
[data-dragging] .divider::before { background: rgba(255, 255, 255, 0.35); }
.tool {
  position: relative; height: 32px; min-width: 32px; padding: 0 9px;
  display: inline-flex; align-items: center; justify-content: center; gap: 7px;
  border-radius: 999px;
}
.tool-active { background: var(--accent); color: white; }
.tool-active kbd { background: rgba(255, 255, 255, 0.22); color: white; }
.tool-label { font-weight: 500; color: inherit; }
.tool-send { background: var(--accent); color: white; }
.tool-send:disabled { opacity: 0.5; cursor: default; }
.tool:disabled { opacity: 0.45; cursor: default; }
.badge {
  position: absolute; top: 2px; right: 0;
  min-width: 16px; height: 16px; padding: 0 4px; border-radius: 999px;
  background: var(--accent); color: white; font-size: 10px; font-weight: 600; line-height: 16px; text-align: center;
}

.toast {
  position: fixed; left: 50%; bottom: 76px; transform: translateX(-50%);
  max-width: 480px; padding: 8px 14px; border-radius: 12px;
  background: var(--surface); color: var(--error);
  box-shadow: var(--shadow); pointer-events: auto;
  transition: opacity 200ms var(--ease-out), transform 200ms var(--ease-out);
  @starting-style { opacity: 0; transform: translate(-50%, 6px); }
}

/* --------------------------- feedback & motion --------------------------- */
.tool, .icon-button, .toggle, .stop, .segmented button, .inbox-item, .composer-provider, .target-option {
  transition: transform 160ms var(--ease-out), background-color 150ms ease, color 150ms ease;
}
.tool:active, .icon-button:active, .toggle:active, .stop:active, .segmented button:active,
.composer-provider:active { transform: var(--press); }
.target-option:active { transform: scale(0.99); }
.inbox-item:active { transform: scale(0.99); }

@media (hover: hover) and (pointer: fine) {
  .pin:hover .pin-body { transform: scale(1.1); }
  .tool:not(.tool-active):hover { background: rgba(255, 255, 255, 0.08); color: white; }
  .icon-button:hover { background: var(--n-100); color: var(--n-950); }
  .divider:hover::before { background: rgba(255, 255, 255, 0.35); }
  .toggle:hover, .stop:hover { background: var(--n-100); }
  .inbox-item:hover { background: var(--n-100); }
  .project-picker-option:hover { background: rgba(255, 255, 255, 0.08); }
  .composer-provider:hover, .target-option:hover { background: var(--n-100); color: var(--n-950); }
  .md a:hover { opacity: 0.8; }
}

/* Reduced motion keeps fades (they aid comprehension) but drops movement. */
@media (prefers-reduced-motion: reduce) {
  .popover, .inbox, .toast, .toolbar-hint, .message-user, .pin-body,
  .tool, .icon-button, .toggle, .stop, .send, .segmented button, .inbox-item {
    transition-property: opacity, background-color, color;
  }
  .w { animation: none; }
  .shimmer > span[aria-hidden], .status-ping, .live-dot { animation: none; }
}
`;
