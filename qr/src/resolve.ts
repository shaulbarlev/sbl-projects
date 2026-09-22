import type { Pool, Resolution, State, Target } from './types';

export function findPool(state: State, poolId: string): Pool | null {
  return state.pools?.find((pool) => pool.id === poolId) ?? null;
}

/**
 * Whether a target can actually produce something to serve.
 *
 * A set that is empty, or whose every image has since been deleted, has
 * nothing to hand a scanner; nor has a file deleted from the Library. Such a
 * target is skipped so resolution falls through to the next layer, rather than
 * dead-ending on a slot that looks configured but cannot deliver.
 */
export function isServable(state: State, target: Target): boolean {
  if (target.kind === 'pool') {
    const pool = findPool(state, target.poolId);
    return !!pool && pool.items.length > 0;
  }
  if (target.kind === 'file') return state.files.some((f) => f.key === target.key);
  // The traffic light has a master switch. Off, it is skipped the same way.
  if (target.kind === 'traffic') return !!state.trafficEnabled;
  return true;
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
 * Whether a sequence *run* is still current: armed and unexpired, whether or
 * not any steps are left to hand out.
 *
 * This is the gate for serving a scan, and it is deliberately looser than
 * `sequenceLive`. The last step being claimed does not end the run — the three
 * people already holding a claim must keep seeing their own message until the
 * deadline. Gating on `sequenceLive` here meant friend #4 scanning yanked the
 * message off friends #1-#3 the moment they locked and unlocked their phone,
 * which is the exact failure the sticky claim exists to prevent.
 */
export function sequenceRunOpen(state: State, now: number): boolean {
  const sequence = state.sequence;
  return !!sequence && sequence.steps.length > 0 && sequence.expiresAt > now;
}

/**
 * Whether a sequence still has a step to give the next new scanner.
 *
 * Same lazy discipline as temp expiry: nothing has to have run for this to be
 * true. This is what the panel means by "armed"; it is not what decides
 * whether a given request is served from the sequence.
 */
export function sequenceLive(state: State, now: number): boolean {
  return sequenceRunOpen(state, now) && state.sequence!.cursor < state.sequence!.steps.length;
}

/** How many steps are left to claim. Zero when no sequence is live. */
export function stepsRemaining(state: State, now: number): number {
  if (!sequenceLive(state, now)) return 0;
  return state.sequence!.steps.length - state.sequence!.cursor;
}

/**
 * The target for an already-claimed step index, or for a peek at the next one.
 * Returns null if the index is out of range — a forged or stale cookie must
 * fall through to normal resolution, never crash — and null for a step that
 * cannot be served right now, so a switched-off traffic light or an emptied
 * set never bypasses its own gate by being a step.
 */
export function stepTarget(state: State, index: number): Target | null {
  const steps = state.sequence?.steps;
  if (!steps || !Number.isInteger(index) || index < 0 || index >= steps.length) return null;
  const target = steps[index].target;
  return isServable(state, target) ? target : null;
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
  // Text is rendered in place; pool and giphy are resolved upstream.
  return origin;
}

/** Stable identity for a target, used to de-duplicate the recents list. */
export function targetKey(target: Target): string {
  if (target.kind === 'url') return `url:${target.url}`;
  if (target.kind === 'file') return `file:${target.key}`;
  if (target.kind === 'pool') return `pool:${target.poolId}`;
  if (target.kind === 'giphy') return `giphy:${target.query}`;
  if (target.kind === 'traffic') return 'traffic';
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
  if (target.kind === 'giphy') return target.query ? `GIF feed: ${target.query}` : 'Trending GIF feed';
  if (target.kind === 'traffic') return 'Traffic light';
  return target.text;
}
