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
  | { kind: 'text'; text: string; label?: string };

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
  splash: boolean;
  bookmarks: Bookmark[];
  mru: MruEntry[];
  files: StoredFile[];
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
}
