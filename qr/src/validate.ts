/**
 * Schemes we will store as a redirect target.
 *
 * `javascript:` and `data:` are not merely absent from this list, they are the
 * reason the list exists: with the splash screen on we render HTML on our own
 * origin, so a stored `javascript:` target would be persistent XSS against the
 * admin panel sharing that origin.
 */
const ALLOWED_SCHEMES = new Set(['https:', 'http:', 'mailto:', 'tel:', 'sms:']);

export interface ValidationResult {
  ok: boolean;
  url?: string;
  error?: string;
}

export function validateUrl(raw: string): ValidationResult {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: 'URL is empty' };

  // Bare "example.com/foo" is what you actually type on a phone.
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, error: 'Not a parseable URL' };
  }

  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    return { ok: false, error: `Scheme ${parsed.protocol} is not allowed` };
  }

  if ((parsed.protocol === 'https:' || parsed.protocol === 'http:') && !parsed.hostname) {
    return { ok: false, error: 'URL has no host' };
  }

  return { ok: true, url: parsed.toString() };
}

/** Clamp a requested temp duration. 7 days is the ceiling. */
export const MAX_TEMP_MS = 7 * 24 * 60 * 60 * 1000;
export const MIN_TEMP_MS = 60 * 1000;

export function clampDuration(ms: number): number {
  if (!Number.isFinite(ms)) return MIN_TEMP_MS;
  return Math.min(MAX_TEMP_MS, Math.max(MIN_TEMP_MS, Math.floor(ms)));
}
