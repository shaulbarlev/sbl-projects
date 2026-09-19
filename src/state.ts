import { searchGifs } from './giphy';
import { targetKey } from './resolve';
import { HOME_ENTITIES, PARTY } from './traffic';
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
  trafficEnabled: false,
  partyEnabled: false,
  hits: 0,
};

/** What the home agent last reported for the lamps. */
interface HomeCache {
  states: Record<string, string>;
  updatedAt: number;
}

/** How long a toggle waits for the agent before giving up. */
const HOME_CALL_TIMEOUT_MS = 4000;
/**
 * A ceiling per lamp per day, and no floor: every tap lands, as fast as the
 * relay can click. The ceiling is against a runaway script, not a person —
 * a relay is good for a hundred thousand cycles, and the agent has its own
 * per-lamp rate guard as the last line.
 */
const HOME_CALLS_PER_DAY = 2000;
/** The party button is a mood, not a relay: far fewer flips a day. */
const PARTY_CALLS_PER_DAY = 100;
/** What a tap may ask of a lamp. Mirrored in the agent's allowlist. */
const HOME_SERVICES = new Set(['toggle', 'turn_on', 'turn_off']);
/**
 * Open page sockets at once. ponytail: plenty for one toy; someone holding
 * all twenty just breaks the page for others, and the floors bound the
 * relays either way.
 */
const MAX_PAGES = 20;

/** Toggles used today, per lamp. */
interface HomeQuota {
  day: string;
  counts: Record<string, number>;
}

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
  /** Replies the home agent owes, by call id. Only populated during a call. */
  private pending = new Map<
    string,
    { resolve: (reply: any) => void; timer: ReturnType<typeof setTimeout> }
  >();
  constructor(private state: DurableObjectState) {
    // A keepalive the agent can use without waking a hibernated object.
    state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

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

      /* ------------------------------------------------------------- home */

      /**
       * The home agent's socket. Hibernatable, so an idle connection costs
       * nothing and the runtime wakes this object with the socket attached
       * when a message arrives. Auth happened in the Worker.
       */
      case 'agent': {
        if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
          return new Response('Expected a websocket', { status: 426 });
        }
        // One agent. A reconnect replaces the old socket rather than
        // leaving a stale one that calls could still be routed to.
        for (const old of this.agents()) old.close(1000, 'replaced');
        const pair = new WebSocketPair();
        this.state.acceptWebSocket(pair[1], ['agent']);
        // Resync home's mirrors of both switches after any outage.
        const s = await this.load();
        pair[1].send(JSON.stringify({ type: 'switch', on: s.trafficEnabled }));
        pair[1].send(JSON.stringify({ type: 'switch', name: 'party', on: s.partyEnabled }));
        await this.broadcast({ online: true });
        return new Response(null, { status: 101, webSocket: pair[0] });
      }

      /**
       * A scanner's page. It hears every state change the moment the agent
       * reports it, and taps travel the same way — no request, no poll.
       */
      case 'page': {
        if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
          return new Response('Expected a websocket', { status: 426 });
        }
        if (!(await this.load()).trafficEnabled) return new Response('Off', { status: 404 });
        if (this.state.getWebSockets('page').length >= MAX_PAGES) {
          return new Response('Busy', { status: 503 });
        }
        const pair = new WebSocketPair();
        this.state.acceptWebSocket(pair[1], ['page']);
        // Who is looking, for the ledger at home. Kept on the socket rather
        // than in storage: it is worth nothing once the page closes, and an
        // attachment survives hibernation, which a field on `this` does not.
        pair[1].serializeAttachment({
          ip: url.searchParams.get('ip') ?? '',
          ua: (url.searchParams.get('ua') ?? '').slice(0, 300),
          lang: (url.searchParams.get('lang') ?? '').slice(0, 100),
          geo: (url.searchParams.get('geo') ?? '').slice(0, 120),
          at: Date.now(),
        });
        pair[1].send(JSON.stringify({ type: 'state', ...(await this.homeView()) }));
        return new Response(null, { status: 101, webSocket: pair[0] });
      }


      case 'set-traffic': {
        const s = await this.load();
        const on = Boolean(body.on);
        const changed = s.trafficEnabled !== on;
        s.trafficEnabled = on;
        await this.save(s);
        // Home keeps a mirror of this switch. Only a real change is sent, so
        // the echo Home Assistant makes when it hears it dies in one round.
        if (changed) this.tellHome({ type: 'switch', on });
        return json(s);
      }

      case 'set-party': {
        const s = await this.load();
        const on = Boolean(body.on);
        const changed = s.partyEnabled !== on;
        s.partyEnabled = on;
        await this.save(s);
        if (changed) {
          this.tellHome({ type: 'switch', name: 'party', on });
          await this.broadcast();
        }
        return json(s);
      }

      // One round trip answers everything the page asks: whether the light is
      // on at all, whether home is reachable, and what the lamps show. Each
      // Worker-to-object hop costs real time from a far edge.
      case 'home-state':
        return json(await this.homeView());

      /**
       * Ask the agent to flip one lamp and wait for its answer. The entity is
       * checked here and again at home; the agent's allowlist is the one
       * that matters if this code is ever compromised.
       */
      case 'home-call':
        return json(await this.callHome(String(body.entity ?? ''), String(body.service ?? 'toggle')));

      // Home Assistant reporting the lamps itself, through an automation
      // that posts on every change and on request. The agent no longer
      // needs a Home Assistant credential to know what the lamps show.
      case 'home-report':
        await this.mergeStates(body.states);
        return json({ ok: true });

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

  /* --------------------------------------------------------- home socket */

  private agents(): WebSocket[] {
    // A replaced or dropped socket can linger in the list until its close
    // completes; only an open one counts. 1 is OPEN.
    return this.state.getWebSockets('agent').filter((ws) => ws.readyState === 1);
  }

  /**
   * Ask the agent to set one lamp and wait for its answer. Calls are not
   * serialised here: a burst of taps goes down the socket as fast as it
   * arrives, each with its own id, and the agent keeps them in order per
   * lamp. The entity and service are checked here and again at home; the
   * agent's allowlist is the one that matters if this code is ever
   * compromised. Answers with how long the agent and Home Assistant took,
   * or an error.
   */
  private async callHome(entity: string, service: string): Promise<Record<string, unknown>> {
    // Cheapest refusals first; the storage reads come after.
    if (!HOME_ENTITIES.has(entity) || !HOME_SERVICES.has(service)) return { error: 'unknown' };
    const agent = this.agents().at(-1);
    if (!agent) return { error: 'offline', ...(await this.homeView()) };
    const now = Date.now();
    const s = await this.load();
    if (!s.trafficEnabled) return { error: 'off' };
    if (entity === PARTY.entity && !s.partyEnabled) return { error: 'off' };
    if (!(await this.takeQuota(entity, now))) return { error: 'quota', ...(await this.homeView()) };
    // Home only knows "on" and "off": the webhook there sets a state rather
    // than toggling, so a toggle is resolved here from the last known state.
    if (service === 'toggle') {
      service = (await this.homeCache()).states[entity] === 'on' ? 'turn_off' : 'turn_on';
    }

    const id = crypto.randomUUID();
    const reply = new Promise<any>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ error: 'timeout' });
      }, HOME_CALL_TIMEOUT_MS);
      this.pending.set(id, { resolve, timer });
    });
    const sent = Date.now();
    agent.send(JSON.stringify({ type: 'call', id, entity, service }));
    const result = await reply;
    const agentMs = Date.now() - sent;
    if (result.states) await this.mergeStates(result.states);
    if (result.error || result.ok === false) {
      return { error: String(result.error ?? 'failed'), ...(await this.homeView()) };
    }
    // Success carries no state on purpose: the page already flipped the lamp,
    // and the truth arrives as a push when the device reports. Painting a
    // possibly stale view here would flicker it back and forth.
    return { ok: true, agentMs, haMs: result.haMs ?? null };
  }

  /** A message for home, if home is connected. */
  private tellHome(message: Record<string, unknown>): void {
    const agent = this.agents().at(-1);
    if (!agent) return;
    try {
      agent.send(JSON.stringify(message));
    } catch {
      // Closing; the resync on reconnect covers it.
    }
  }

  /** Tell every open page what the lamps show now. */
  private async broadcast(patch: Record<string, unknown> = {}): Promise<void> {
    const pages = this.state.getWebSockets('page');
    if (!pages.length) return;
    const payload = JSON.stringify({ type: 'state', ...(await this.homeView()), ...patch });
    for (const page of pages) {
      try {
        page.send(payload);
      } catch {
        // Closing; it will be gone from the list next time.
      }
    }
  }

  private async homeCache(): Promise<HomeCache> {
    return (await this.state.storage.get<HomeCache>('home')) ?? { states: {}, updatedAt: 0 };
  }

  /** Count one toggle against today's ceiling for a lamp. False when spent. */
  private async takeQuota(entity: string, now: number): Promise<boolean> {
    const day = new Date(now).toISOString().slice(0, 10);
    let quota = await this.state.storage.get<HomeQuota>('homeQuota');
    if (!quota || quota.day !== day) quota = { day, counts: {} };
    const used = quota.counts[entity] ?? 0;
    if (used >= (entity === PARTY.entity ? PARTY_CALLS_PER_DAY : HOME_CALLS_PER_DAY)) return false;
    quota.counts[entity] = used + 1;
    await this.state.storage.put('homeQuota', quota);
    return true;
  }

  /** What the traffic page and the panel need to know, in one answer. */
  private async homeView() {
    const [s, cache] = await Promise.all([this.load(), this.homeCache()]);
    return { enabled: s.trafficEnabled, party: s.partyEnabled, online: this.agents().length > 0, ...cache };
  }

  /** Remember what the agent reports, for the known lamps only. */
  private async mergeStates(states: unknown): Promise<void> {
    if (!states || typeof states !== 'object') return;
    const cache = await this.homeCache();
    for (const [entity, value] of Object.entries(states as Record<string, unknown>)) {
      if (HOME_ENTITIES.has(entity) && typeof value === 'string') {
        cache.states[entity] = value.slice(0, 32);
      }
    }
    cache.updatedAt = Date.now();
    await this.state.storage.put('home', cache);
    await this.broadcast();
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string' || message.length > 4096) return;
    let msg: any;
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }
    // The tag decides what a socket may say. A page can tap; only the agent
    // can report state or answer a call.
    const tags = this.state.getTags(ws);
    if (tags.includes('agent')) {
      if (msg?.type === 'reply' && typeof msg.id === 'string') {
        const waiting = this.pending.get(msg.id);
        if (waiting) {
          clearTimeout(waiting.timer);
          this.pending.delete(msg.id);
          waiting.resolve(msg);
        }
      }
      if (msg?.states) await this.mergeStates(msg.states);
      return;
    }
    if (tags.includes('page') && msg?.type === 'player') {
      // Somebody who played answered the prompt, or waved it away. One line
      // down to home, fire and forget: if the agent is not connected the
      // visit goes unrecorded, which is the price of having no buffer here.
      const who = (ws.deserializeAttachment() ?? {}) as Record<string, unknown>;
      // One record per page, ever. A real page asks once; without this a
      // socket can write to a disk at home as fast as the wire allows, and
      // the writes queue in front of the taps that actually matter.
      if (who.reported) return;
      ws.serializeAttachment({ ...who, reported: true });
      const dismissed = msg.dismissed === true;
      this.tellHome({
        // Spread first: what the page said must never overwrite what the
        // agent dispatches on, and `type` is how it tells a record from a
        // lamp call.
        ...who,
        // A refusal is still a person. It is counted, but it does not buy a
        // record of their address and browser.
        ...(dismissed ? { ip: undefined, ua: undefined, lang: undefined } : {}),
        type: 'player',
        // Control characters would ruin a line-per-record file at home.
        name: String(msg.name ?? '').replace(/[\x00-\x1f\x7f-\x9f]/g, '').trim().slice(0, 40),
        dismissed,
        browser: String(msg.id ?? '').replace(/[^\w-]/g, '').slice(0, 32),
        taps: clamp(msg.taps, 10000),
        seconds: clamp(msg.seconds, 86400),
        reported: undefined,
      });
      return;
    }
    if (tags.includes('page') && (msg?.type === 'toggle' || msg?.type === 'set')) {
      // A tap says which state it wants. Two fast taps as "toggle" could both
      // read the same old state at home and land the same way; "on" then
      // "off" always land as on then off.
      const service = msg.type === 'toggle' ? 'toggle' : msg.state === 'on' ? 'turn_on' : 'turn_off';
      const result = await this.callHome(String(msg.entity ?? ''), service);
      ws.send(JSON.stringify({ type: 'result', entity: msg.entity, ...result }));
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      // Already closed; nothing to finish.
    }
    if (this.state.getTags(ws).includes('agent')) await this.broadcast({ online: false });
  }

  async webSocketError(_ws: WebSocket, error: unknown): Promise<void> {
    console.warn('home agent socket error', error);
  }
}

/**
 * A count a stranger sent: a whole number between zero and a ceiling.
 * `Number()` alone lets through negatives, Infinity and NaN, all of which
 * reach the ledger as nonsense.
 */
function clamp(value: unknown, ceiling: number): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, ceiling);
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
