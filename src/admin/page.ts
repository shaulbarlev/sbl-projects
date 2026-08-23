import { escapeHtml } from '../html';
import { ADMIN_JS } from './client';
import { ADMIN_CSS } from './styles';

const HEAD = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#09090b">
<link rel="manifest" href="/_/manifest.webmanifest">`;

export function loginPage(host: string, error?: string): string {
  return `<!doctype html>
<html lang="en">
<head>${HEAD}<title>skin · sign in</title><style>${ADMIN_CSS}</style></head>
<body style="padding-bottom:0">
<form class="login card" method="POST" action="/_/login">
  <h2 style="margin:0;font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--muted)">${escapeHtml(host)}</h2>
  ${error ? `<p style="color:var(--warn);font-size:14px;margin:0">${escapeHtml(error)}</p>` : ''}
  <label class="field">Password
    <input type="password" name="password" autocomplete="current-password" autofocus required>
  </label>
  <button class="primary" type="submit">Sign in</button>
</form>
</body>
</html>`;
}

const ICONS = {
  now: '<path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="9"/>',
  library: '<path d="M4 5h6v14H4zM14 5h6v14h-6z"/><path d="M4 9h6M14 9h6"/>',
  sequence: '<circle cx="6" cy="12" r="2.2"/><circle cx="12" cy="12" r="2.2"/><circle cx="18" cy="12" r="2.2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
};

function tab(id: string, label: string, icon: string, selected = false): string {
  return `<button role="tab" id="tab-${id}" data-tab="${id}"
    aria-selected="${selected}" aria-controls="panel-${id}">
    <svg viewBox="0 0 24 24" aria-hidden="true" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>
    <span>${label}</span>
    ${id === 'sequence' ? '<span class="badge" id="seq-badge" hidden></span>' : ''}
  </button>`;
}

export function adminPage(host: string): string {
  return `<!doctype html>
<html lang="en">
<head>${HEAD}<title>skin · ${escapeHtml(host)}</title><style>${ADMIN_CSS}</style></head>
<body>

<!-- Always on screen, every tab: what a scan gets right now. -->
<header id="status" role="button" tabindex="0" aria-label="Jump to current status">
  <span class="dot"></span>
  <span class="text">
    <span class="kicker" id="status-kicker">…</span>
    <span class="now" id="status-now">loading</span>
  </span>
  <span class="timer" id="status-timer"></span>
</header>

<main>

  <!-- ===================================================== NOW ========= -->
  <div class="panel" id="panel-now" role="tabpanel" aria-labelledby="tab-now">
    <section>
      <h2>Right now</h2>
      <div class="card live" id="live">
        <div class="src" id="live-src">…</div>
        <div class="url" id="live-url">loading</div>
        <div class="pips" id="live-pips" hidden></div>
        <div class="meta" id="live-meta"></div>
        <div class="row" id="live-actions" hidden style="margin-top:12px"></div>
      </div>
    </section>

    <section>
      <h2>Send somewhere temporarily</h2>
      <p class="sub">Reverts on its own. Pick how long, then choose a destination.</p>
      <div class="card">
        <div class="grid4">
          <button class="chip" data-duration="15">15m</button>
          <button class="chip primary" data-duration="60">1h</button>
          <button class="chip" data-duration="240">4h</button>
          <button class="chip" data-duration="1440">24h</button>
        </div>
        <label class="field" style="margin-top:10px">Or minutes (max 7 days)
          <input type="text" id="duration" inputmode="numeric" value="60">
        </label>
      </div>
    </section>

    <section>
      <h2>Custom destination</h2>
      <div class="card stack">
        <div class="row">
          <button id="mode-link" class="primary" data-mode="link">Link</button>
          <button id="mode-message" data-mode="message">Message</button>
        </div>
        <input type="text" id="custom-url" inputmode="url" autocapitalize="off"
               autocorrect="off" spellcheck="false" placeholder="example.com/page">
        <textarea id="custom-text" hidden placeholder="Text shown full-screen to whoever scans"></textarea>
        <div class="row">
          <button id="send-temp" class="primary">Set temporary</button>
          <button id="send-main">Set as main</button>
        </div>
      </div>
    </section>

    <section>
      <h2>Recent</h2>
      <div class="list" id="mru"></div>
    </section>
  </div>

  <!-- ================================================= LIBRARY ========= -->
  <div class="panel" id="panel-library" role="tabpanel" aria-labelledby="tab-library" hidden>
    <section>
      <h2>Bookmarks</h2>
      <p class="sub">Saved destinations. Tap <b>temp</b> to send there for a while, <b>main</b> to make it the default.</p>
      <div class="list" id="bookmarks"></div>
      <div class="card stack" style="margin-top:10px">
        <input type="text" id="bm-label" placeholder="Label">
        <input type="text" id="bm-url" inputmode="url" autocapitalize="off"
               autocorrect="off" spellcheck="false" placeholder="example.com">
        <button id="bm-add">Add bookmark</button>
      </div>
    </section>

    <section>
      <h2>Image sets</h2>
      <p class="sub">Point the code at a set and every scan serves a different image from it.
        Each image comes up once before any repeats.</p>
      <div class="list" id="pools"></div>
      <div class="card stack" style="margin-top:10px">
        <input type="text" id="pool-name" placeholder="Set name, e.g. Party photos">
        <button id="pool-add">Create set</button>
      </div>
      <input type="file" id="pool-upload" accept="image/*" multiple hidden>
    </section>

    <section>
      <h2>Files</h2>
      <p class="sub">Uploaded and served from this domain. Nothing is deleted automatically.</p>
      <label class="btn" for="upload-input" style="display:block">Upload a file</label>
      <input type="file" id="upload-input" hidden>
      <p class="hint" id="upload-status"></p>
      <div class="list" id="files" style="margin-top:8px"></div>
    </section>
  </div>

  <!-- ================================================ SEQUENCE ========= -->
  <div class="panel" id="panel-sequence" role="tabpanel" aria-labelledby="tab-sequence" hidden>
    <section>
      <h2>Sequence</h2>
      <p class="sub">Hand out a different destination to each person who scans, in order.
        Each scanner keeps theirs on reload. When the list runs out, scans go back to normal.</p>
      <div class="card" id="seq-status">
        <div class="src" id="seq-state">Not armed</div>
        <div class="pips" id="seq-pips" hidden></div>
        <div class="meta" id="seq-meta" style="margin-top:6px"></div>
        <div class="row" id="seq-actions" style="margin-top:12px"></div>
      </div>
    </section>

    <section>
      <h2>Steps</h2>
      <div class="list" id="steps"></div>
    </section>

    <section>
      <h2>Add a step</h2>
      <div class="card stack">
        <div class="row">
          <button id="step-mode-message" class="primary" data-stepmode="message">Message</button>
          <button id="step-mode-link" data-stepmode="link">Link</button>
        </div>
        <textarea id="step-text" placeholder="e.g. you are first"></textarea>
        <input type="text" id="step-url" hidden inputmode="url" autocapitalize="off"
               autocorrect="off" spellcheck="false" placeholder="example.com/page">
        <button id="step-add">Add step</button>
      </div>
    </section>

    <section>
      <h2>Arm for</h2>
      <p class="sub">A safety deadline, so a forgotten sequence cannot ambush a stranger next week.</p>
      <div class="card">
        <div class="grid4">
          <button class="chip" data-seqduration="15">15m</button>
          <button class="chip primary" data-seqduration="60">1h</button>
          <button class="chip" data-seqduration="240">4h</button>
          <button class="chip" data-seqduration="1440">24h</button>
        </div>
      </div>
    </section>
  </div>

  <!-- ================================================ SETTINGS ========= -->
  <div class="panel" id="panel-settings" role="tabpanel" aria-labelledby="tab-settings" hidden>
    <section>
      <h2>Splash screen</h2>
      <div class="card">
        <div class="toggle">
          <div>
            <strong>Show before redirecting</strong>
            <div class="desc">Scanners see the animation first, then continue.
              Skipped for messages and for link previews.</div>
          </div>
          <label class="switch">
            <input type="checkbox" id="splash-toggle">
            <span></span>
          </label>
        </div>
      </div>
    </section>

    <section>
      <h2>This code</h2>
      <div class="card">
        <img class="qr" src="/_/qr.svg" alt="QR code for ${escapeHtml(host)}">
        <p class="hint" style="text-align:center">
          ${escapeHtml(host)} · <span id="hits">0 scans</span>
        </p>
      </div>
    </section>

    <section>
      <h2>Data</h2>
      <div class="card row">
        <a class="btn" href="/_/export.json">Export state</a>
        <button id="logout" class="ghost">Sign out</button>
      </div>
    </section>
  </div>

</main>

<nav id="tabs" role="tablist" aria-label="Sections">
  ${tab('now', 'Now', ICONS.now, true)}
  ${tab('library', 'Library', ICONS.library)}
  ${tab('sequence', 'Sequence', ICONS.sequence)}
  ${tab('settings', 'Settings', ICONS.settings)}
</nav>

<div id="toast" role="status" aria-live="polite"></div>
<form id="logout-form" method="POST" action="/_/logout" hidden></form>
<script>${ADMIN_JS}</script>
</body>
</html>`;
}

export const MANIFEST = JSON.stringify({
  name: 'skin · redirect',
  short_name: 'skin',
  start_url: '/_/',
  display: 'standalone',
  background_color: '#09090b',
  theme_color: '#09090b',
});
