import { escapeHtml } from './html';

/**
 * The traffic light: two lamps, top to bottom, each one switch at home.
 *
 * Fixed on purpose. The agent at home carries the same allowlist, so a
 * compromised Worker can still only reach these two switches, and only to
 * toggle them.
 */
export const LIGHTS = [
  { entity: 'switch.tasmota', label: 'Green', color: '#22c55e' },
  { entity: 'switch.traffic_1_power1', label: 'Orange', color: '#f59e0b' },
] as const;

export const LIGHT_ENTITIES: ReadonlySet<string> = new Set(LIGHTS.map((l) => l.entity));

/**
 * The page a `traffic` target renders, at /traffic and as a root takeover.
 *
 * Everything is inlined, like the message page: this opens on a phone that
 * just scanned a code. State is fetched on load and every few seconds, so a
 * switch flipped from elsewhere shows within that window.
 */
export function renderTraffic(): string {
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
  body {
    display: grid; place-items: center; gap: 0;
    background: #0a0a0a; color: #a3a3a3;
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    -webkit-text-size-adjust: 100%; -webkit-tap-highlight-color: transparent;
  }
  main { display: grid; justify-items: center; gap: 22px; }
  .housing {
    display: grid; gap: 22px; padding: 26px;
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
  p { margin: 0; font-size: 14px; letter-spacing: .04em; text-transform: uppercase; }
  p.err { color: #f87171; }
</style>
</head>
<body>
<main>
  <div class="housing">
${lamps}
  </div>
  <p id="status">connecting…</p>
</main>
<script>
(function () {
  var lamps = Array.prototype.slice.call(document.querySelectorAll('.lamp'));
  var status = document.getElementById('status');
  var ws = null, pollTimer = null, backoff = 1000;
  var tapped = {};

  function paint(data) {
    var online = !!data.online;
    lamps.forEach(function (el) {
      var state = data.states ? data.states[el.dataset.entity] : undefined;
      el.setAttribute('aria-pressed', state === 'on' ? 'true' : 'false');
      el.disabled = !online;
    });
    status.className = online ? '' : 'err';
    status.textContent = online ? 'tap a light' : 'home is offline';
  }

  function fail(message) {
    status.className = 'err';
    status.textContent = message;
  }

  function handle(data) {
    if (data.states) paint(data);
    if (data.error) {
      fail(data.error === 'busy' ? 'slow down' : data.error);
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
      .catch(function () { fail('no connection'); });
  }
  function poll() {
    if (pollTimer) return;
    refresh();
    pollTimer = setInterval(refresh, 3000);
  }

  lamps.forEach(function (el) {
    // pointerdown, not click: a touch click waits for the finger to lift,
    // which is 50–100ms of nothing. The tick is so the finger feels it.
    el.onpointerdown = function (e) {
      if (el.disabled || el.classList.contains('busy')) return;
      e.preventDefault();
      var entity = el.dataset.entity;
      if (navigator.vibrate) navigator.vibrate(10);
      // Optimistic: the lamp flips now; the pushed state corrects it if not.
      el.setAttribute('aria-pressed', el.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
      el.classList.add('busy');
      tapped[entity] = performance.now();
      var done = function () { el.classList.remove('busy'); };
      if (open()) {
        ws.send(JSON.stringify({ type: 'toggle', entity: entity }));
        setTimeout(done, 400);
        return;
      }
      fetch('/traffic/toggle', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-skin-request': '1' },
        body: JSON.stringify({ entity: entity })
      }).then(function (r) { return r.json(); })
        .then(handle)
        .catch(function () { fail('no connection'); })
        .finally(done);
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
</body>
</html>`;
}
