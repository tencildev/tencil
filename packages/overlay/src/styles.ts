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
  /* Hairlines between and around settings; softer than --n-200 on light. */
  --line: hsl(90 2% 89%);

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
  --measure: #f24822;

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
/* The Appearance setting picks dark, light or the system's (lib/theme.ts). */
.root.dark {
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
  --line: hsl(100 2% 21%);
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

/* -------------------------------- measuring ------------------------------- */
/* Box model colours follow browser devtools; distances are Figma's red. */
.band, .guide, .measure-box, .measure-target {
  position: fixed; left: 0; top: 0;
  pointer-events: none;
}
.band-margin { background: hsl(30 90% 55% / 0.22); }
.band-padding { background: hsl(140 55% 45% / 0.22); }
.band-gap {
  background: repeating-linear-gradient(
    45deg, hsl(280 60% 55% / 0.28) 0 2px, hsl(280 60% 55% / 0.1) 2px 6px
  );
}
.band-value, .guide-value {
  position: fixed; left: 0; top: 0;
  display: flex; gap: 4px; align-items: center;
  padding: 0 4px; border-radius: 4px;
  font: 500 10px/15px ui-monospace, SFMono-Regular, Menlo, monospace;
  color: white; white-space: nowrap;
  pointer-events: none;
}
.band-value-margin { background: hsl(30 80% 42%); }
.band-value-padding { background: hsl(140 55% 30%); }
.band-value-gap { background: hsl(280 50% 45%); }
.band-utility { opacity: 0.75; }
.guide { background: var(--measure); }
.guide-extension {
  background: none;
  border: 0 dashed var(--measure); border-left-width: 1px; border-top-width: 1px;
}
.guide-value { background: var(--measure); }
.measure-box { border: 1.5px solid var(--accent); border-radius: 4px; }
.measure-target { border: 1px dashed var(--measure); }

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
/*
 * Working: the pin turns into the logo (solid, no white rim) and a light travels
 * round its edge, a bright head with a long tail. The fill and the 2px edge are
 * ::before, the blurred glow ::after; both sit under the number, and isolation
 * keeps them under the body's own stacking context however it's scaled.
 */
.pin-working .pin-body {
  isolation: isolate;
  background: transparent; border-color: transparent;
}
.pin-working .pin-body::before, .pin-working .pin-body::after {
  content: ""; position: absolute; inset: -2px; z-index: -1;
  border-radius: inherit;
  animation: rim-travel 2s linear infinite;
}
/* The edge: white at the head on the pin's own colour, so it reads on any page. */
.pin-working .pin-body::before {
  border: 2px solid transparent;
  background: linear-gradient(var(--pin), var(--pin)) padding-box,
    conic-gradient(from var(--tencil-rim), #fff 0deg, #d9e8ff 22deg, #8fbcff 50deg,
      color-mix(in oklab, var(--pin), white 22%) 96deg 312deg, #d9e8ff 348deg, #fff 360deg) border-box;
}
/* The glow: saturated, since a white one vanishes on a light page. */
.pin-working .pin-body::after {
  inset: -3px; z-index: -2;
  background: conic-gradient(from var(--tencil-rim), var(--pin) 0deg,
    color-mix(in oklab, var(--pin), white 20%) 30deg, color-mix(in oklab, var(--pin), white 50%) 60deg,
    transparent 110deg 300deg, var(--pin) 360deg);
  filter: blur(5px);
}
.pin-static { position: relative; width: 28px; height: 28px; flex: none; pointer-events: none; }
.pin-static .pin-body { transform: none; border-color: var(--surface); box-shadow: none; }
@keyframes spin { to { transform: rotate(360deg); } }
/* Counter-clockwise, so the tail trails the head. Needs --tencil-rim registered (index.ts). */
@keyframes rim-travel { from { --tencil-rim: 360deg; } to { --tencil-rim: 0deg; } }

/*
 * A new pin blooms out of its tip: a burst of glow behind it, then one lap of
 * the working pin's light round its edge.
 */
.pin-draft::before, .pin-resolving::before {
  content: ""; position: absolute; left: 0; top: 0; width: 80px; height: 80px;
  translate: -50% -50%; border-radius: 50%; pointer-events: none; opacity: 0;
}
.pin-draft::before {
  background: radial-gradient(closest-side, color-mix(in oklab, var(--accent), white 30%), transparent);
  animation: pin-burst 700ms var(--ease-out);
}
.pin-draft .pin-body {
  animation: pin-bloom 460ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
  @starting-style { opacity: 1; transform: scale(1.1); }
}
.pin-draft .pin-body::before {
  content: ""; position: absolute; inset: -2px; padding: 2px; border-radius: inherit;
  pointer-events: none; opacity: 0;
  background: conic-gradient(from var(--tencil-rim), #fff 0deg, #d9e8ff 30deg, transparent 120deg 360deg);
  mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0);
  animation: pin-lap 800ms 180ms cubic-bezier(0.4, 0, 0.2, 1) both;
}
/*
 * A pin leaving the page (resolved or deleted) floats up and blurs away. A
 * resolved one first turns green and swaps its number for a check as a shine
 * crosses it, then leaves in a green glow. Pins.tsx keeps it mounted meanwhile.
 */
.pin-leaving { pointer-events: none; }
.pin-leaving .pin-body {
  transition: none;
  animation: pin-dissolve 420ms cubic-bezier(0.55, 0, 1, 0.45) both;
}
.pin-resolving .pin-body {
  animation: pin-done 220ms var(--ease-out) both,
    pin-dissolve 420ms 480ms cubic-bezier(0.55, 0, 1, 0.45) both;
}
/* A working pin draws its fill on these; without them it turns green like the rest. */
.pin-resolving .pin-body::before, .pin-resolving .pin-body::after { content: none; }
.pin-resolving::before {
  background: radial-gradient(closest-side, color-mix(in oklab, var(--done), white 30%), transparent);
  animation: pin-burst 600ms 480ms var(--ease-out) both;
}
.pin-glyph { display: grid; place-items: center; }
/* Laid over the number, so the pin keeps its width. */
.pin-check { position: absolute; inset: 0; opacity: 0; }
.pin-check svg { width: 13px; height: 13px; stroke-width: 3; }
.pin-resolving .pin-glyph:first-child { animation: pin-glyph-out 160ms ease-in both; }
.pin-resolving .pin-check { animation: pin-glyph-in 260ms 60ms cubic-bezier(0.34, 1.56, 0.64, 1) both; }
.pin-shine {
  position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
  background: linear-gradient(115deg, transparent 30%, rgba(255, 255, 255, 0.75) 50%, transparent 70%)
    100% 0 / 250% 100% no-repeat;
  animation: pin-shine 520ms var(--ease-out) both;
}
@keyframes pin-bloom { from { scale: 0; opacity: 0; } 30% { opacity: 1; } }
@keyframes pin-burst { from { scale: 0.08; opacity: 1; } to { scale: 1; opacity: 0; } }
@keyframes pin-lap {
  from { --tencil-rim: 220deg; opacity: 0; }
  15%, 75% { opacity: 1; }
  to { --tencil-rim: -140deg; opacity: 0; }
}
@keyframes pin-done { to { background-color: var(--done); border-color: white; } }
@keyframes pin-dissolve { to { translate: 0 -12px; scale: 1.15; opacity: 0; filter: blur(6px); } }
@keyframes pin-glyph-out { to { scale: 0.4; opacity: 0; filter: blur(2px); } }
@keyframes pin-glyph-in { from { scale: 0.4; opacity: 0; filter: blur(2px); } to { opacity: 1; } }
@keyframes pin-shine { to { background-position: 0 0; } }

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
.composer-measure {
  display: flex; align-items: center; gap: 6px; min-width: 0; padding: 0 2px;
  color: var(--n-600); font-size: 12px;
}
.composer-measure-label { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.composer-measure-target { color: var(--measure); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
.composer-measure .icon-button { width: 22px; height: 22px; flex: none; }
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

/* A provider's steps for the turn (Tencil Cloud: sandbox, clone, install, the agent's tool calls). */
.steps-toggle { display: inline-flex; align-items: center; gap: 6px; min-width: 0; color: var(--n-600); }
.steps-toggle:hover { color: var(--n-900); }
.steps-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
.steps-toggle svg { flex: none; color: var(--n-500); transition: transform 150ms var(--ease-out); }
.steps-toggle.open svg { transform: rotate(180deg); }
.steps {
  display: flex; flex-direction: column; gap: 6px; max-height: 220px; overflow-y: auto;
  margin: 0 2px 10px; padding: 10px 12px; list-style: none; border-radius: 0.875rem;
  background: var(--n-100); color: var(--n-700); font-size: 12px; line-height: 1rem;
}
.step { display: flex; align-items: center; gap: 8px; min-width: 0; }
.step-child { padding-left: 20px; color: var(--n-600); }
.step-mark { display: inline-grid; place-items: center; width: 12px; flex: none; color: var(--n-500); }
.step-mark svg { width: 12px; height: 12px; }
.step-done .step-mark { color: var(--done); }
.step-failed, .step-failed .step-mark { color: var(--error); }
.step-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.step-detail { margin-left: 6px; color: var(--n-500); font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0; }
.step-time { flex: none; color: var(--n-500); font-variant-numeric: tabular-nums; }

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
.settings-scrim {
  position: fixed; inset: 0; pointer-events: auto;
  background: rgba(0, 0, 0, 0.16);
  transition: opacity 180ms var(--ease-out);
  @starting-style { opacity: 0; }
}
.settings-panel {
  position: fixed; left: 50%; top: 50%; translate: -50% -50%;
  width: min(640px, calc(100vw - 32px)); height: min(440px, calc(100vh - 32px));
  display: grid; grid-template-columns: 176px 1fr; overflow: hidden; pointer-events: auto;
  background: var(--n-50); border-radius: var(--radius); box-shadow: var(--shadow);
  transition: opacity 180ms var(--ease-out), transform 180ms var(--ease-out);
  @starting-style { opacity: 0; transform: scale(0.98); }
}
.settings-nav {
  display: flex; flex-direction: column; gap: 14px; min-height: 0; overflow: hidden auto;
  padding: 14px 8px; background: var(--n-100); border-right: 1px solid var(--line);
}
.settings-title { display: flex; align-items: center; gap: 8px; padding: 0 8px; font-size: 14px; font-weight: 500; }
.settings-nav-group { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1px; }
.settings-nav-title {
  display: grid; margin: 0 0 4px; padding: 0 8px;
  color: var(--n-500); font-size: 11px; font-weight: 500;
}
.settings-nav-label { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.settings-nav-project { font-weight: 500; }
.settings-nav-item {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 5px 8px; border-radius: 8px; text-align: left; color: var(--n-700);
  transition: background-color 150ms ease, color 150ms ease;
}
.settings-nav-item.active { background: var(--surface); color: var(--n-950); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08); }
.settings-nav-item:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
/* Dark surfaces sit below the nav's grey: lift the selected page instead. */
.dark .settings-nav-item.active,
.dark .segmented .active,
.dark .settings-segmented label.active { background: var(--n-200); box-shadow: none; }
.settings-nav-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--accent); }
.settings-page { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.settings-body { overflow-y: auto; }
.settings-header {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 10px;
  padding: 14px 10px 12px 16px; border-bottom: 1px solid var(--line);
}
.settings-heading { display: grid; gap: 1px; min-width: 0; }
.settings-heading h2 { margin: 0; font-size: 14px; font-weight: 500; }
.settings-scope { color: var(--n-600); font-size: 12px; overflow-wrap: anywhere; }
.overview { gap: 18px; }
.overview-block { display: grid; gap: 8px; }
.detection { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.detection-badge {
  flex: none; padding: 1px 7px; border-radius: 999px; font-size: 11px; font-weight: 500;
  background: var(--n-100); color: var(--n-600); box-shadow: inset 0 0 0 1px var(--line);
}
.detection-picked { background: var(--accent-soft); color: var(--accent-text); box-shadow: none; }
.detection-reason { flex: 1; min-width: 160px; }
/* On their own row, under the reason. */
.detection-actions { display: flex; flex-basis: 100%; justify-content: flex-end; gap: 6px; }
.detection-button {
  padding: 3px 10px; border-radius: 8px; font-size: 12px; font-weight: 500; color: var(--n-700);
  background: var(--surface); box-shadow: 0 0 0 1px var(--line);
  transition: background-color 150ms ease, transform 160ms var(--ease-out);
}
.detection-button:active { transform: var(--press); }
.detection-button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.detection-picker { display: grid; gap: 8px; }
.detection-search {
  padding: 6px 10px; border: 0; border-radius: 8px; outline: none; font: inherit; font-size: 12px;
  background: var(--surface); color: var(--n-950); box-shadow: 0 0 0 1px var(--line);
}
.detection-search:focus { box-shadow: 0 0 0 1.5px var(--accent); }
.detection-list {
  display: grid; gap: 2px; max-height: 180px; overflow-y: auto; padding: 4px;
  border-radius: 10px; background: var(--surface); box-shadow: 0 0 0 1px var(--line);
}
.detection-list .settings-help { margin: 6px 8px; }
.detection-option { display: grid; gap: 1px; padding: 6px 8px; border-radius: 8px; text-align: left; }
.detection-option:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.detection-option-name { font-size: 12px; font-weight: 500; }
.detection-option-root {
  font-size: 11px; color: var(--n-500); white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; direction: rtl; text-align: left;
}
.settings-segmented { margin: 0; border: 0; min-width: 0; }
.settings-segmented label { padding: 3px 10px; border-radius: 7px; color: var(--n-600); font-size: 12px; cursor: pointer; }
.settings-segmented label.active { background: var(--surface); color: var(--n-950); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08); }
.settings-segmented input { position: absolute; opacity: 0; pointer-events: none; }
.settings-segmented label:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 1px; }
.shortcut-list { display: grid; margin: 4px 0 0; padding: 0; list-style: none; }
.shortcut-row {
  display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 4px 16px;
  padding: 8px 0; border-bottom: 1px solid var(--line);
}
.shortcut-key {
  min-width: 72px; height: 26px; padding: 0 8px; border-radius: 8px;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--surface); box-shadow: 0 0 0 1px var(--line);
  color: var(--n-600); font-size: 12px;
  transition: box-shadow 150ms ease, background-color 150ms ease;
}
.shortcut-key kbd { background: var(--n-100); color: var(--n-900); }
.shortcut-key.recording { color: var(--accent-text); background: var(--accent-soft); box-shadow: 0 0 0 1.5px var(--accent); }
.shortcut-key:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.shortcut-none { color: var(--n-500); }
.shortcut-message {
  grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px;
  margin: 0; color: var(--warn); font-size: 12px;
}
.shortcut-message-actions { display: inline-flex; gap: 4px; }
.shortcut-cancel { padding: 2px 8px; border-radius: 999px; color: var(--n-700); font-size: 12px; }
.shortcut-reset {
  justify-self: start; margin-top: 6px; padding: 4px 10px; border-radius: 8px;
  font-size: 12px; font-weight: 500; color: var(--n-700);
  background: var(--surface); box-shadow: 0 0 0 1px var(--line);
}
.shortcut-reset:disabled { opacity: 0.5; cursor: default; }
@media (max-width: 520px) {
  .settings-panel { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
  .settings-nav { flex-direction: row; align-items: flex-end; overflow: auto hidden; border-right: 0; border-bottom: 1px solid var(--line); }
  .settings-nav-project { max-width: 160px; }
  .settings-title, .settings-nav-title { display: none; }
  .settings-nav-group { display: flex; }
}
.settings-section { display: grid; gap: 6px; padding: 14px 16px 16px; }
.settings-section + .settings-section { border-top: 1px solid var(--line); }
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
  background: var(--surface); border-radius: 12px; box-shadow: 0 0 0 1px var(--line);
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
.settings-about-row { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.settings-version { color: var(--n-600); font-size: 12px; font-variant-numeric: tabular-nums; }
.settings-links { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.settings-link {
  display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 8px;
  font-size: 12px; font-weight: 500; color: var(--n-700); text-decoration: none;
  background: var(--surface); box-shadow: 0 0 0 1px var(--line);
  transition: background-color 150ms ease, color 150ms ease, transform 160ms var(--ease-out);
}
.settings-link:active { transform: var(--press); }
.settings-link:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.settings-star svg { color: #e3a008; fill: currentColor; }
.settings-debug { margin-top: 8px; border-top: 1px solid var(--line); padding-top: 8px; }
.settings-debug summary {
  display: inline-flex; align-items: center; gap: 4px; cursor: pointer; list-style: none;
  color: var(--n-600); font-size: 12px; font-weight: 500;
}
.settings-debug summary::-webkit-details-marker { display: none; }
.settings-debug summary svg { transform: rotate(-90deg); transition: transform 160ms var(--ease-out); }
.settings-debug[open] summary svg { transform: none; }
.settings-debug summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
.settings-debug-body {
  display: grid; gap: 10px; justify-items: start; margin-top: 8px; padding: 10px 12px;
  border-radius: 10px; background: var(--surface); box-shadow: 0 0 0 1px var(--line);
  font-size: 12px; color: var(--n-900);
}
.settings-debug-body .status-card-rows { width: 100%; }
.settings-debug-body .status-card-row dt, .settings-debug-body .status-card-muted { color: var(--n-500); }
.settings-debug-body .status-card-detail { margin: 0; color: var(--n-600); }
.settings-update { display: grid; gap: 8px; justify-items: start; }
.settings-help a { color: var(--accent); text-decoration: none; }
.settings-help a:hover { text-decoration: underline; }
.settings-update-button:disabled { opacity: 0.6; cursor: default; }
.settings-update-error { display: grid; gap: 6px; }
.settings-update-error .settings-help { color: var(--error); }
.settings-command {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 4px 4px 4px 10px; border-radius: 10px; background: var(--n-100);
}
.settings-command code { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.settings-copy {
  flex: none; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 500;
  background: var(--surface); box-shadow: 0 0 0 1px var(--line);
}

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
/* A toggle that's off, like the struck-through ruler: dimmed until hovered. */
.tool-off { color: rgba(255, 255, 255, 0.35); }
.tool-send { background: var(--accent); color: white; }
.tool-send:disabled { opacity: 0.5; cursor: default; }
.tool:disabled { opacity: 0.45; cursor: default; }
.tool-dot {
  position: absolute; top: 6px; right: 6px; width: 6px; height: 6px; border-radius: 999px;
  background: var(--accent);
}
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
/* No toolbar to stand above when the dock is hidden. */
.toast-info {
  bottom: 20px; display: flex; align-items: center; gap: 8px; padding-right: 6px;
  color: var(--n-900); white-space: nowrap;
}
.toast-info kbd, .settings-help kbd { background: var(--n-100); color: var(--n-700); }

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
  .settings-nav-item:not(.active):hover { background: var(--n-200); color: var(--n-950); }
  .dark .settings-nav-item:not(.active):hover { background: rgba(255, 255, 255, 0.04); }
  .settings-link:hover { background: var(--n-100); color: var(--n-950); }
  .detection-button:hover, .detection-option:hover { background: var(--n-100); }
  .shortcut-key:not(.recording):hover, .shortcut-reset:not(:disabled):hover, .shortcut-cancel:hover { background: var(--n-100); }
  .md a:hover { opacity: 0.8; }
}

/* Reduced motion keeps fades (they aid comprehension) but drops movement. */
@media (prefers-reduced-motion: reduce) {
  .popover, .inbox, .toast, .toolbar-hint, .settings-panel, .message-user, .pin-body,
  .tool, .icon-button, .toggle, .stop, .send, .segmented button, .inbox-item {
    transition-property: opacity, background-color, color;
  }
  .w { animation: none; }
  .pin-working .pin-body::before, .pin-working .pin-body::after { animation-duration: 6s; }
  .pin-draft::before, .pin-resolving::before, .pin-draft .pin-body::before, .pin-shine { display: none; }
  @keyframes pin-bloom { from { opacity: 0; } }
  @keyframes pin-dissolve { to { opacity: 0; } }
  .shimmer > span[aria-hidden], .status-ping, .live-dot { animation: none; }
}
`;
