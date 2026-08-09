import type { SplashTemplate } from '../types';

/**
 * The placeholder, built exactly to spec: lowercase, ugly, two seconds.
 *
 * It exists to prove the pipeline end to end — registry, inlining, timing,
 * reduced-motion bypass, prefetch — so that when the real templates arrive the
 * only new thing is the animation itself.
 */
export const thanks: SplashTemplate = {
  id: 'thanks',
  label: 'thank you for scanning',
  render() {
    return {
      durationMs: 2000,
      html: `<p class="t">thank you for scanning</p>`,
      css: `
        html, body { height: 100%; margin: 0; }
        body {
          display: grid;
          place-items: center;
          background: #00ff88;
          font-family: monospace;
        }
        .t {
          font-size: 7vw;
          color: #101010;
          text-transform: lowercase;
          letter-spacing: -0.03em;
        }
      `,
    };
  },
};
