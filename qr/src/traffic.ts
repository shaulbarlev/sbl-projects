import { escapeHtml } from './html';
import embed from '../../shared/embed.js';

/**
 * The traffic light: two lamps, top to bottom, each one switch at home.
 *
 * Fixed on purpose. The agent at home carries the same allowlist, so a
 * compromised Worker can still only reach these two switches, and only to
 * toggle them.
 */
export const LIGHTS = [
  { entity: 'switch.traffic_1_power1', label: 'Green', color: '#22c55e' },
  { entity: 'switch.tasmota', label: 'Orange', color: '#f59e0b' },
] as const;

/**
 * The party button under the light: one input_boolean at home. Shown only
 * while its own switch is on, and tappable only then.
 */
export const PARTY = { entity: 'input_boolean.party', label: 'Party', color: '#e879f9' } as const;

export const LIGHT_ENTITIES: ReadonlySet<string> = new Set(LIGHTS.map((l) => l.entity));
/** Everything a tap may name: the lamps and the party button. */
export const HOME_ENTITIES: ReadonlySet<string> = new Set([...LIGHT_ENTITIES, PARTY.entity]);

/**
 * The page a `traffic` target renders, at /traffic and as a root takeover.
 *
 * Everything is inlined, like the message page: this opens on a phone that
 * just scanned a code. No words on it: two lamps, lit or dim, and dimmed
 * further when home cannot be reached. State arrives over a socket as it
 * changes, with HTTP polling as the fallback.
 *
 * `bare` is the same page for embedding elsewhere (the portfolio's map sets it
 * in an iframe): no background, laid out to its content rather than the
 * viewport, and talking to the page around it: it reports its height and its
 * text fields (so the frame can be sized to the light and a cover left off
 * the fields), and takes a tap relayed from a cover over the frame, since
 * what is under the finger there is the only way for the map to tell a drag
 * from a tap. No background, so it sits on whatever is behind it. One page, one
 * script, wherever the light is shown.
 */
export function renderTraffic(bare = false): string {
  const lamps = LIGHTS.map(
    (l) => `<button class="lamp" data-entity="${escapeHtml(l.entity)}" style="--c:${l.color}"
      aria-label="${l.label} light" aria-pressed="false" disabled onclick="return false"></button>`,
  ).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#0a0a0a">
<title>Traffic light</title>
<style>
  html, body { height: 100%; margin: 0; }
  /* Dark like the pages that embed it: a scheme mismatch makes a browser paint the frame opaque. */
  html { color-scheme: dark; }
  body {
    display: grid; place-items: center; gap: 0;
    background: ${bare ? 'transparent' : '#0a0a0a'}; color: #a3a3a3;
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    -webkit-text-size-adjust: 100%; -webkit-tap-highlight-color: transparent;
  }
  main { display: grid; justify-items: center; gap: 22px; }
  .housing {
    display: grid; gap: 22px; padding: 26px;
    /* A shade under full: the lit lamps were glaring in a dark hallway. */
    filter: brightness(.85);
    background: #1c1c1e; border-radius: 40px;
    border: 3px solid #000;
    box-shadow: 0 30px 60px rgba(0,0,0,.6), inset 0 2px 0 rgba(255,255,255,.06);
  }
  .lamp {
    width: min(38vw, 190px); height: min(38vw, 190px);
    border-radius: 50%; border: 0; padding: 0; cursor: pointer;
    background: color-mix(in srgb, var(--c) 22%, #111);
    box-shadow: inset 0 8px 18px rgba(0,0,0,.7);
    transition: background .15s, box-shadow .15s, transform .08s;
  }
  .lamp:active { transform: scale(.97); }
  .lamp[aria-pressed="true"] {
    background: radial-gradient(circle at 40% 35%, #fff9 0, var(--c) 28%, var(--c) 100%);
    box-shadow: 0 0 40px 10px color-mix(in srgb, var(--c) 60%, transparent),
                inset 0 -6px 14px rgba(0,0,0,.25);
  }
  .lamp[disabled] { cursor: default; opacity: .45; }
  .lamp.busy { opacity: .7; }
  /* While the name is being asked, the lamps are held: they dim and a tap
     goes to the field instead of the lights. */
  body.gated .lamp { opacity: .4; cursor: default; }
  body.gated .who input { border-color: #3a3a3c; }

  /* The party button: a smaller housing, a dim magenta lamp off, a mirror
     ball on. Hidden until home says the button is enabled. */
  .housing.mini { padding: 18px; border-radius: 30px; }
  .housing.mini[hidden] { display: none; }
  .party {
    --c: ${PARTY.color}; --gc: var(--c);
    width: min(22vw, 110px); height: min(22vw, 110px);
    border-radius: 50%; border: 0; padding: 0; cursor: pointer; position: relative;
    background: color-mix(in srgb, var(--c) 22%, #111);
    box-shadow: inset 0 8px 18px rgba(0,0,0,.7);
    transition: background .3s, box-shadow .3s, transform .08s;
  }
  .party:active { transform: scale(.96); }
  .party[aria-pressed="true"] {
    background: #26262a; transition: transform .08s;
    box-shadow: 0 0 40px 10px color-mix(in srgb, var(--gc) 60%, transparent);
  }
  .party[disabled] { cursor: default; opacity: .45; }
  .ball { position: absolute; inset: 0; opacity: 0; transition: opacity .3s; pointer-events: none;
          transform-style: preserve-3d; animation: turn 18s linear infinite; }
  .party[aria-pressed="true"] .ball { opacity: 1; transition: none; }
  @keyframes turn { from { transform: rotateX(90deg) rotateZ(0deg); } to { transform: rotateX(90deg) rotateZ(360deg); } }
  .ball .core { position: absolute; inset: 4%; border-radius: 50%; background: linear-gradient(#111, #333);
                animation: counter 18s linear infinite; }
  @keyframes counter { from { transform: rotateX(90deg) rotateY(0deg); } to { transform: rotateX(90deg) rotateY(-360deg); } }
  .ball .sq { position: absolute; top: 50%; left: 50%; width: 0; height: 0; transform-style: preserve-3d; }
  .ball .sq i { display: block; transform-origin: 0 0; backface-visibility: hidden; animation: shimmer 2s linear infinite;
                background: color-mix(in srgb, var(--gc) calc(30% * var(--t)), var(--grey)); }
  @keyframes shimmer { 0% { opacity: 1; } 50% { opacity: .4; } 100% { opacity: 1; } }

  /* The one place this page says anything. It appears only after somebody
     has really played, and never again on that phone for a week. */
  .who {
    position: fixed; left: 0; right: 0; bottom: max(18px, env(safe-area-inset-bottom));
    display: flex; justify-content: center; align-items: center; gap: 6px;
    opacity: 0; transition: opacity .8s;
  }
  .who[hidden] { display: none; }
  /* Embedded: sized by content, the name field in the flow under the light. */
  body.bare { height: auto; min-height: 0; padding: 12px 0 8px; }
  body.bare main { gap: 16px; }
  body.bare .who { position: static; margin-top: 16px; }
  .who .field { position: relative; display: flex; }
  .who input {
    width: min(58vw, 240px); padding: 10px 44px 10px 16px; /* room for the arrow */
    background: #1c1c1e; border: 1px solid #2c2c2e; border-radius: 999px;
    color: #d4d4d4; font: inherit; font-size: 16px; /* 16px: smaller zooms iOS in */
    outline: none; -webkit-appearance: none;
  }
  .who input::placeholder { color: #6b6b6e; }
  /* The arrow inside the pill: the keyboard's return key works too, but on a
     phone that key is not always a send, and nothing else here says "done". */
  .who .go {
    position: absolute; right: 5px; top: 50%; transform: translateY(-50%);
    width: 30px; height: 30px; padding: 0; border: 0; border-radius: 50%;
    display: grid; place-items: center;
    background: #2c2c2e; cursor: pointer;
    transition: background .2s, opacity .2s;
  }
  .who .go svg {
    width: 16px; height: 16px; display: block;
    fill: none; stroke: #8e8e93; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round;
    transition: stroke .2s;
  }
  /* Dimmed while the field is empty, by CSS rather than by disabling it: a
     disabled default button also suppresses the keyboard's return key, and
     an autofill that fires no input event would leave it that way. */
  .who input:placeholder-shown + .go { opacity: .35; }
  .who input:not(:placeholder-shown) + .go { background: #3a3a3c; }
  .who input:not(:placeholder-shown) + .go svg { stroke: #e5e5e7; }
</style>
</head>
<body${bare ? ' class="bare"' : ''}>
<main>
  <div class="housing">
${lamps}
  </div>
  <div class="housing mini" id="party-housing" hidden>
    <button class="lamp party" id="party" data-entity="${escapeHtml(PARTY.entity)}"
      aria-label="${PARTY.label}" aria-pressed="false" disabled onclick="return false"><div class="ball" id="ball"></div></button>
  </div>
</main>
<form class="who" id="who" hidden>
  <div class="field">
    <input id="who-name" type="text" name="name" autocomplete="name" autocapitalize="words"
      autocorrect="off" spellcheck="false" maxlength="40" placeholder="what's your name?" aria-label="Your name"
      enterkeyhint="send">
    <button class="go" type="submit" id="who-go" aria-label="Send">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V6M6 12l6-6 6 6"/></svg>
    </button>
  </div>
</form>
<script>
(function () {
  var lamps = Array.prototype.slice.call(document.querySelectorAll('.lamp'));
  var party = document.getElementById('party');
  var partyHousing = document.getElementById('party-housing');

  // The mirror ball: tiles placed on a sphere and turned by CSS. Built once,
  // sized to the button. Each tile catches the glow colour a little.
  function buildBall() {
    var size = party.getBoundingClientRect().width || 100, radius = size / 2;
    var sq = 7 * size / 100, fuzzy = 0.001, inc = (Math.PI - fuzzy) / 20;
    var html = '<div class="core"></div>';
    for (var t = fuzzy; t < Math.PI; t += inc) {
      var z = radius * Math.cos(t);
      var ringR = Math.abs(2 * radius * Math.sin(t)) / 2.5;
      var fit = Math.max(1, Math.floor(2 * Math.PI * ringR / sq));
      var ainc = (Math.PI * 2 - fuzzy) / fit;
      for (var i = ainc / 2 + fuzzy; i < Math.PI * 2; i += ainc) {
        var c = t > 1.3 && t < 1.9 ? rnd(130, 255) : rnd(100, 180);
        var x = radius * Math.cos(i) * Math.sin(t), y = radius * Math.sin(i) * Math.sin(t);
        html += '<div class="sq" style="transform:translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,' + z.toFixed(1) + 'px)">' +
          '<i style="width:' + sq + 'px;height:' + sq + 'px;--t:' + (rnd(2, 15) / 10) + ';--grey:rgb(' + c + ',' + c + ',' + (c + 4) + ');' +
          'transform:rotate(' + i.toFixed(3) + 'rad) rotateY(' + t.toFixed(3) + 'rad);animation-delay:' + (rnd(0, 20) / 10) + 's"></i></div>';
      }
    }
    document.getElementById('ball').innerHTML = html;
  }
  function rnd(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }
  var hueTimer = null;
  function glow(on) {
    if (on && !hueTimer) {
      hueTimer = setInterval(function () { party.style.setProperty('--gc', 'hsl(' + rnd(0, 359) + ' 100% 65%)'); }, 150);
    } else if (!on && hueTimer) {
      clearInterval(hueTimer); hueTimer = null; party.style.removeProperty('--gc');
    }
  }
  var built = false;
  function showParty(on) {
    partyHousing.hidden = !on;
    if (on && !built) { built = true; buildBall(); }
  }
  new MutationObserver(function () { glow(party.getAttribute('aria-pressed') === 'true'); })
    .observe(party, { attributes: true, attributeFilter: ['aria-pressed'] });
  var ws = null, pollTimer = null, backoff = 1000;
  var tapped = {};
  // What the last tap asked for, per lamp, and when. While a tap is recent,
  // a pushed state that disagrees is an intermediate one from an earlier
  // tap still landing, and is not painted; the truth catches up once the
  // finger stops.
  var wanted = {};
  var SETTLE_MS = 1500;

  function paint(data) {
    var online = !!data.online;
    showParty(!!data.party);
    lamps.forEach(function (el) {
      var entity = el.dataset.entity;
      var state = data.states ? data.states[entity] : undefined;
      var want = wanted[entity];
      if (!(want && performance.now() - want.at < SETTLE_MS && state !== want.state)) {
        el.setAttribute('aria-pressed', state === 'on' ? 'true' : 'false');
      }
      el.disabled = !online;
    });
  }

  // No words on this page. Trouble reads as dimmed lamps until a state
  // message brings them back.
  function fail() {
    lamps.forEach(function (el) { el.disabled = true; });
  }

  function handle(data) {
    // Only a state message, or an error carrying the real state, repaints.
    // A successful tap says nothing about state: the lamp already flipped,
    // and the push from home confirms or corrects it.
    if (data.states && (data.type === 'state' || data.error)) paint(data);
    if (data.error) {
      fail();
      setTimeout(function () { if (data.states) paint(data); }, 1500);
    }
    if (data.type === 'result' && tapped[data.entity]) {
      console.log('tap to state ' + Math.round(performance.now() - tapped[data.entity]) +
        'ms (agent ' + data.agentMs + 'ms, home assistant ' + data.haMs + 'ms)');
      delete tapped[data.entity];
    }
  }

  function open() { return ws && ws.readyState === 1; }

  // The socket: state arrives as it changes, taps go the same way.
  function connect() {
    try {
      ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/traffic/ws');
    } catch (err) { poll(); return; }
    ws.onopen = function () {
      backoff = 1000;
      flush();
      clearInterval(pollTimer);
      pollTimer = null;
    };
    ws.onmessage = function (e) {
      if (e.data === 'pong') return;
      var data;
      try { data = JSON.parse(e.data); } catch (err) { return; }
      handle(data);
    };
    ws.onclose = function () {
      ws = null;
      poll();
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 15000);
    };
    ws.onerror = function () { try { ws.close(); } catch (err) {} };
  }

  // Without a socket, ask every few seconds instead.
  function refresh() {
    return fetch('/traffic/state', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(paint)
      .catch(fail);
  }
  function poll() {
    if (pollTimer) return;
    refresh();
    pollTimer = setInterval(refresh, 3000);
  }

  // ---------------------------------------------------------------- who
  // Somebody who scans this has no idea whose light it is, and the page
  // says nothing. Once they have actually played — two taps and a pause of
  // two seconds — ask once. A name is reused without asking for as long as
  // this phone keeps coming back; only a week away brings the question back,
  // prefilled. Somebody back for a second visit who never gave a name sees
  // the field from the start.
  //
  // Every visit that touches a lamp is recorded at its first pause, named or
  // not. A name typed after that goes as a second record for the same visit,
  // and the ledger shows that one in its place.
  var KEY = 'skin.player', WEEK = 604800000, PAUSE = 2000, BURSTS = 1;
  var me = read(), pending = null, logged = false;
  var visit = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  var opened = performance.now(), taps = 0, burst = 0, pauses = 0, idle = null, asked = false, gated = false;
  var form = document.getElementById('who'), field = document.getElementById('who-name');
  var returning = me.visits > 0;
  // Away since the last visit; phones from before seen fall back to the
  // last answer.
  var away = Date.now() - (me.seen || me.at || 0);
  me.visits = (me.visits || 0) + 1;
  me.seen = Date.now();
  try { localStorage.setItem(KEY, JSON.stringify(me)); } catch (err) {}

  function read() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (err) { return {}; }
  }
  // at is when they last answered, kept only as the fallback above.
  function remember(patch, touch) {
    me.id = me.id || (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2));
    for (var k in patch) me[k] = patch[k];
    if (touch || !me.at) me.at = Date.now();
    try { localStorage.setItem(KEY, JSON.stringify(me)); } catch (err) {}
  }
  // Fire and forget, never costing a tap its latency. A record made while
  // the socket is down waits for it to open rather than being dropped.
  function report(name) {
    if (!me.id) remember({});
    pending = {
      type: 'player', id: me.id, visit: visit, name: name || '', dismissed: false,
      taps: taps, seconds: Math.round((performance.now() - opened) / 1000)
    };
    flush();
  }
  function flush() {
    if (!pending || !open()) return;
    ws.send(JSON.stringify(pending));
    pending = null;
  }
  // The first record of a visit: the remembered name while it is fresh,
  // otherwise none.
  function log() {
    if (logged) return;
    logged = true;
    report(me.name && away < WEEK ? me.name : '');
  }
  // The lamps are held while the field is up, and released by sending a name.
  function gate(on) {
    gated = on;
    document.body.classList.toggle('gated', on);
  }
  function hide() {
    gate(false);
    form.style.opacity = 0;
    setTimeout(function () { form.hidden = true; }, 800);
  }
  function ask() {
    if (asked) return;
    asked = true;
    var fresh = away < WEEK;
    if (fresh && me.dismissed) return;            // a no lasts the week
    if (fresh && me.name) return;                 // known: no prompt, log() named them
    field.value = me.name || '';                  // stale name prefills, one tap to confirm
    show();
  }
  function show() {
    gate(true);
    form.hidden = false;
    requestAnimationFrame(function () { form.style.opacity = 1; });
  }
  // A burst is taps less than two seconds apart; only bursts of two or more
  // count, so a single curious prod and a walk away is not "played".
  function played() {
    // Once shown, the field stays until a name is sent. Nobody is made to
    // answer; the lamps work the same either way.
    taps++; burst++;
    clearTimeout(idle);
    idle = setTimeout(function () {
      if (burst >= 2) pauses++;
      burst = 0;
      log();
      if (pauses >= BURSTS) ask();
    }, PAUSE);
  }
  form.onsubmit = function (e) {
    e.preventDefault();
    var name = field.value.trim();
    if (!name) return;
    remember({ name: name, dismissed: false }, true);
    logged = true;
    report(name);
    hide();
  };
  if (returning && !me.name) { asked = true; show(); }
  lamps.forEach(function (el) {
    // pointerdown, not click: a touch click waits for the finger to lift,
    // which is 50–100ms of nothing. The tick is so the finger feels it.
    el.onpointerdown = function (e) {
      if (el.disabled) return;
      e.preventDefault();
      // Name first: until one is sent, a tap only points at the field.
      if (gated) { field.focus(); return; }
      played();
      var entity = el.dataset.entity;
      if (navigator.vibrate) navigator.vibrate(10);
      // Optimistic: the lamp flips now, and the tap names the state it wants
      // rather than "toggle", so a burst lands exactly as tapped.
      var next = el.getAttribute('aria-pressed') === 'true' ? 'off' : 'on';
      el.setAttribute('aria-pressed', next === 'on' ? 'true' : 'false');
      wanted[entity] = { state: next, at: performance.now() };
      tapped[entity] = performance.now();
      if (open()) {
        ws.send(JSON.stringify({ type: 'set', entity: entity, state: next }));
        return;
      }
      fetch('/traffic/toggle', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-skin-request': '1' },
        body: JSON.stringify({ entity: entity, state: next })
      }).then(function (r) { return r.json(); })
        .then(handle)
        .catch(fail);
    };
  });

  // Keeps the object awake exactly while someone is looking, so a tap never
  // pays a wake-up. The object ignores it.
  setInterval(function () { if (open()) ws.send('{"type":"warm"}'); }, 5000);
  setInterval(function () { if (open()) ws.send('ping'); }, 25000);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    if (open()) ws.send('ping'); else refresh();
  });
  connect();
})();
</script>
${bare ? `<script type="module">
${embed}
guest();
</script>` : ''}
</body>
</html>`;
}
