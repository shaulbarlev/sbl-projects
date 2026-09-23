/**
 * Inlined into the admin shell.
 *
 * Layout is a fixed status bar, a scrolling panel, and a bottom tab bar. The
 * tabs are at the bottom because this is used one-handed on a large phone and
 * the top of the screen is out of thumb reach.
 *
 * The look is neobrutalist: hard black edges, offset shadows with no blur,
 * square corners, heavy type, flat saturated colour. Two rules keep that from
 * fighting the product:
 *
 * - **State is carried by a filled tag, never by coloured text.** Small bold
 *   uppercase in a mid-tone green or amber is exactly the case where thin
 *   coloured type fails contrast. Black on a bright fill passes everywhere and
 *   is louder anyway.
 * - **No web fonts.** This ships on the critical path of a phone in a hurry,
 *   and the whole app is built to cost zero extra round trips. Helvetica is
 *   already on every Apple device this is used from.
 *
 * Helvetica ships Regular, Medium and Bold and nothing between: 600, 700, 800
 * and 900 all render as the same Bold face. So the weight ladder here is only
 * 500/700, and hierarchy is carried by size, tracking and case instead.
 */
export const ADMIN_CSS = `
:root {
  color-scheme: light dark;
  --bg: #fdf6e3;
  --card: #ffffff;
  --ink: #000000;
  --muted: #3f3f46;
  --faint: #52525b;
  /* Every border and every shadow is this colour. It is the whole style. */
  --edge: #000000;
  --line: #000000;
  --field: #ffffff;
  --sunk: #ebe7d9;
  /* Tags always print black text, so their neutral fill has to stay light in
     both schemes — --sunk goes near-black in dark and would swallow it. */
  --tag: #e6e1cd;
  --accent: #2b5cff;
  --live: #22c55e;
  --seq: #a855f7;
  --warn: #ff4d4d;
  --amber: #fbbf24;
  --radius: 0px;
  --bar: 62px;
  --edge-w: 2.5px;
  --drop: 4px;
  --shadow: var(--drop) var(--drop) 0 var(--edge);
  --shadow-sm: 3px 3px 0 var(--edge);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #121214;
    --card: #1e1e22;
    --ink: #fafafa;
    --muted: #d4d4d8;
    --faint: #a1a1aa;
    /* Inverted: on a dark ground the hard edge has to be the light one, or
       the borders and the shadows both vanish into the background. */
    --edge: #fafafa;
    --line: #fafafa;
    --field: #2a2a30;
    --sunk: #0b0b0d;
    --tag: #d4d4d8;
  }
}
* { box-sizing: border-box; }
/* Must outrank .row's display:flex, or [hidden] silently does nothing. */
[hidden] { display: none !important; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font: 16px/1.4 "Helvetica Neue", Helvetica, Arial, sans-serif;
  font-weight: 500;
  -webkit-text-size-adjust: 100%;
  padding-bottom: calc(var(--bar) + env(safe-area-inset-bottom) + 20px);
}

/* Keyboard focus has to survive a design with no soft states left in it. */
:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 2px;
}

/* A filled, bordered tag. Carries every bit of state colour in the app. */
.tag {
  display: inline-block;
  padding: 2px 7px;
  border: var(--edge-w) solid var(--edge);
  background: var(--tag);
  color: #000;
  font-size: 10px; font-weight: 700; letter-spacing: .08em;
  text-transform: uppercase;
  max-width: 100%;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
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
  padding: 10px 14px;
  padding-top: max(10px, env(safe-area-inset-top));
  background: var(--card);
  border-bottom: var(--edge-w) solid var(--edge);
  cursor: pointer;
}
#status .dot {
  width: 14px; height: 14px; flex: 0 0 auto;
  border: var(--edge-w) solid var(--edge);
  background: var(--sunk);
}
#status.is-temp .dot { background: var(--live); }
#status.is-sequence .dot { background: var(--seq); }
#status.is-fallback .dot { background: var(--amber); }
#status .text { flex: 1; min-width: 0; }
#status .kicker {
  /* Block, not inline: overflow and text-overflow do nothing on an inline box,
     so a long URL would run off the edge instead of truncating. */
  display: inline-block;
  padding: 1px 6px;
  border: 2px solid var(--edge);
  background: var(--tag);
  color: #000;
  font-size: 10px; font-weight: 700; letter-spacing: .1em;
  text-transform: uppercase;
  max-width: 100%;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
#status.is-temp .kicker { background: var(--live); }
#status.is-sequence .kicker { background: var(--seq); }
#status.is-fallback .kicker { background: var(--amber); }
#status .now {
  display: block;
  margin-top: 3px;
  font-size: 14px; font-weight: 700;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
#status .timer {
  font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums;
  color: var(--ink); flex: 0 0 auto;
}

/* ---------------------------------------------------------------- layout */
main { max-width: 560px; margin: 0 auto; padding: 16px 16px 8px; }
.panel { display: grid; gap: 22px; }
/* A grid item will not shrink below its content's minimum on its own: without this a
   ten-image strip (which scrolls sideways) widens the whole tab past the phone. */
.panel > section { min-width: 0; }
.panel[hidden] { display: none; }

section > h2 {
  margin: 0 0 10px 0;
  font-size: 13px; font-weight: 700; letter-spacing: .12em;
  text-transform: uppercase; color: var(--ink);
}
section > .sub {
  margin: -6px 0 10px;
  font-size: 12.5px; color: var(--faint); font-weight: 500;
}
.card {
  background: var(--card);
  border: var(--edge-w) solid var(--edge);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 14px;
}
/* Offset shadows need room to land, or the next block sits on top of them. */
.card + .card { margin-top: 14px; }

/* ------------------------------------------------------------- live card */
.live { border-left-width: 12px; }
.live.is-temp { border-left-color: var(--live); }
.live.is-sequence { border-left-color: var(--seq); }
.live.is-fallback { border-left-color: var(--amber); }
.live .src, #seq-state {
  display: inline-block;
  padding: 2px 7px;
  border: var(--edge-w) solid var(--edge);
  background: var(--tag);
  color: #000;
  font-size: 11px; font-weight: 700; letter-spacing: .1em;
  text-transform: uppercase;
}
.live.is-temp .src { background: var(--live); }
.live.is-sequence .src { background: var(--seq); }
.live.is-fallback .src { background: var(--amber); }
.live .url {
  margin: 10px 0 6px; font-size: 21px; font-weight: 700;
  overflow-wrap: anywhere; line-height: 1.15; letter-spacing: -.01em;
}
.live .meta, #seq-meta { font-size: 13px; color: var(--faint); }
.live .meta b, #seq-meta b { color: var(--ink); font-weight: 700; }
#countdown { font-variant-numeric: tabular-nums; font-weight: 700; color: var(--ink); }

/* Progress pips for a live sequence: how many of the four have scanned. */
.pips { display: flex; gap: 5px; margin: 12px 0 2px; }
.pip {
  height: 12px; flex: 1;
  border: 2px solid var(--edge); background: var(--sunk);
}
.pip.done { background: var(--seq); }

/* -------------------------------------------------------------- controls */
/* The press is the whole interaction: the button travels into its own shadow
   and the shadow disappears, so it reads as physically pushed down. */
button, .btn {
  font: inherit;
  font-weight: 700;
  border: var(--edge-w) solid var(--edge);
  background: var(--field);
  color: var(--ink);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
  padding: 11px 14px;
  cursor: pointer;
  min-height: 46px;
  text-align: center;
  text-decoration: none;
  transition: transform .06s, box-shadow .06s;
}
button:active, .btn:active {
  transform: translate(3px, 3px);
  box-shadow: 0 0 0 var(--edge);
}
button.primary { background: var(--accent); border-color: var(--edge); color: #fff; }
button.danger  { background: var(--warn); border-color: var(--edge); color: #000; }
button.seq     { background: var(--seq); border-color: var(--edge); color: #000; }
button.ghost   { background: var(--card); }
button[disabled] {
  opacity: 1;
  background: var(--sunk); color: var(--faint);
  box-shadow: none; transform: none;
  cursor: default;
}

.row { display: flex; gap: 10px; flex-wrap: wrap; }
.row > * { flex: 1 1 auto; }
.grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.chip { padding: 10px 4px; font-size: 15px; font-weight: 700; }

input[type=text], input[type=password], textarea {
  font: inherit; font-weight: 500;
  width: 100%; padding: 11px 12px; min-height: 46px;
  border: var(--edge-w) solid var(--edge); border-radius: var(--radius);
  background: var(--field); color: var(--ink);
  box-shadow: inset 2px 2px 0 rgba(0,0,0,.07);
  -webkit-appearance: none;
}
input::placeholder, textarea::placeholder { color: var(--faint); font-weight: 500; }
textarea { min-height: 78px; resize: vertical; line-height: 1.35; }
label.field {
  display: grid; gap: 6px;
  font-size: 11px; font-weight: 700; letter-spacing: .06em;
  text-transform: uppercase; color: var(--faint);
}
.stack { display: grid; gap: 10px; }

/* ----------------------------------------------------------------- lists */
.list { display: grid; gap: 10px; }
.list > * { min-width: 0; } /* same reason as .panel > section */
.item {
  display: flex; align-items: center; gap: 10px;
  border: var(--edge-w) solid var(--edge); border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
  padding: 10px;
  background: var(--card);
}
.item .name { flex: 1; min-width: 0; overflow-wrap: anywhere; font-size: 14px; font-weight: 700; }
.item .sub, .sheet-head .sub {
  display: block; margin-top: 2px;
  font-size: 11px; font-weight: 500; letter-spacing: .05em;
  text-transform: uppercase; color: var(--faint);
}
.item button { min-height: 40px; padding: 7px 12px; flex: 0 0 auto; font-size: 14px; }
.item .idx {
  flex: 0 0 auto; width: 26px; height: 26px;
  border: 2px solid var(--edge);
  display: grid; place-items: center;
  background: var(--sunk); color: var(--ink);
  font-size: 12px; font-weight: 700;
}
.item .preview {
  flex: 0 0 auto; width: 44px; height: 44px; object-fit: cover; display: block;
  border: var(--edge-w) solid var(--edge); background: var(--sunk);
}
.item.claimed { opacity: .55; }
.item.claimed .idx { background: var(--seq); color: #000; }
.item.next { box-shadow: var(--drop) var(--drop) 0 var(--seq); }

/* ------------------------------------------------------------ image sets */
.pool + .pool { margin-top: 14px; }
.strip {
  display: flex; gap: 10px; margin-top: 12px;
  overflow-x: auto; padding: 2px 4px 6px 2px;
  /* The set can hold plenty; it scrolls sideways rather than pushing the
     Files section off the bottom of the screen. */
  -webkit-overflow-scrolling: touch;
}
.thumb { position: relative; flex: 0 0 auto; }
.thumb img {
  width: 66px; height: 66px; object-fit: cover;
  border: var(--edge-w) solid var(--edge); display: block;
  box-shadow: var(--shadow-sm);
  background: var(--sunk);
}
.thumb button {
  position: absolute; top: -8px; right: -8px;
  min-height: 24px; height: 24px; width: 24px; padding: 0;
  border: 2px solid var(--edge); box-shadow: none;
  font-size: 12px; font-weight: 700; line-height: 1;
  background: var(--warn); color: #000;
}

/* ------------------------------------------------------------------ gifs */
.gifs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 12px; }
.gifs:empty { display: none; }
.gifs button { padding: 0; min-height: 0; aspect-ratio: 1; overflow: hidden; background: var(--sunk); }
.gifs img { width: 100%; height: 100%; object-fit: cover; display: block; }

.empty {
  font-size: 13px; font-weight: 700; color: var(--faint);
  padding: 14px; text-align: center;
  border: var(--edge-w) dashed var(--edge);
  background: var(--card);
}

/* ---------------------------------------------------------------- toggle */
.toggle { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.toggle strong { font-weight: 700; }
.toggle .desc { font-size: 13px; color: var(--faint); margin-top: 4px; }
.switch { position: relative; width: 62px; height: 34px; flex: 0 0 auto; }
.switch input { opacity: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; }
.switch span {
  position: absolute; inset: 0;
  border: var(--edge-w) solid var(--edge);
  background: var(--sunk); transition: background .12s; pointer-events: none;
}
/* Solid ink knob, not a pale one: against a cream "off" track a white knob
   is the same value as its groove and the state stops being readable. */
.switch span::after {
  content: ""; position: absolute; top: 2px; left: 2px;
  width: 24px; height: 24px; background: var(--edge);
  transition: transform .12s;
}
.switch input:checked + span { background: var(--live); }
.switch input:checked + span::after { transform: translateX(28px); }
.switch input:focus-visible + span { outline: 3px solid var(--accent); outline-offset: 2px; }

/* -------------------------------------------------------------- tab bar */
#tabs {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 6;
  display: grid; grid-template-columns: repeat(4, 1fr);
  background: var(--card);
  border-top: var(--edge-w) solid var(--edge);
  padding-bottom: env(safe-area-inset-bottom);
}
#tabs button {
  border: 0; border-right: 2px solid var(--edge);
  background: none; border-radius: 0; box-shadow: none;
  display: grid; gap: 3px; justify-items: center; align-content: center;
  padding: 8px 2px; min-height: var(--bar);
  color: var(--faint); font-size: 10px; font-weight: 700;
  letter-spacing: .04em; text-transform: uppercase;
}
#tabs button:last-child { border-right: 0; }
#tabs button:active { transform: none; box-shadow: none; }
#tabs button svg { width: 23px; height: 23px; stroke: currentColor; fill: none; stroke-width: 2.4; }
/* The current tab is a filled block, not a tint — at 10px, colour alone is
   not a strong enough signal to find with a thumb. */
#tabs button[aria-selected="true"] { background: var(--accent); color: #fff; }
#tabs button .badge {
  position: absolute; transform: translate(15px, -6px);
  min-width: 20px; height: 20px; padding: 0 4px;
  border: 2px solid var(--edge);
  background: var(--seq); color: #000;
  font-size: 11px; font-weight: 700; line-height: 16px;
}

/* ------------------------------------------------------------ send sheet */
/* Anchored to the bottom, above the tab bar: this is the one control the
   thumb has to reach on a large phone held one-handed. */
#sheet-backdrop {
  position: fixed; inset: 0; z-index: 9;
  background: rgba(0,0,0,.5);
}
#sheet {
  position: fixed; left: 0; right: 0; z-index: 10;
  bottom: calc(var(--bar) + env(safe-area-inset-bottom));
  background: var(--card);
  /* A hard offset shadow pointing up would read as a second panel; the slab
     edge does the lifting instead. */
  border-top: 5px solid var(--edge);
  border-radius: var(--radius);
  padding: 8px 16px calc(16px + env(safe-area-inset-bottom));
  transform: translateY(100%);
  transition: transform .18s ease-out;
  max-height: 78vh; overflow-y: auto;
}
#sheet.open { transform: translateY(0); }
.sheet-grab {
  width: 46px; height: 6px;
  background: var(--edge); margin: 4px auto 12px;
}
.sheet-head {
  display: flex; align-items: flex-start; gap: 10px;
  padding-bottom: 14px; margin-bottom: 14px;
  border-bottom: var(--edge-w) dashed var(--edge);
}
.sheet-head .name { flex: 1 1 auto; min-width: 0; font-weight: 700; overflow-wrap: anywhere; }
.sheet-head .ghost { flex: 0 0 auto; }
#sheet .row > button { flex: 1 1 0; }

/* ---------------------------------------------------------------- toast */
#toast {
  position: fixed; left: 50%; z-index: 20;
  bottom: calc(var(--bar) + env(safe-area-inset-bottom) + 16px);
  transform: translateX(-50%) translateY(200%);
  background: var(--amber); color: #000;
  border: var(--edge-w) solid var(--edge);
  box-shadow: var(--shadow);
  padding: 11px 16px; font-size: 14px; font-weight: 700;
  max-width: 90vw; text-align: center;
  /* Slid out of the way is not the same as gone: an empty toast is still a
     bordered slab, and translating it by its own small height did not clear
     the tab bar. Visibility hides it outright between messages, delayed so
     the slide out still plays. */
  visibility: hidden; pointer-events: none;
  transition: transform .2s, visibility 0s .2s;
}
#toast.show {
  transform: translateX(-50%) translateY(0);
  visibility: visible;
  transition: transform .2s;
}
#toast.err { background: var(--warn); color: #000; }

/* ---------------------------------------------------------------- login */
.login { max-width: 340px; margin: 16vh auto; display: grid; gap: 14px; }
.hint { font-size: 12px; color: var(--faint); margin: 8px 0 0; font-weight: 500; }
.qr {
  width: 100%; max-width: 220px; display: block; margin: 0 auto;
  border: var(--edge-w) solid var(--edge); box-shadow: var(--shadow);
  background: #fff; padding: 10px;
}

@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; animation: none !important; }
}
`;
