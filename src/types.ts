/**
 * Where a scan ends up.
 *
 * `text` is a destination in its own right, not a redirect — the message page
 * *is* the thing the scanner sees. It exists because sequence steps are usually
 * messages, but making it a first-class target means main and temp can be
 * messages too.
 */
export type Target =
  | { kind: 'url'; url: string; label?: string }
  | { kind: 'file'; key: string; name: string; label?: string }
  | { kind: 'text'; text: string; label?: string }
  | { kind: 'pool'; poolId: string; label?: string }
  /** A live Giphy search: every scan gets the next result, in order. */
  | { kind: 'giphy'; query: string; label?: string }
  /** The traffic light page, rendered in place. Gated by `State.trafficEnabled`. */
  | { kind: 'traffic'; label?: string };

/**
 * Where a GIF feed is up to: one page of result URLs and a cursor into it.
 * When the cursor runs off the end the next page is fetched, and when Giphy
 * has no more the feed wraps to the first page.
 */
export interface GiphyFeed {
  urls: string[];
  offset: number;
  cursor: number;
}

export interface Slot {
  target: Target;
  setAt: number;
}

export interface TempSlot extends Slot {
  /** UTC epoch ms. The deadline is stored, never a duration. */
  expiresAt: number;
}

export interface SequenceStep {
  id: string;
  target: Target;
}

/**
 * A one-shot queue of targets, handed out to consecutive scanners.
 *
 * Four friends scan in turn and each sees something different; when the last
 * step is claimed the sequence disarms and normal resolution resumes. It keeps
 * its steps after finishing so it can be re-armed for the next group without
 * retyping everything.
 */
export interface Sequence {
  steps: SequenceStep[];
  /** How many steps have been claimed. Also the index of the next one. */
  cursor: number;
  armedAt: number;
  /**
   * UTC epoch ms. A sequence armed and forgotten would otherwise ambush a
   * stranger scanning the code next week.
   */
  expiresAt: number;
  /**
   * Changes on every arm. Scanner cookies carry it, so re-arming invalidates
   * the claims of everyone who scanned the previous run.
   */
  runId: string;
}

export interface Bookmark {
  id: string;
  label: string;
  target: Target;
  createdAt: number;
}

/**
 * A set of uploaded images, one of which is served at random per scan.
 *
 * `bag` is what makes it feel random rather than merely be random: keys are
 * drawn from a shuffled bag and not returned until the bag empties, so a set
 * of three images cannot show the same one twice in a row — which pure random
 * selection would do a third of the time.
 */
export interface Pool {
  id: string;
  name: string;
  /** R2 keys, each also present in `State.files`. */
  items: string[];
  /** Keys not yet drawn in the current pass. Refilled and reshuffled when empty. */
  bag: string[];
  /** Last key handed out, so a reshuffle cannot repeat across the seam. */
  lastDrawn?: string;
  createdAt: number;
}

export interface StoredFile {
  key: string;
  name: string;
  type: string;
  size: number;
  uploadedAt: number;
}

export interface MruEntry {
  target: Target;
  at: number;
}

/** The full persisted state of one slug. */
export interface State {
  main: Slot | null;
  temp: TempSlot | null;
  sequence: Sequence | null;
  /**
   * Whether a sequence step sticks to the device that claimed it. Off, every
   * scan — a refresh included — advances to the next step.
   */
  stickySteps: boolean;
  splash: boolean;
  bookmarks: Bookmark[];
  mru: MruEntry[];
  files: StoredFile[];
  pools: Pool[];
  /** Feed progress, keyed by search query. */
  giphy: Record<string, GiphyFeed>;
  /**
   * The master switch for the traffic light. Off, /traffic resolves like any
   * stray path and a `traffic` target is skipped like an empty set.
   */
  trafficEnabled: boolean;
  /** The party button under the light. Off, it is not on the page at all. */
  partyEnabled: boolean;
  hits: number;
}

/** What the resolver decided to serve, and why. */
export type Resolution =
  | { source: 'sequence'; target: Target; stepIndex: number; total: number; expiresAt: number }
  | { source: 'temp'; target: Target; expiresAt: number }
  | { source: 'main'; target: Target }
  | { source: 'fallback'; target: Target };

export interface Env {
  STATE: DurableObjectNamespace;
  FILES: R2Bucket;
  ADMIN_PASSWORD: string;
  SESSION_SECRET: string;
  FALLBACK_URL: string;
  /** Optional. Without it the GIF search in the panel reports itself unset. */
  GIPHY_API_KEY?: string;
  /** Optional. Bearer token for scripts and Shortcuts; unset means no token auth. */
  API_TOKEN?: string;
  /** Optional. Bearer token the home agent connects with; unset means no agent. */
  AGENT_TOKEN?: string;
}
