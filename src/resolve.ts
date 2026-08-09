import type { Resolution, State, Target } from './types';

/**
 * The single source of truth for "what does the QR point at right now".
 *
 * Expiry is evaluated lazily on every read. This is deliberate: the alarm in
 * the Durable Object is a convenience, not a correctness mechanism. If every
 * alarm on the platform silently failed, this function would still be right.
 */
export function resolve(state: State, now: number, fallbackUrl: string): Resolution {
  const temp = state.temp;
  if (temp && temp.expiresAt > now) {
    return { source: 'temp', target: temp.target, expiresAt: temp.expiresAt };
  }
  if (state.main) {
    return { source: 'main', target: state.main.target };
  }
  return { source: 'fallback', target: { kind: 'url', url: fallbackUrl } };
}

/** The absolute URL a target resolves to, given the request's own origin. */
export function targetToUrl(target: Target, origin: string): string {
  if (target.kind === 'url') return target.url;
  return `${origin}/f/${target.key}/${encodeURIComponent(target.name)}`;
}
