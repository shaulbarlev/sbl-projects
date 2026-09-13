import { searchGifs } from './giphy';
import { targetKey } from './resolve';
import type { Bookmark, MruEntry, Pool, SequenceStep, State, StoredFile, Target } from './types';

const EMPTY: State = {
  main: null,
  temp: null,
  sequence: null,
  stickySteps: false,
  splash: false,
  bookmarks: [],
  mru: [],
  files: [],
  pools: [],
  giphy: {},
  hits: 0,
};

const MRU_MAX = 5;
const LOGIN_MAX_ATTEMPTS = 8;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

interface LoginGuard {
  failures: number;
  lockedUntil: number;
}

/**
 * Strongly-consistent state for one slug.
 *
 * Keyed by slug (default `""`) from day one so a second QR code is a new key
 * rather than a schema migration. There is deliberately no UI for that yet.
 */
export class RedirectState implements DurableObject {
  constructor(private state: DurableObjectState) {}

  private async load(): Promise<State> {
    const stored = await this.state.storage.get<State>('state');
    return stored ? { ...EMPTY, ...stored } : { ...EMPTY };
  }

  private async save(next: State): Promise<void> {
    await this.state.storage.put('state', next);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const op = url.pathname.slice(1);
    const body = request.method === 'POST' ? ((await request.json()) as any) : {};

    switch (op) {
      case 'get':
        return json(await this.load());

      case 'hit': {
        const s = await this.load();
        s.hits += 1;
        await this.save(s);
        return json({ hits: s.hits });
      }

      case 'set-main': {
        const s = await this.load();
        // A live temp deliberately survives this. Setting main changes what the
        // temp falls back to when it expires; it does not cancel it.
        s.main = { target: body.target as Target, setAt: body.now };
        s.mru = pushMru(s.mru, body.target, body.now);
        await this.save(s);
        return json(s);
      }

      case 'set-temp': {
        const s = await this.load();
        s.temp = { target: body.target as Target, setAt: body.now, expiresAt: body.expiresAt };
        s.mru = pushMru(s.mru, body.target, body.now);
        await this.save(s);
        await this.state.storage.setAlarm(body.expiresAt);
        return json(s);
      }

      case 'extend-temp': {
        const s = await this.load();
        if (!s.temp) return json(s);
        s.temp.expiresAt += body.byMs;
        await this.save(s);
        await this.state.storage.setAlarm(s.temp.expiresAt);
        return json(s);
      }

      case 'clear-temp': {
        const s = await this.load();
        s.temp = null;
        await this.save(s);
        await this.state.storage.deleteAlarm();
        return json(s);
      }

      /* ---------------------------------------------------------- sequence */

      case 'set-steps': {
        // Editing steps never touches the cursor of a live run, so you can fix
        // a typo in step 4 while steps 1 and 2 are already claimed.
        const s = await this.load();
        const steps = body.steps as SequenceStep[];
        if (s.sequence) {
          // A spent run stays spent. Otherwise appending a step to a sequence
          // that has already run out — but whose deadline has not passed —
          // would silently re-arm it and ambush the next scanner.
          const spent = s.sequence.cursor >= s.sequence.steps.length;
          s.sequence.steps = steps;
          if (spent || s.sequence.cursor > steps.length) s.sequence.cursor = steps.length;
        } else {
          s.sequence = {
            steps,
            cursor: steps.length,
            armedAt: 0,
            expiresAt: 0,
            runId: 'idle',
          };
        }
        await this.save(s);
        return json(s);
      }

      case 'arm-sequence': {
        const s = await this.load();
        if (!s.sequence || s.sequence.steps.length === 0) return json(s);
        s.sequence = {
          steps: s.sequence.steps,
          cursor: 0,
          armedAt: body.now,
          expiresAt: body.expiresAt,
          // A fresh run id: everyone holding a claim from the previous run
          // loses it, so re-arming really does start over.
          runId: body.runId,
        };
        await this.save(s);
        await this.state.storage.setAlarm(body.expiresAt);
        return json(s);
      }

      case 'disarm-sequence': {
        const s = await this.load();
        if (s.sequence) {
          // Steps survive: disarming is "stop", not "throw away the script".
          s.sequence.cursor = s.sequence.steps.length;
          s.sequence.expiresAt = 0;
        }
        await this.save(s);
        return json(s);
      }

      /**
       * Claim the next step.
       *
       * The Durable Object runs single-threaded, so four friends scanning at
       * the same instant serialise here and get four different indices. This
       * is the reason the state lives in a DO and not in KV.
       */
      case 'burn-step': {
        const s = await this.load();
        const seq = s.sequence;
        if (
          !seq ||
          seq.steps.length === 0 ||
          seq.expiresAt <= body.now ||
          seq.cursor >= seq.steps.length
        ) {
          return json({ index: null });
        }
        const index = seq.cursor;
        seq.cursor += 1;
        await this.save(s);
        return json({ index, runId: seq.runId, total: seq.steps.length });
      }

      case 'set-sticky': {
        const s = await this.load();
        s.stickySteps = Boolean(body.on);
        await this.save(s);
        return json(s);
      }

      case 'set-splash': {
        const s = await this.load();
        s.splash = Boolean(body.on);
        await this.save(s);
        return json(s);
      }

      case 'add-bookmark': {
        const s = await this.load();
        const bookmark: Bookmark = {
          id: body.id,
          label: body.label,
          target: body.target,
          createdAt: body.now,
        };
        s.bookmarks = [...s.bookmarks, bookmark];
        await this.save(s);
        return json(s);
      }

      case 'remove-bookmark': {
        const s = await this.load();
        s.bookmarks = s.bookmarks.filter((b) => b.id !== body.id);
        await this.save(s);
        return json(s);
      }

      case 'add-file': {
        const s = await this.load();
        s.files = [body.file as StoredFile, ...s.files];
        await this.save(s);
        return json(s);
      }

      case 'remove-file': {
        const s = await this.load();
        s.files = s.files.filter((f) => f.key !== body.key);
        // A set holding a key whose object is gone would serve a 404 to
        // whoever draws it, so deletion has to reach into the sets too.
        for (const pool of s.pools) {
          pool.items = pool.items.filter((key) => key !== body.key);
          pool.bag = pool.bag.filter((key) => key !== body.key);
        }
        await this.save(s);
        return json(s);
      }

      /* ------------------------------------------------------- image sets */

      case 'add-pool': {
        const s = await this.load();
        const pool: Pool = {
          id: body.id,
          name: body.name,
          items: [],
          bag: [],
          createdAt: body.now,
        };
        s.pools = [...s.pools, pool];
        await this.save(s);
        return json(s);
      }

      case 'remove-pool': {
        const s = await this.load();
        s.pools = s.pools.filter((pool) => pool.id !== body.id);
        await this.save(s);
        return json(s);
      }

      case 'pool-add-item': {
        const s = await this.load();
        const pool = s.pools.find((p) => p.id === body.poolId);
        if (pool && !pool.items.includes(body.key)) {
          pool.items.push(body.key);
          // Drop it into the current bag too, so a newly added image can come
          // up before the whole pass finishes rather than waiting it out.
          pool.bag.push(body.key);
          shuffle(pool.bag);
        }
        await this.save(s);
        return json(s);
      }

      case 'pool-remove-item': {
        const s = await this.load();
        const pool = s.pools.find((p) => p.id === body.poolId);
        if (pool) {
          pool.items = pool.items.filter((key) => key !== body.key);
          pool.bag = pool.bag.filter((key) => key !== body.key);
        }
        await this.save(s);
        return json(s);
      }

      /**
       * Draw the next image, and count the scan in the same round trip.
       *
       * Drawing from a shuffled bag rather than picking at random means every
       * image in the set is shown once before any repeats — with three images,
       * pure random would show the same one twice running a third of the time.
       */
      case 'pool-draw': {
        const s = await this.load();
        const pool = s.pools.find((p) => p.id === body.poolId);
        if (!pool || pool.items.length === 0) {
          return json({ key: null });
        }
        // A peek reports what the next real scan would get and changes
        // nothing: no pop, no reshuffle, no write. Requests that must not
        // consume a step must not consume a draw either.
        if (body.peek) {
          return json({ key: pool.bag[pool.bag.length - 1] ?? pool.items[0] });
        }
        if (pool.bag.length === 0) {
          pool.bag = pool.items.slice();
          shuffle(pool.bag);
          // Guard the seam between passes. Without this the last image of one
          // pass and the first of the next can be the same, which is the one
          // repeat a bag is supposed to rule out.
          if (pool.items.length > 1 && pool.bag[pool.bag.length - 1] === pool.lastDrawn) {
            pool.bag.unshift(pool.bag.pop()!);
          }
        }
        const key = pool.bag.pop()!;
        pool.lastDrawn = key;
        await this.save(s);
        return json({ key, remaining: pool.bag.length });
      }

      /**
       * The next GIF in a feed. Fetches the next page when this one is spent
       * and wraps to the first when Giphy has no more. A peek returns what
       * the next real scan would get without advancing.
       */
      case 'giphy-next': {
        const s = await this.load();
        let feed = s.giphy[body.query] ?? { urls: [], offset: 0, cursor: 0 };
        if (feed.cursor >= feed.urls.length) {
          // ponytail: two scanners hitting the page seam at once both refill,
          // and the loser's save costs one repeated gif. A per-query lock if
          // that ever shows.
          try {
            let offset = feed.offset + feed.urls.length;
            let page = await searchGifs(body.key, body.query, offset);
            if (page.length === 0 && offset > 0) {
              offset = 0;
              page = await searchGifs(body.key, body.query, 0);
            }
            feed = { urls: page.map((gif) => gif.url), offset, cursor: 0 };
          } catch (err) {
            // Giphy down or the key revoked: the scan falls back, not errors.
            console.warn('giphy feed refill failed', err);
            return json({ url: null });
          }
        }
        const url = feed.urls[feed.cursor] ?? null;
        if (url && !body.peek) feed.cursor += 1;
        s.giphy[body.query] = feed;
        await this.save(s);
        return json({ url });
      }

      case 'login-guard': {
        const guard = (await this.state.storage.get<LoginGuard>('login')) ?? {
          failures: 0,
          lockedUntil: 0,
        };
        if (body.action === 'check') {
          return json({ locked: guard.lockedUntil > body.now, until: guard.lockedUntil });
        }
        if (body.action === 'fail') {
          guard.failures += 1;
          if (guard.failures >= LOGIN_MAX_ATTEMPTS) {
            guard.lockedUntil = body.now + LOGIN_LOCKOUT_MS;
            guard.failures = 0;
          }
          await this.state.storage.put('login', guard);
          return json({ locked: guard.lockedUntil > body.now, until: guard.lockedUntil });
        }
        await this.state.storage.put('login', { failures: 0, lockedUntil: 0 });
        return json({ locked: false, until: 0 });
      }

      default:
        return new Response('unknown op', { status: 404 });
    }
  }

  /**
   * Fires when a temp expires. Purely cosmetic: it wakes the object so an open
   * admin panel sees the cleared slot promptly. The resolver had already
   * stopped serving this temp the instant it expired.
   */
  async alarm(): Promise<void> {
    const now = Date.now();
    const s = await this.load();
    let changed = false;

    if (s.temp && s.temp.expiresAt <= now) {
      s.temp = null;
      changed = true;
    }
    if (s.sequence && s.sequence.expiresAt > 0 && s.sequence.expiresAt <= now) {
      s.sequence.expiresAt = 0;
      s.sequence.cursor = s.sequence.steps.length;
      changed = true;
    }
    if (changed) await this.save(s);
  }
}

/** Fisher-Yates, in place, seeded from the platform CSPRNG. */
function shuffle(items: string[]): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
}

function pushMru(mru: MruEntry[], target: Target, now: number): MruEntry[] {
  const id = targetKey(target);
  const without = mru.filter((entry) => targetKey(entry.target) !== id);
  return [{ target, at: now }, ...without].slice(0, MRU_MAX);
}

function json(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    headers: { 'content-type': 'application/json' },
  });
}
