import { escapeHtml, escapeJsString } from '../html';
import { thanks } from './templates/thanks';
import type { SplashContext, SplashTemplate } from './types';

export type { SplashContext, SplashParts, SplashTemplate } from './types';

/** Every template the app knows about. Add real ones here. */
export const TEMPLATES: SplashTemplate[] = [thanks];

export const DEFAULT_TEMPLATE_ID = thanks.id;

/** Hard ceiling on splash duration, whatever a template asks for. */
export const MAX_SPLASH_MS = 5000;

export function getTemplate(id: string): SplashTemplate {
  return TEMPLATES.find((t) => t.id === id) ?? thanks;
}

/**
 * Assemble the full splash response.
 *
 * Everything is inlined into this one document. Zero additional round trips is
 * the entire reason a splash can sit in front of a QR scan without feeling
 * slow — a fetched bundle would cost a second RTT on exactly the cold cellular
 * connection this is most likely to run on.
 */
export function renderSplash(templateId: string, ctx: SplashContext): string {
  const template = getTemplate(templateId);
  const parts = template.render(ctx);
  const duration = Math.min(MAX_SPLASH_MS, Math.max(0, parts.durationMs));
  // The <meta refresh> is the no-JS backstop, so it must lose the race to JS
  // whenever JS is alive.
  const backstopSeconds = Math.ceil((duration + 1000) / 1000);
  const safeTarget = escapeHtml(ctx.targetUrl);
  const prefetch = /^https?:/i.test(ctx.targetUrl)
    ? `<link rel="prefetch" href="${safeTarget}">`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="${backstopSeconds};url=${safeTarget}">
<meta property="og:title" content="${escapeHtml(ctx.label ?? 'Redirecting')}">
<meta property="og:description" content="Redirecting you onward.">
${prefetch}
<title>redirecting</title>
<style>${parts.css}
.skip { position: fixed; bottom: 1rem; right: 1rem; font: 12px "Helvetica Neue", Helvetica, Arial, sans-serif; color: inherit; opacity: .6; }
@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
</style>
</head>
<body>
${parts.html}
<a class="skip" href="${safeTarget}">skip &rarr;</a>
<script>
(function () {
  var target = "${escapeJsString(ctx.targetUrl)}";
  // replace(), not assign() — the splash must not sit in history and trap the
  // back button on the way out of the destination.
  function go() { location.replace(target); }
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) { go(); return; }
  setTimeout(go, ${duration});
})();
</script>
${parts.js ? `<script>${parts.js}</script>` : ''}
</body>
</html>`;
}
