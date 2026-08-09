import type { Bookmark, MruEntry, State, StoredFile, Target } from './types';

const EMPTY: State = {
  main: null,
  temp: null,
  splash: false,
  bookmarks: [],
  mru: [],
  files: [],
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
        await this.save(s);
        return json(s);
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
    const s = await this.load();
    if (s.temp && s.temp.expiresAt <= Date.now()) {
      s.temp = null;
      await this.save(s);
    }
  }
}

function pushMru(mru: MruEntry[], target: Target, now: number): MruEntry[] {
  const id = target.kind === 'url' ? target.url : target.key;
  const without = mru.filter((e) =>
    e.target.kind === 'url' ? e.target.url !== id : e.target.key !== id,
  );
  return [{ target, at: now }, ...without].slice(0, MRU_MAX);
}

function json(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    headers: { 'content-type': 'application/json' },
  });
}
