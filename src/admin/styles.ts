/**
 * Inlined into the admin shell.
 *
 * Layout is a fixed status bar, a scrolling panel, and a bottom tab bar. The
 * tabs are at the bottom because this is used one-handed on a large phone and
 * the top of the screen is out of thumb reach.
 */
export const ADMIN_CSS = `
:root {
  color-scheme: light dark;
  --bg: #f4f4f5;
  --card: #ffffff;
  --ink: #18181b;
  --muted: #71717a;
  --faint: #a1a1aa;
  --line: #e4e4e7;
  --field: #f4f4f5;
  --accent: #2563eb;
  --live: #059669;
  --seq: #7c3aed;
  --warn: #dc2626;
  --amber: #b45309;
  --radius: 14px;
  --bar: 60px;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #09090b;
    --card: #18181b;
    --ink: #fafafa;
    --muted: #a1a1aa;
    --faint: #71717a;
    --line: #27272a;
    --field: #232326;
    --accent: #60a5fa;
    --live: #34d399;
    --seq: #a78bfa;
    --warn: #f87171;
    --amber: #fbbf24;
  }
}
* { box-sizing: border-box; }
/* Must outrank .row's display:flex, or [hidden] silently does nothing. */
[hidden] { display: none !important; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font: 16px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  -webkit-text-size-adjust: 100%;
  padding-bottom: calc(var(--bar) + env(safe-area-inset-bottom) + 16px);
}

/* ------------------------------------------------------------ status bar */
/* Always visible. You open this app to check as often as to change, and the
   answer should never be more than a glance away, whichever tab you are on. */
#status {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px calc(10px + env(safe-area-inset-top));
  padding-top: max(10px, env(safe-area-inset-top));
  background: var(--card);
  border-bottom: 1px solid var(--line);
  cursor: pointer;
}
#status .dot {
  width: 10px; height: 10px; border-radius: 50%;
  background: var(--muted); flex: 0 0 auto;
}
#status.is-temp .dot { background: var(--live); }
#status.is-sequence .dot { background: var(--seq); }
#status.is-fallback .dot { background: var(--amber); }
#status .text { flex: 1; min-width: 0; }
#status .kicker {
  /* Block, not inline: overflow and text-overflow do nothing on an inline box,
     so a long URL would run off the edge instead of truncating. */
  display: block;
  font-size: 10px; font-weight: 700; letter-spacing: .1em;
  text-transform: uppercase; color: var(--muted);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
#status.is-temp .kicker { color: var(--live); }
#status.is-sequence .kicker { color: var(--seq); }
#status.is-fallback .kicker { color: var(--amber); }
#status .now {
  display: block;
  font-size: 14px; font-weight: 600;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
#status .timer {
  font-size: 13px; font-variant-numeric: tabular-nums;
  color: var(--muted); flex: 0 0 auto;
}

/* ---------------------------------------------------------------- layout */
main { max-width: 560px; margin: 0 auto; padding: 14px; }
.panel { display: grid; gap: 18px; }
.panel[hidden] { display: none; }

section > h2 {
  margin: 0 0 8px 2px;
  font-size: 11px; font-weight: 700; letter-spacing: .09em;
  text-transform: uppercase; color: var(--muted);
}
section > .sub {
  margin: -4px 2px 8px;
  font-size: 12px; color: var(--faint);
}
.card {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 14px;
}
.card + .card { margin-top: 8px; }

/* ------------------------------------------------------------- live card */
.live { border-left: 4px solid var(--muted); }
.live.is-temp { border-left-color: var(--live); }
.live.is-sequence { border-left-color: var(--seq); }
.live.is-fallback { border-left-color: var(--amber); }
.live .src {
  font-size: 11px; font-weight: 700; letter-spacing: .09em;
  text-transform: uppercase; color: var(--muted);
}
.live.is-temp .src { color: var(--live); }
.live.is-sequence .src { color: var(--seq); }
.live.is-fallback .src { color: var(--amber); }
.live .url {
  margin: 6px 0; font-size: 20px; font-weight: 650;
  overflow-wrap: anywhere; line-height: 1.2;
}
.live .meta { font-size: 13px; color: var(--muted); }
.live .meta b { color: var(--ink); font-weight: 600; }
#countdown { font-variant-numeric: tabular-nums; font-weight: 600; color: var(--ink); }

/* Progress pips for a live sequence: how many of the four have scanned. */
.pips { display: flex; gap: 5px; margin: 10px 0 2px; }
.pip { height: 5px; flex: 1; border-radius: 3px; background: var(--line); }
.pip.done { background: var(--seq); }

/* -------------------------------------------------------------- controls */
button, .btn {
  font: inherit;
  border: 1px solid var(--line);
  background: var(--field);
  color: var(--ink);
  border-radius: 10px;
  padding: 11px 14px;
  cursor: pointer;
  min-height: 44px;
  text-align: center;
  text-decoration: none;
}
button:active { transform: translateY(1px); }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
button.danger  { background: var(--warn); border-color: var(--warn); color: #fff; }
button.seq     { background: var(--seq); border-color: var(--seq); color: #fff; }
button.ghost   { background: transparent; }
button[disabled] { opacity: .45; cursor: default; }

.row { display: flex; gap: 8px; flex-wrap: wrap; }
.row > * { flex: 1 1 auto; }
.grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.chip { padding: 10px 6px; font-size: 15px; }

input[type=text], input[type=password], textarea {
  font: inherit; width: 100%; padding: 11px 12px; min-height: 44px;
  border: 1px solid var(--line); border-radius: 10px;
  background: var(--field); color: var(--ink);
  -webkit-appearance: none;
}
textarea { min-height: 76px; resize: vertical; line-height: 1.35; }
label.field { display: grid; gap: 6px; font-size: 12px; color: var(--muted); }
.stack { display: grid; gap: 8px; }

/* ----------------------------------------------------------------- lists */
.list { display: grid; gap: 6px; }
.item {
  display: flex; align-items: center; gap: 8px;
  border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px;
  background: var(--card);
}
.item .name { flex: 1; min-width: 0; overflow-wrap: anywhere; font-size: 14px; }
.item .sub { display: block; font-size: 12px; color: var(--faint); }
.item button { min-height: 36px; padding: 6px 10px; flex: 0 0 auto; font-size: 14px; }
.item .idx {
  flex: 0 0 auto; width: 22px; height: 22px; border-radius: 50%;
  display: grid; place-items: center;
  background: var(--field); color: var(--muted);
  font-size: 11px; font-weight: 700;
}
.item.claimed { opacity: .5; }
.item.claimed .idx { background: var(--seq); color: #fff; }
.item.next { border-color: var(--seq); box-shadow: 0 0 0 1px var(--seq); }

.empty {
  font-size: 13px; color: var(--faint);
  padding: 10px; text-align: center;
  border: 1px dashed var(--line); border-radius: 10px;
}

/* ---------------------------------------------------------------- toggle */
.toggle { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.toggle .desc { font-size: 13px; color: var(--muted); margin-top: 2px; }
.switch { position: relative; width: 56px; height: 32px; flex: 0 0 auto; }
.switch input { opacity: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; }
.switch span {
  position: absolute; inset: 0; border-radius: 999px;
  background: var(--line); transition: background .15s; pointer-events: none;
}
.switch span::after {
  content: ""; position: absolute; top: 3px; left: 3px;
  width: 26px; height: 26px; border-radius: 50%; background: #fff;
  transition: transform .15s; box-shadow: 0 1px 3px rgba(0,0,0,.3);
}
.switch input:checked + span { background: var(--live); }
.switch input:checked + span::after { transform: translateX(24px); }

/* -------------------------------------------------------------- tab bar */
#tabs {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 6;
  display: grid; grid-template-columns: repeat(4, 1fr);
  background: var(--card);
  border-top: 1px solid var(--line);
  padding-bottom: env(safe-area-inset-bottom);
}
#tabs button {
  border: 0; background: none; border-radius: 0;
  display: grid; gap: 2px; justify-items: center;
  padding: 8px 2px; min-height: var(--bar);
  color: var(--muted); font-size: 10px; font-weight: 600;
  letter-spacing: .02em;
}
#tabs button svg { width: 22px; height: 22px; stroke: currentColor; fill: none; stroke-width: 1.7; }
#tabs button[aria-selected="true"] { color: var(--accent); }
#tabs button .badge {
  position: absolute; transform: translate(14px, -4px);
  min-width: 16px; height: 16px; padding: 0 4px;
  border-radius: 8px; background: var(--seq); color: #fff;
  font-size: 10px; line-height: 16px;
}

/* ---------------------------------------------------------------- toast */
#toast {
  position: fixed; left: 50%; z-index: 20;
  bottom: calc(var(--bar) + env(safe-area-inset-bottom) + 14px);
  transform: translateX(-50%) translateY(180%);
  background: var(--ink); color: var(--bg);
  padding: 10px 16px; border-radius: 999px; font-size: 14px;
  transition: transform .2s; max-width: 90vw; text-align: center;
}
#toast.show { transform: translateX(-50%) translateY(0); }
#toast.err { background: var(--warn); color: #fff; }

/* ---------------------------------------------------------------- login */
.login { max-width: 340px; margin: 18vh auto; display: grid; gap: 12px; }
.hint { font-size: 12px; color: var(--faint); margin: 6px 2px 0; }
.qr { width: 100%; max-width: 220px; display: block; margin: 0 auto;
      border-radius: 10px; background: #fff; padding: 8px; }

@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; animation: none !important; }
}
`;
