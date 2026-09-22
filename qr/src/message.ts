import { escapeHtml } from './html';

/**
 * The page a `text` target renders.
 *
 * This is the destination, not a waypoint — nothing on it navigates anywhere.
 * The scanner is meant to hold the phone up and have it keep saying this, so
 * there is no timer, no redirect, and no back-button trap.
 *
 * Type scales with length rather than being fixed: "hi" and a three-sentence
 * note should both fill the screen sensibly.
 */
export function renderMessage(text: string, footer?: string): string {
  const length = text.trim().length;
  const size = length <= 12 ? '14vw' : length <= 40 ? '9vw' : length <= 120 ? '6vw' : '4.5vw';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#09090b">
<meta property="og:title" content="${escapeHtml(text.slice(0, 80))}">
<title>${escapeHtml(text.slice(0, 60))}</title>
<style>
  :root { color-scheme: light dark; --bg: #fafafa; --ink: #09090b; --muted: #a1a1aa; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #09090b; --ink: #fafafa; --muted: #52525b; }
  }
  html, body { height: 100%; margin: 0; }
  body {
    display: grid;
    place-items: center;
    padding: 8vw;
    background: var(--bg);
    color: var(--ink);
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    text-align: center;
    -webkit-text-size-adjust: 100%;
  }
  p {
    margin: 0;
    font-size: ${size};
    font-weight: 650;
    line-height: 1.15;
    letter-spacing: -0.02em;
    overflow-wrap: anywhere;
    max-width: 22ch;
  }
  footer {
    position: fixed;
    bottom: max(1rem, env(safe-area-inset-bottom));
    left: 0; right: 0;
    font-size: 12px;
    color: var(--muted);
  }
</style>
</head>
<body>
<p>${escapeHtml(text)}</p>
${footer ? `<footer>${escapeHtml(footer)}</footer>` : ''}
</body>
</html>`;
}
