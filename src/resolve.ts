import type { Pool, Resolution, State, Target } from './types';

export function findPool(state: State, poolId: string): Pool | null {
  return state.pools?.find((pool) => pool.id === poolId) ?? null;
}

/**
 * Whether a target can actually produce something to serve.
 *
 * Only image sets can fail this: a set that is empty, or whose every image has
 * since been deleted, has nothing to hand a scanner. Such a target is skipped
 * so resolution falls through to the next layer, rather than dead-ending on a
 * slot that looks configured but cannot deliver.
 */
export function isServable(state: State, target: Target): boolean {
  if (target.kind !== 'pool') return true;
  const pool = findPool(state, target.poolId);
  return !!pool && pool.items.length > 0;
}

/**
 * The single source of truth for "what does the QR point at right now", for
 * everything except the sequence.
 *
 * Expiry is evaluated lazily on every read. This is deliberate: the alarm in
 * the Durable Object is a convenience, not a correctness mechanism. If every
 * alarm on the platform silently failed, this function would still be right.
 */
export function resolve(state: State, now: number, fallbackUrl: string): Resolution {
  const temp = state.temp;
  if (temp && temp.expiresAt > now && isServable(state, temp.target)) {
    return { source: 'temp', target: temp.target, expiresAt: temp.expiresAt };
  }
  if (state.main && isServable(state, state.main.target)) {
    return { source: 'main', target: state.main.target };
  }
  return { source: 'fallback', target: { kind: 'url', url: fallbackUrl } };
}

/**
 * Whether a sequence should be intercepting scans right now.
 *
 * Same lazy discipline as temp expiry: a sequence is live only if it is armed,
 * unexpired, and has steps left. Nothing has to have run for this to be true.
 */
export function sequenceLive(state: State, now: number): boolean {
  const sequence = state.sequence;
  return (
    !!sequence &&
    sequence.steps.length > 0 &&
    sequence.expiresAt > now &&
    sequence.cursor < sequence.steps.length
  );
}

/** How many steps are left to claim. Zero when no sequence is live. */
export function stepsRemaining(state: State, now: number): number {
  if (!sequenceLive(state, now)) return 0;
  return state.sequence!.steps.length - state.sequence!.cursor;
}

/**
 * The target for an already-claimed step index, or for a peek at the next one.
 * Returns null if the index is out of range — a forged or stale cookie must
 * fall through to normal resolution, never crash.
 */
export function stepTarget(state: State, index: number): Target | null {
  const steps = state.sequence?.steps;
  if (!steps || !Number.isInteger(index) || index < 0 || index >= steps.length) return null;
  return steps[index].target;
}

/** The URL that serves one stored file. */
export function fileUrl(key: string, name: string, origin: string): string {
  return `${origin}/f/${key}/${encodeURIComponent(name)}`;
}

/**
 * The absolute URL a target resolves to, given the request's own origin.
 *
 * Pool targets are not resolvable here — which image they serve is decided by
 * drawing from the bag in the Durable Object, so the caller must do that first
 * and pass the drawn file as a `file` target.
 */
export function targetToUrl(target: Target, origin: string): string {
  if (target.kind === 'url') return target.url;
  if (target.kind === 'file') return fileUrl(target.key, target.name, origin);
  // Text is rendered in place and pool is resolved upstream; neither has a URL.
  return origin;
}

/** Stable identity for a target, used to de-duplicate the recents list. */
export function targetKey(target: Target): string {
  if (target.kind === 'url') return `url:${target.url}`;
  if (target.kind === 'file') return `file:${target.key}`;
  if (target.kind === 'pool') return `pool:${target.poolId}`;
  return `text:${target.text}`;
}

/** A short human description, used in the admin panel and log lines. */
export function describeTarget(target: Target, state?: State): string {
  if (target.kind === 'url') return target.url;
  if (target.kind === 'file') return target.name;
  if (target.kind === 'pool') {
    const pool = state ? findPool(state, target.poolId) : null;
    return pool ? `${pool.name} (${pool.items.length} images)` : 'Image set';
  }
  return target.text;
}
