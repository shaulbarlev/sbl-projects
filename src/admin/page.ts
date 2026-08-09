import { escapeHtml } from '../html';
import { ADMIN_JS } from './client';
import { ADMIN_CSS } from './styles';

const HEAD = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#09090b">
<link rel="manifest" href="/_/manifest.webmanifest">`;

export function loginPage(error?: string): string {
  return `<!doctype html>
<html lang="en">
<head>${HEAD}<title>skin · sign in</title><style>${ADMIN_CSS}</style></head>
<body>
<form class="login card" method="POST" action="/_/login">
  <h2>q.shaulb.com</h2>
  ${error ? `<p style="color:var(--warn);font-size:14px;margin:0">${escapeHtml(error)}</p>` : ''}
  <label class="field">Password
    <input type="password" name="password" autocomplete="current-password" autofocus required>
  </label>
  <button class="primary" type="submit">Sign in</button>
</form>
</body>
</html>`;
}

export function adminPage(host: string): string {
  return `<!doctype html>
<html lang="en">
<head>${HEAD}<title>skin · ${escapeHtml(host)}</title><style>${ADMIN_CSS}</style></head>
<body>
<main>

  <section class="card live">
    <div class="src" id="live-src">…</div>
    <div class="url" id="live-url">loading</div>
    <div class="meta" id="live-meta"></div>
    <div class="row" id="temp-controls" hidden style="margin-top:10px">
      <button class="danger" id="end-now">End now</button>
      <button id="extend">+15m</button>
    </div>
  </section>

  <section class="card">
    <h2>Temporary duration</h2>
    <div class="grid4">
      <button data-duration="15">15m</button>
      <button data-duration="60" class="primary">1h</button>
      <button data-duration="240">4h</button>
      <button data-duration="1440">24h</button>
    </div>
    <label class="field" style="margin-top:10px">Custom (minutes, max 7 days)
      <input type="text" id="duration" inputmode="numeric" value="60">
    </label>
  </section>

  <section class="card">
    <h2>Custom URL</h2>
    <form id="custom-form">
      <input type="text" id="custom-url" inputmode="url" autocapitalize="off"
             autocorrect="off" spellcheck="false" placeholder="example.com/page">
      <div class="row" style="margin-top:8px">
        <button type="submit" value="temp" class="primary">Set temp</button>
        <button type="submit" value="main">Set main</button>
      </div>
    </form>
  </section>

  <section class="card">
    <h2>Bookmarks</h2>
    <div class="list" id="bookmarks"></div>
    <form id="bookmark-form" style="margin-top:10px;display:grid;gap:8px">
      <input type="text" id="bm-label" placeholder="Label">
      <input type="text" id="bm-url" inputmode="url" autocapitalize="off"
             autocorrect="off" spellcheck="false" placeholder="example.com">
      <button type="submit">Add bookmark</button>
    </form>
  </section>

  <section class="card">
    <h2>Recent</h2>
    <div class="list" id="mru"></div>
  </section>

  <section class="card">
    <h2>Files</h2>
    <label class="btn" for="upload-input" style="display:block;text-align:center">Upload a file</label>
    <input type="file" id="upload-input" hidden>
    <p class="hint" id="upload-status"></p>
    <div class="list" id="files" style="margin-top:8px"></div>
  </section>

  <section class="card">
    <div class="toggle">
      <div>
        <strong>Splash screen</strong>
        <div class="desc">Scanners see the animation first, then continue.</div>
      </div>
      <label class="switch">
        <input type="checkbox" id="splash-toggle">
        <span></span>
      </label>
    </div>
  </section>

  <section class="card">
    <h2>This code</h2>
    <img src="/_/qr.svg" alt="QR code for ${escapeHtml(host)}"
         style="width:100%;max-width:220px;display:block;margin:0 auto;border-radius:8px">
    <p class="hint" style="text-align:center">${escapeHtml(host)} · <span id="hits">0 scans</span></p>
    <div class="row" style="margin-top:8px">
      <a class="btn" href="/_/export.json" style="text-align:center;text-decoration:none">Export state</a>
      <form method="POST" action="/_/logout" style="flex:1 1 auto;margin:0">
        <button type="submit" class="ghost" style="width:100%">Sign out</button>
      </form>
    </div>
  </section>

</main>
<div id="toast" role="status" aria-live="polite"></div>
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
