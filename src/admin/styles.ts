/** Inlined into the admin shell. Mobile-first — this is used one-handed. */
export const ADMIN_CSS = `
:root {
  color-scheme: light dark;
  --bg: #f4f4f5;
  --card: #ffffff;
  --ink: #18181b;
  --muted: #71717a;
  --line: #e4e4e7;
  --accent: #2563eb;
  --live: #059669;
  --warn: #dc2626;
  --radius: 14px;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #09090b;
    --card: #18181b;
    --ink: #fafafa;
    --muted: #a1a1aa;
    --line: #27272a;
    --accent: #60a5fa;
    --live: #34d399;
    --warn: #f87171;
  }
}
* { box-sizing: border-box; }
/* Must outrank .row's display:flex, or [hidden] silently does nothing. */
[hidden] { display: none !important; }
body {
  margin: 0;
  padding: 16px 16px 64px;
  background: var(--bg);
  color: var(--ink);
  font: 16px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  -webkit-text-size-adjust: 100%;
}
main { max-width: 560px; margin: 0 auto; display: grid; gap: 14px; }
.card {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 14px;
}
h2 {
  margin: 0 0 10px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--muted);
}

/* The live-state card. You open this to check as often as to change. */
.live { border-left: 4px solid var(--live); }
.live .src {
  font-size: 12px; font-weight: 700; letter-spacing: .08em;
  text-transform: uppercase; color: var(--live);
}
.live .url {
  margin: 6px 0; font-size: 19px; font-weight: 600;
  overflow-wrap: anywhere; line-height: 1.25;
}
.live .meta { font-size: 13px; color: var(--muted); }
#countdown { font-variant-numeric: tabular-nums; font-weight: 600; color: var(--ink); }

button, .btn {
  font: inherit;
  border: 1px solid var(--line);
  background: var(--bg);
  color: var(--ink);
  border-radius: 10px;
  padding: 11px 14px;
  cursor: pointer;
  min-height: 44px;
}
button:active { transform: translateY(1px); }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
button.danger  { background: var(--warn); border-color: var(--warn); color: #fff; }
button.ghost   { background: transparent; }
button[disabled] { opacity: .5; cursor: default; }

.row { display: flex; gap: 8px; flex-wrap: wrap; }
.row > * { flex: 1 1 auto; }
.grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
input[type=text], input[type=password], input[type=url] {
  font: inherit; width: 100%; padding: 11px 12px; min-height: 44px;
  border: 1px solid var(--line); border-radius: 10px;
  background: var(--bg); color: var(--ink);
}
label.field { display: grid; gap: 6px; font-size: 13px; color: var(--muted); }

.list { display: grid; gap: 6px; }
.item {
  display: flex; align-items: center; gap: 8px;
  border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px;
}
.item .name { flex: 1; min-width: 0; overflow-wrap: anywhere; font-size: 14px; }
.item .sub { display: block; font-size: 12px; color: var(--muted); }
.item button { min-height: 36px; padding: 6px 10px; flex: 0 0 auto; }

.toggle { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.toggle .desc { font-size: 13px; color: var(--muted); }
.switch { position: relative; width: 56px; height: 32px; flex: 0 0 auto; }
.switch input { opacity: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; }
.switch span {
  position: absolute; inset: 0; border-radius: 999px;
  background: var(--line); transition: background .15s; pointer-events: none;
}
.switch span::after {
  content: ""; position: absolute; top: 3px; left: 3px;
  width: 26px; height: 26px; border-radius: 50%; background: #fff;
  transition: transform .15s;
}
.switch input:checked + span { background: var(--live); }
.switch input:checked + span::after { transform: translateX(24px); }

#toast {
  position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%) translateY(120%);
  background: var(--ink); color: var(--bg);
  padding: 10px 16px; border-radius: 999px; font-size: 14px;
  transition: transform .2s; z-index: 10; max-width: 90vw;
}
#toast.show { transform: translateX(-50%) translateY(0); }
#toast.err { background: var(--warn); color: #fff; }

.login { max-width: 340px; margin: 18vh auto; display: grid; gap: 12px; }
.hint { font-size: 12px; color: var(--muted); }
@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; animation: none !important; }
}
`;
