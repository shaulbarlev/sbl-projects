/** A redirect target: either an external URL or a file we host in R2. */
export type Target =
  | { kind: 'url'; url: string; label?: string }
  | { kind: 'file'; key: string; name: string; label?: string };

export interface Slot {
  target: Target;
  setAt: number;
}

export interface TempSlot extends Slot {
  /** UTC epoch ms. The deadline is stored, never a duration. */
  expiresAt: number;
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
  splash: boolean;
  bookmarks: Bookmark[];
  mru: MruEntry[];
  files: StoredFile[];
  hits: number;
}

/** What the resolver decided to serve, and why. */
export type Resolution =
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
