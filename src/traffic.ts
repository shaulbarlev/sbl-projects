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
      aria-label="${l.label} light" aria-pressed="false" disabled></button>`,
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
    lamps.forEach(function (el) { el.disabled = true; });
  }

  function refresh() {
    return fetch('/traffic/state', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(paint)
      .catch(function () { fail('no connection'); });
  }

  lamps.forEach(function (el) {
    el.onclick = function () {
      if (el.disabled || el.classList.contains('busy')) return;
      el.classList.add('busy');
      fetch('/traffic/toggle', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-skin-request': '1' },
        body: JSON.stringify({ entity: el.dataset.entity })
      }).then(function (r) {
        return r.json().then(function (data) {
          if (!r.ok) throw new Error(data.error || 'failed');
          paint(data);
        });
      }).catch(function (err) {
        fail(err.message === 'busy' ? 'slow down' : err.message);
        setTimeout(refresh, 1200);
      }).finally(function () { el.classList.remove('busy'); });
    };
  });

  refresh();
  setInterval(refresh, 3000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
})();
</script>
</body>
</html>`;
}
