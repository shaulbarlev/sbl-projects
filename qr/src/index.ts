import {
  checkBearer,
  checkPassword,
  clearedCookie,
  hasCsrfHeader,
  isAuthed,
  issueSession,
  readCookie,
  sessionCookie,
} from './auth';
import { adminPage, loginPage, MANIFEST } from './admin/page';
import { searchGifs } from './giphy';
import { renderMessage } from './message';
import { qrSvg } from './qr';
import { describeTarget, isServable, resolve, sequenceLive, sequenceRunOpen, stepTarget, stepsRemaining, targetToUrl } from './resolve';
import { DEFAULT_TEMPLATE_ID, renderSplash } from './splash';
import { HOME_ENTITIES, LIGHTS, PARTY, renderTraffic } from './traffic';
import type { Env, Resolution, SequenceStep, State, StoredFile, Target } from './types';
import { clampDuration, validateUrl } from './validate';

export { RedirectState } from './state';

/**
 * Link unfurlers. They hit the URL when you paste it into a chat, and with
 * splash on they would scrape the splash page and unfurl nonsense — so they get
 * a plain redirect and can unfurl the real destination instead.
 */
const UNFURLER = /bot|crawler|spider|slack|discord|facebookexternalhit|twitterbot|whatsapp|telegram|linkedinbot|preview|skypeuripreview|embedly|quora link preview|redditbot|applebot|pinterest|vkshare|nuzzel|bitlybot|google-inspectiontool/i;

/** Cookie holding a scanner's claim on one sequence step: `<runId>.<index>`. */
const STEP_COOKIE = 'skin_step';
const STEP_COOKIE_MAX_AGE = 12 * 60 * 60;

/**
 * A request that must never consume a sequence step.
 *
 * Browsers speculatively fetch links, and iOS/Chrome announce it with these
 * headers. Without this check a prefetch would silently burn the step meant
 * for the person actually standing in front of you.
 */
function isSpeculative(request: Request): boolean {
  if (request.method === 'HEAD') return true;
  const headers = request.headers;
  const purpose = (
    headers.get('sec-purpose') ??
    headers.get('purpose') ??
    headers.get('x-purpose') ??
    headers.get('x-moz') ??
    ''
  ).toLowerCase();
  return /prefetch|preview|prerender/.test(purpose);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // The panel and its API answer their own failures: a malformed request is
    // a 400 to whoever sent it, not a page.
    if (path === '/_' || path.startsWith('/_/')) {
      try {
        return await handleAdmin(request, env, url);
      } catch (err) {
        console.error('admin', err);
        return json({ error: 'Bad request' }, 400);
      }
    }

    try {
      // The other domains are custom domains of this Worker too, each with a
      // setting of its own; www. is the same domain.
      const domain = url.hostname.replace(/^www\./, '');
      if (DOMAINS.has(domain)) return await handleDomain(request, env, url, domain);
      if (path.startsWith('/f/')) return await serveFile(request, env, path);
      if (path === '/traffic' || path.startsWith('/traffic/')) {
        return await handleTraffic(request, env, ctx, url);
      }
      // The root is the QR's; every other path is the site's.
      if (path !== '/' && env.SITE) return await env.SITE.fetch(request);
      return await handleRedirect(request, env, ctx, url);
    } catch (err) {
      console.error('unhandled', err);
      // A QR that resolves to a stack trace is worse than one that resolves
      // somewhere boring.
      return Response.redirect(env.FALLBACK_URL, 302);
    }
  },
};

/**
 * The one object. An object lives forever at the colo that first created
 * it, and the original `default` was created far from home, so every hop
 * paid a long round trip. Renamed once (2026-09-14) to recreate it under a
 * location hint; the old object was copied in (a one-off export-all /
 * import-all pair, since removed — see git history) and then orphaned.
 * Rename again to move again.
 */
function stub(env: Env, slug = '') {
  return env.STATE.get(env.STATE.idFromName(slug || 'default-il'), { locationHint: 'me' });
}

async function callState(env: Env, op: string, body?: unknown): Promise<any> {
  const response = await stub(env).fetch(`https://do/${op}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return response.json();
}

/* ------------------------------------------------------------------ public */

async function handleRedirect(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
): Promise<Response> {
  const now = Date.now();
  const state = (await callState(env, 'get')) as State;
  const agent = request.headers.get('user-agent') ?? '';
  const isRobot = UNFURLER.test(agent);

  let resolution: Resolution = resolve(state, now, env.FALLBACK_URL);
  let claimCookie: string | null = null;

  // sequenceRunOpen, not sequenceLive: a scanner who already holds a claim
  // keeps their step even after the last one has been handed out.
  if (sequenceRunOpen(state, now) && !isRobot) {
    const claimed = await claimStep(request, env, state, now);
    if (claimed) {
      resolution = {
        source: 'sequence',
        target: claimed.target,
        stepIndex: claimed.index,
        total: state.sequence!.steps.length,
        expiresAt: state.sequence!.expiresAt,
      };
      claimCookie = claimed.cookie;
    }
  }

  // Counted after the response is on its way — telemetry never delays a scan.
  ctx.waitUntil(callState(env, 'hit', {}));

  const headers = new Headers({
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
  });
  if (claimCookie) headers.append('set-cookie', claimCookie);

  // Nothing set: the site is here.
  if (resolution.source === 'fallback' && env.SITE) {
    const page = await env.SITE.fetch(request);
    if (!claimCookie) return page;
    const withClaim = new Response(page.body, page);
    withClaim.headers.append('set-cookie', claimCookie);
    return withClaim;
  }

  return serve(request, env, state, resolution.target, headers, claimCookie, url.origin);
}

/**
 * Serve a target: draw from a set or a feed, render a message or the light in
 * place, show the splash, or redirect. Shared by the QR's root and the other
 * domains, so every kind of destination works the same on each.
 * `fileOrigin` is where a file's URL points: the QR's own origin at the root,
 * sbl.cx from another domain (whose paths are all the site's).
 */
async function serve(
  request: Request,
  env: Env,
  state: State,
  target: Target,
  headers: Headers,
  claimCookie: string | null,
  fileOrigin: string,
): Promise<Response> {
  const isRobot = UNFURLER.test(request.headers.get('user-agent') ?? '');
  const site = async () => {
    if (!env.SITE) {
      headers.set('location', env.FALLBACK_URL);
      return new Response(null, { status: 302, headers });
    }
    const page = await env.SITE.fetch(request);
    if (!claimCookie) return page;
    const withClaim = new Response(page.body, page);
    withClaim.headers.append('set-cookie', claimCookie);
    return withClaim;
  };

  // An image set resolves to a different file on every scan. The draw happens
  // in the Durable Object so that concurrent scanners advance the same bag
  // instead of racing over it.
  //
  // A draw is consumable, exactly like a sequence step, so it gets the same
  // guards: an unfurler previewing the link in a chat, a browser prefetching
  // it, and a HEAD request all *peek* at the image the next real scanner will
  // get without taking it. Without this, pasting the code into a group chat
  // burns an image per preview — and the person who then scans sees a repeat,
  // which is precisely what the shuffled bag exists to prevent.
  let served: Target = target;
  if (served.kind === 'pool') {
    const peek = isRobot || isSpeculative(request);
    const drawn = (await callState(env, 'pool-draw', { poolId: served.poolId, peek })) as { key: string | null };
    const file = drawn.key ? state.files.find((f) => f.key === drawn.key) : null;
    // The set emptied out from under us between read and draw: nothing to serve.
    if (!file) return site();
    served = { kind: 'file', key: file.key, name: file.name };
  }

  // A GIF feed is a live search: every real scan takes the next result, under
  // the same peek rule as a draw. Without a key there is no feed.
  if (served.kind === 'giphy') {
    const peek = isRobot || isSpeculative(request);
    const next = env.GIPHY_API_KEY
      ? ((await callState(env, 'giphy-next', { query: served.query, key: env.GIPHY_API_KEY, peek })) as { url: string | null })
      : { url: null };
    if (!next.url) return site();
    served = { kind: 'url', url: next.url };
  }

  // A text target is the destination, so there is nothing to redirect to and
  // nothing for a splash to precede. The traffic light takes over the root
  // the same way.
  if (served.kind === 'text' || served.kind === 'traffic') {
    headers.set('content-type', 'text/html; charset=utf-8');
    const page = served.kind === 'text' ? renderMessage(served.text) : renderTraffic();
    return new Response(page, { headers });
  }

  const destination = targetToUrl(served, fileOrigin);

  // A link to the site itself: the site is here, not a hop away (so a
  // destination of the site's old address cannot loop). A file lives on this
  // host too, at /f/, and is not the site.
  if (served.kind === 'url' && isSite(destination, env.FALLBACK_URL)) {
    // The site's own path, when the link names one: a main of sbl.cx/doorlock/ shows that project.
    return env.SITE ? env.SITE.fetch(new Request(destination, request)) : site();
  }

  if (state.splash && !isRobot) {
    headers.set('content-type', 'text/html; charset=utf-8');
    return new Response(
      renderSplash(DEFAULT_TEMPLATE_ID, { targetUrl: destination, label: describeTarget(served, state) }),
      { headers },
    );
  }

  // 302, never 301: a cached permanent redirect poisons the QR on every device
  // that ever scanned it, and there is no way to un-ring that bell.
  headers.set('location', destination);
  return new Response(null, { status: 302, headers });
}

/** The site's own addresses: the domain the QR lives on, the old ones, and the configured fallback. */
const SITE_HOSTS = new Set(['sbl.cx', 'shaulb.com', 'www.shaulb.com', 'shaulbarlev.com', 'www.shaulbarlev.com']);
function isSite(destination: string, fallbackUrl: string): boolean {
  try {
    const host = new URL(destination).hostname;
    return SITE_HOSTS.has(host) || host === new URL(fallbackUrl).hostname;
  } catch {
    return false;
  }
}

/**
 * Work out which sequence step this visitor gets.
 *
 * With `stickySteps` on, a step is claimed once per device and then sticks:
 * reloading, locking the phone, or coming back later shows the same message,
 * for holding the screen up while four phones get arranged. Off, no claim is
 * recorded and every real scan — a refresh included — takes the next step.
 * Either way, only a genuine scan consumes one.
 */
async function claimStep(
  request: Request,
  env: Env,
  state: State,
  now: number,
): Promise<{ index: number; target: Target; cookie: string | null } | null> {
  const sequence = state.sequence!;
  const sticky = state.stickySteps;

  const existing = sticky ? readCookie(request, STEP_COOKIE) : null;
  if (existing) {
    const separator = existing.lastIndexOf('.');
    const runId = existing.slice(0, separator);
    const index = Number(existing.slice(separator + 1));
    if (runId === sequence.runId) {
      const target = stepTarget(state, index);
      // A stale or forged index falls through to normal resolution rather than
      // claiming a fresh step, so a tampered cookie cannot drain the queue.
      if (target) return { index, target, cookie: null };
      return null;
    }
  }

  if (isSpeculative(request)) {
    // Serve what the next real scanner would get, but do not consume it.
    const target = stepTarget(state, sequence.cursor);
    return target ? { index: sequence.cursor, target, cookie: null } : null;
  }

  // A step that cannot be served right now — an emptied set, the traffic
  // light with its switch off — is not worth burning. Fall through instead.
  if (!stepTarget(state, sequence.cursor)) return null;

  const claimed = (await callState(env, 'burn-step', { now })) as {
    index: number | null;
    runId?: string;
  };
  if (claimed.index === null) return null;

  const target = stepTarget(state, claimed.index);
  if (!target) return null;

  if (!sticky) return { index: claimed.index, target, cookie: null };

  return {
    index: claimed.index,
    target,
    cookie: [
      `${STEP_COOKIE}=${claimed.runId}.${claimed.index}`,
      'Path=/',
      'HttpOnly',
      'Secure',
      // Lax, not Strict: a scan often arrives as a cross-site navigation from
      // the camera or another app, and Strict would drop the claim.
      'SameSite=Lax',
      `Max-Age=${STEP_COOKIE_MAX_AGE}`,
    ].join('; '),
  };
}

/** The domains that can be pointed on their own from the panel (sbl.cx is the QR, with its slots). */
export const DOMAINS: ReadonlySet<string> = new Set(['shaulb.com', 'shaulbarlev.com']);
const HOME_URL = 'https://sbl.cx';

/**
 * One of the other domains. Pointed at something from the panel, it serves it
 * exactly as the QR would (a set draws per scan, a message renders in place,
 * the splash applies); otherwise it is the site, at its own address. Only
 * sbl.cx follows the QR's temp and main.
 */
async function handleDomain(request: Request, env: Env, url: URL, domain: string): Promise<Response> {
  const state = (await callState(env, 'get')) as State;
  const slot = state.domains[domain];
  const target = slot && isServable(state, slot.target) ? slot.target : null;
  if (!target) {
    if (env.SITE) return env.SITE.fetch(request);
    return Response.redirect(HOME_URL + url.pathname + url.search, 302);
  }
  const headers = new Headers({ 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
  return serve(request, env, state, target, headers, null, HOME_URL);
}

/**
 * The traffic light page and its two calls, public while the master switch
 * is on. Off, the path does not exist: it resolves like any stray path.
 */
async function handleTraffic(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
): Promise<Response> {
  const path = url.pathname;

  // The page's own socket: state pushed as it changes, taps as messages.
  // The object owns it, so this is a hand-off, not a round trip.
  if (path === '/traffic/ws') {
    // What the ledger will record about this visit, read here because the
    // object never sees the original request. All of it is what any web
    // server is handed; nothing is probed on the device.
    const cf = (request as unknown as { cf?: Record<string, unknown> }).cf ?? {};
    // Cut and clean here rather than at the object: a header is whatever the
    // client felt like sending, and a 32 KB user-agent should not become a
    // 100 KB internal URL on its way to being trimmed.
    const header = (name: string, max: number) =>
      (request.headers.get(name) ?? '').replace(/[\x00-\x1f\x7f-\x9f]/g, '').slice(0, max);
    const who = new URLSearchParams({
      ip: header('cf-connecting-ip', 45),
      ua: header('user-agent', 300),
      lang: header('accept-language', 100),
      geo: [cf.country, cf.city, cf.asOrganization].filter(Boolean).join(' / ').slice(0, 120),
    });
    return stub(env).fetch(new Request(`https://do/page?${who}`, request));
  }

  // One object round trip per call: a far edge pays a few hundred
  // milliseconds for each hop, and the timing header says how much.
  if (path === '/traffic/toggle' && request.method === 'POST') {
    // The page is public, so the only guard is against cross-site posts: a
    // form on another origin cannot set this header.
    if (!hasCsrfHeader(request)) return json({ error: 'Missing request header' }, 403);
    // Anonymous input: a tap is a few dozen bytes, so anything larger is
    // refused before it is read.
    if (Number(request.headers.get('content-length') ?? 0) > 256) return json({ error: 'Too large' }, 413);
    const body = (await request.json().catch(() => ({}))) as { entity?: string; state?: string };
    if (!body.entity || !HOME_ENTITIES.has(body.entity)) return json({ error: 'Unknown light' }, 400);
    // `state` names the outcome; without it the lamp toggles.
    const service = body.state === 'on' ? 'turn_on' : body.state === 'off' ? 'turn_off' : 'toggle';
    const started = Date.now();
    const result = await callState(env, 'home-call', { entity: body.entity, service });
    const status = result.error
      ? ({ off: 404, offline: 503, quota: 429, timeout: 504 }[result.error as string] ?? 502)
      : 200;
    return new Response(JSON.stringify(result), {
      status,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        'server-timing': `do;dur=${Date.now() - started}, agent;dur=${result.agentMs ?? 0}, ha;dur=${result.haMs ?? 0}`,
      },
    });
  }

  const home = await callState(env, 'home-state');
  // The embedded copy has nowhere to redirect to: switched off, it shows its
  // lamps dark (the socket is refused and polling reports the switch off).
  const bare = url.searchParams.has('bare');
  if (!home.enabled && !bare) return env.SITE ? env.SITE.fetch(request) : handleRedirect(request, env, ctx, url);

  if (path === '/traffic' || path === '/traffic/') return html(renderTraffic(bare));
  if (path === '/traffic/state' && request.method === 'GET') return json(home);

  return json({ error: 'Not found' }, 404);
}

async function serveFile(request: Request, env: Env, path: string): Promise<Response> {
  const key = path.split('/')[2];
  if (!key) return new Response('Not found', { status: 404 });

  // A video asks for pieces: Safari will not play one at all from a server that
  // cannot answer a range request. Only `bytes=a-b` and `bytes=a-` are honoured.
  const wanted = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get('range') ?? '');
  const range = wanted ? { offset: Number(wanted[1]), ...(wanted[2] ? { length: Number(wanted[2]) - Number(wanted[1]) + 1 } : {}) } : undefined;
  const object = await env.FILES.get(key, range ? { range } : undefined);
  if (!object) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('accept-ranges', 'bytes');
  headers.set('cache-control', 'public, max-age=3600');
  // Uploads are unrestricted by design, and they are served from the same
  // origin as the admin panel. `sandbox` is what stops an uploaded .html or
  // .svg from running script against that origin and lifting the session
  // cookie; `nosniff` stops the browser from inventing a type we did not send.
  headers.set('content-security-policy', 'sandbox');
  headers.set('x-content-type-options', 'nosniff');
  if (!headers.has('content-disposition')) {
    headers.set('content-disposition', 'inline');
  }
  if (range && object.range && 'offset' in object.range && object.range.offset !== undefined) {
    const offset = object.range.offset;
    const length = object.range.length ?? object.size - offset;
    headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set('content-length', String(length));
    return new Response(object.body, { status: 206, headers });
  }
  return new Response(object.body, { headers });
}

/* ------------------------------------------------------------------- admin */

async function handleAdmin(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;
  const now = Date.now();

  if (path === '/_' ) return Response.redirect(`${url.origin}/_/`, 302);

  if (path === '/_/login') {
    if (request.method === 'GET') return html(loginPage(url.host));
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

    const guard = await callState(env, 'login-guard', { action: 'check', now });
    if (guard.locked) {
      return html(loginPage(url.host, 'Too many attempts. Try again later.'), 429);
    }

    const form = await request.formData();
    const supplied = String(form.get('password') ?? '');
    if (!(await checkPassword(supplied, env))) {
      await callState(env, 'login-guard', { action: 'fail', now });
      return html(loginPage(url.host, 'Incorrect password.'), 401);
    }

    await callState(env, 'login-guard', { action: 'reset', now });
    const token = await issueSession(env, now);
    return new Response(null, {
      status: 303,
      headers: {
        location: '/_/',
        'set-cookie': sessionCookie(token, 30 * 24 * 60 * 60),
      },
    });
  }

  if (path === '/_/manifest.webmanifest') {
    return new Response(MANIFEST, { headers: { 'content-type': 'application/manifest+json' } });
  }

  if (path === '/_/agent' || path === '/_/agent/state' || path === '/_/agent/traffic' || path === '/_/agent/party') {
    // The home side: the agent's socket, Home Assistant's own state pushes,
    // and Home Assistant's copy of the master switch. All carry AGENT_TOKEN,
    // and all are deliberately outside the login lockout — a random
    // 48-character token compared in constant time needs none, and sharing
    // the counter would let a stranger's bad guesses at the password keep
    // the light offline.
    if (!(await checkBearer(request, env.AGENT_TOKEN))) return json({ error: 'Bad token' }, 401);
    if (path === '/_/agent') return stub(env).fetch(new Request('https://do/agent', request));
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    if (Number(request.headers.get('content-length') ?? 0) > 4096) return json({ error: 'Too large' }, 413);
    const body = (await request.json().catch(() => ({}))) as { states?: unknown; on?: unknown };
    if (path === '/_/agent/traffic' || path === '/_/agent/party') {
      // "on"/"off" as strings too: that is what a Home Assistant template
      // renders most naturally.
      const on = body.on === true || body.on === 'on' || body.on === 'true';
      await callState(env, path.endsWith('party') ? 'set-party' : 'set-traffic', { on });
      return json({ on });
    }
    await callState(env, 'home-report', { states: body.states });
    return json({ ok: true });
  }

  const bearer = await checkBearer(request, env.API_TOKEN);
  if (bearer !== null) {
    // Scripts and Shortcuts. Under the same lockout as the login form, or the
    // token would be the brute-force path around it.
    const guard = await callState(env, 'login-guard', { action: 'check', now });
    if (guard.locked) return json({ error: 'Too many attempts. Try again later.' }, 429);
    if (!bearer) {
      await callState(env, 'login-guard', { action: 'fail', now });
      return json({ error: 'Bad token' }, 401);
    }
  } else if (!(await isAuthed(request, env, now))) {
    if (path.startsWith('/_/api/')) return json({ error: 'Unauthorised' }, 401);
    return Response.redirect(`${url.origin}/_/login`, 302);
  }

  if (path === '/_/logout') {
    return new Response(null, {
      status: 303,
      headers: { location: '/_/login', 'set-cookie': clearedCookie },
    });
  }

  if (path === '/_/' || path === '/_/index.html') {
    return html(adminPage(url.host));
  }

  if (path === '/_/qr.svg') {
    // Always https, never url.protocol: this code gets printed, and encoding
    // http:// would cost every future scan an extra redirect hop forever.
    return new Response(qrSvg(`https://${url.host}/`), {
      headers: { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' },
    });
  }

  if (path === '/_/export.json') {
    const state = await callState(env, 'get');
    return new Response(JSON.stringify(state, null, 2), {
      headers: {
        'content-type': 'application/json',
        'content-disposition': 'attachment; filename="skin-state.json"',
      },
    });
  }

  if (path.startsWith('/_/api/')) return handleApi(request, env, url, now);

  return new Response('Not found', { status: 404 });
}

async function handleApi(request: Request, env: Env, url: URL, now: number): Promise<Response> {
  const route = url.pathname.slice('/_/api/'.length);

  if (request.method !== 'GET' && !hasCsrfHeader(request)) {
    return json({ error: 'Missing request header' }, 403);
  }

  if (route === 'state' && request.method === 'GET') {
    return json(await view(env));
  }

  // The one write for "point the code at this". Every action on the Send
  // sheet lands here; the slot is the only thing that differs between them.
  if (route === 'send' && request.method === 'POST') {
    const body = (await request.json()) as SendBody;
    // The flat form is for scripts and Shortcuts, where a nested object is a
    // chore: `{"text": "hi"}` alone is a one-hour temporary message.
    const target = normaliseTarget(body.target ?? (await flatTarget(env, body)));
    if ('error' in target) return json({ error: target.error }, 400);
    const sent = await applySend(env, body.slot ?? 'temp', target.value, durationOf(body, 60), now);
    if ('error' in sent) return json({ error: sent.error }, 400);
    return json(await view(env, sent.state));
  }

  // A domain with no setting is the site.
  if (route.startsWith('domain/') && request.method === 'DELETE') {
    const host = route.slice('domain/'.length);
    if (!DOMAINS.has(host)) return json({ error: 'Unknown domain' }, 400);
    return json(await view(env, (await callState(env, 'clear-domain', { host })) as State));
  }

  if (route === 'temp' && request.method === 'DELETE') {
    return json(await view(env, (await callState(env, 'clear-temp', {})) as State));
  }

  if (route === 'temp/extend' && request.method === 'POST') {
    const body = (await request.json()) as { byMs?: number; minutes?: number };
    const byMs = body.byMs ?? Number(body.minutes ?? 15) * 60_000;
    return json(await view(env, (await callState(env, 'extend-temp', { byMs: clampDuration(byMs) })) as State));
  }

  if (route === 'sequence/steps' && request.method === 'POST') {
    const body = (await request.json()) as { steps: { target: Target }[] };
    if (!Array.isArray(body.steps)) return json({ error: 'Malformed steps' }, 400);
    if (body.steps.length > MAX_STEPS) return json({ error: `Too many steps (max ${MAX_STEPS})` }, 400);

    const steps: SequenceStep[] = [];
    for (const [position, step] of body.steps.entries()) {
      const target = normaliseTarget(step.target);
      if ('error' in target) return json({ error: `Step ${position + 1}: ${target.error}` }, 400);
      steps.push({ id: crypto.randomUUID(), target: target.value });
    }
    return json(await view(env, (await callState(env, 'set-steps', { steps })) as State));
  }

  if (route === 'sequence/arm' && request.method === 'POST') {
    const body = (await request.json()) as { durationMs?: number; minutes?: number };
    const expiresAt = now + clampDuration(durationOf(body, DEFAULT_SEQUENCE_MS / 60_000));
    return json(await view(env, (await callState(env, 'arm-sequence', { now, expiresAt, runId: crypto.randomUUID() })) as State));
  }

  if (route === 'sequence/arm' && request.method === 'DELETE') {
    return json(await view(env, (await callState(env, 'disarm-sequence', {})) as State));
  }

  if (route === 'sequence/sticky' && request.method === 'POST') {
    const body = (await request.json()) as { on: boolean };
    return json(await view(env, (await callState(env, 'set-sticky', { on: body.on })) as State));
  }

  if (route === 'traffic' && request.method === 'POST') {
    const body = (await request.json()) as { on: boolean };
    return json(await view(env, (await callState(env, 'set-traffic', { on: body.on })) as State));
  }

  if (route === 'party' && request.method === 'POST') {
    const body = (await request.json()) as { on: boolean };
    return json(await view(env, (await callState(env, 'set-party', { on: body.on })) as State));
  }

  if (route === 'splash' && request.method === 'POST') {
    const body = (await request.json()) as { on: boolean };
    return json(await view(env, (await callState(env, 'set-splash', { on: body.on })) as State));
  }

  if (route === 'bookmarks' && request.method === 'POST') {
    const body = (await request.json()) as { label?: string; target: Target };
    const target = normaliseTarget(body.target);
    if ('error' in target) return json({ error: target.error }, 400);
    // The label is optional. Most bookmarks are a URL you recognise on sight,
    // and forcing a name on one is a second field to fill on a phone for no
    // gain — the panel falls back to describing the target itself.
    return json(await view(env, (await callState(env, 'add-bookmark', {
      id: crypto.randomUUID(),
      label: String(body.label ?? '').trim(),
      target: target.value,
      now,
    })) as State));
  }

  if (route.startsWith('bookmarks/') && request.method === 'DELETE') {
    return json(await view(env, (await callState(env, 'remove-bookmark', { id: decodeURIComponent(route.slice(10)) })) as State));
  }

  if (route === 'upload' && request.method === 'POST') {
    if (!request.body) return json({ error: 'Empty upload' }, 400);
    const type = request.headers.get('content-type') ?? 'application/octet-stream';
    const name = url.searchParams.get('name') ?? defaultName(type, now);
    const file = await storeFile(env, name, type, request.body, now);

    // Uploading straight into a set is the common case for this feature —
    // otherwise adding twelve photos means twelve uploads plus twelve
    // separate "add to set" taps.
    const poolId = url.searchParams.get('pool');
    if (poolId) await callState(env, 'pool-add-item', { poolId, key: file.key });

    // And uploading straight *at* the code is what a Shortcut wants: one
    // request from camera to live, rather than upload, parse, send.
    const slot = url.searchParams.get('slot');
    let known: State | undefined;
    if (slot) {
      const minutes = Number(url.searchParams.get('minutes') ?? 60);
      const target: Target = { kind: 'file', key: file.key, name: file.name };
      const sent = await applySend(env, slot, target, minutes * 60_000, now);
      if ('error' in sent) return json({ error: sent.error }, 400);
      known = sent.state;
    }

    return json({ state: await view(env, known), file });
  }

  if (route === 'gifs' && request.method === 'GET') {
    if (!env.GIPHY_API_KEY) return json({ error: 'GIPHY_API_KEY is not set' }, 400);
    try {
      const q = url.searchParams.get('q')?.trim() ?? '';
      return json({ gifs: await searchGifs(env.GIPHY_API_KEY, q) });
    } catch (err) {
      return json({ error: (err as Error).message }, 502);
    }
  }

  // A picked GIF is copied into the Library rather than linked, so a scan
  // never depends on Giphy's CDN and the result is an ordinary file target
  // that can go anywhere one can — main, temp, a step, an image set.
  if (route === 'gifs/import' && request.method === 'POST') {
    const body = (await request.json()) as { url?: string; name?: string };
    let source: URL;
    try {
      source = new URL(body.url ?? '');
    } catch {
      return json({ error: 'Malformed GIF URL' }, 400);
    }
    // Only Giphy's own hosts. The panel is the sole caller, but an admin
    // route that fetches any URL and republishes it is still an open proxy.
    if (source.protocol !== 'https:' || !/(^|\.)giphy\.com$/.test(source.hostname)) {
      return json({ error: 'Not a Giphy URL' }, 400);
    }
    const upstream = await fetch(source);
    if (!upstream.ok) return json({ error: `Giphy said ${upstream.status}` }, 502);
    const name = `${String(body.name ?? '').trim().slice(0, 60) || 'gif'}.gif`;
    const type = upstream.headers.get('content-type') ?? 'image/gif';
    // Buffered: R2 needs a known length, and downsized gifs are small.
    const file = await storeFile(env, name, type, await upstream.arrayBuffer(), now);
    return json({ state: await view(env), file });
  }

  if (route === 'pools' && request.method === 'POST') {
    const body = (await request.json()) as { name?: string };
    const name = String(body.name ?? '').trim();
    if (!name) return json({ error: 'Name is required' }, 400);
    return json(await view(env, (await callState(env, 'add-pool', { id: crypto.randomUUID(), name, now })) as State));
  }

  if (route.startsWith('pools/') && request.method === 'DELETE') {
    const rest = route.slice('pools/'.length);
    const [poolId, section, key] = rest.split('/').map(decodeURIComponent);

    if (section === 'items' && key) {
      // Removing an image from a set leaves the file itself in the Library.
      return json(await view(env, (await callState(env, 'pool-remove-item', { poolId, key })) as State));
    }
    return json(await view(env, (await callState(env, 'remove-pool', { id: poolId })) as State));
  }

  if (route.startsWith('pools/') && route.endsWith('/items') && request.method === 'POST') {
    const poolId = decodeURIComponent(route.slice('pools/'.length, -'/items'.length));
    const body = (await request.json()) as { key?: string };
    if (!body.key) return json({ error: 'Missing file key' }, 400);
    return json(await view(env, (await callState(env, 'pool-add-item', { poolId, key: body.key })) as State));
  }

  if (route.startsWith('files/') && request.method === 'DELETE') {
    const key = decodeURIComponent(route.slice(6));
    await env.FILES.delete(key);
    return json(await view(env, (await callState(env, 'remove-file', { key })) as State));
  }

  return json({ error: 'Not found' }, 404);
}

/** Default life of an armed sequence, if the panel does not say otherwise. */
const DEFAULT_SEQUENCE_MS = 60 * 60 * 1000;
const MAX_STEPS = 24;

/** Put bytes in R2 under an unguessable key and record them in the Library. */
async function storeFile(
  env: Env,
  name: string,
  type: string,
  body: ReadableStream | ArrayBuffer,
  now: number,
): Promise<StoredFile> {
  // Unguessable key: anyone who has ever scanned the code knows the origin,
  // and sequential keys would let them enumerate everything ever hosted.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const key = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

  const stored = await env.FILES.put(key, body, {
    httpMetadata: {
      contentType: type,
      contentDisposition: `inline; filename="${name.replace(/["\\]/g, '')}"`,
    },
  });

  const file: StoredFile = { key, name, type, size: stored?.size ?? 0, uploadedAt: now };
  await callState(env, 'add-file', { file });
  return file;
}

/**
 * State plus the resolver's current verdict, so the panel shows live truth.
 *
 * The sequence is reported separately from `resolution` because a live
 * sequence has not resolved to anything yet — it resolves per scanner. The
 * panel needs to show both "the next scan gets step 3 of 4" and "when this is
 * done, scans go back to main".
 */
/**
 * The panel's picture of everything. Every mutating op in the object answers
 * with the state it left behind, so a caller that just wrote passes that in
 * and saves a round trip to the object.
 */
async function view(env: Env, known?: State) {
  const now = Date.now();
  const state = known ?? ((await callState(env, 'get')) as State);
  const resolution = resolve(state, now, env.FALLBACK_URL);
  return {
    ...state,
    resolution,
    sequenceStatus: {
      live: sequenceLive(state, now),
      remaining: stepsRemaining(state, now),
      cursor: state.sequence?.cursor ?? 0,
      total: state.sequence?.steps.length ?? 0,
      expiresAt: state.sequence?.expiresAt ?? 0,
    },
    // For a notification or a log line: the live state in one sentence.
    summary: summarise(state, resolution, now),
    // For a picker: what each bookmark is called, in list order.
    bookmarkLabels: state.bookmarks.map((b) => bookmarkLabel(b, state)),
    // The lamps and what the agent last said about them.
    home: { lights: [...LIGHTS, PARTY], ...(await callState(env, 'home-state')) },
    // The other domains, in order, for the panel's card and the sheet's buttons.
    domainHosts: [...DOMAINS],
  };
}

function bookmarkLabel(bookmark: { label: string; target: Target }, state: State): string {
  return bookmark.label || describeTarget(bookmark.target, state);
}

function summarise(state: State, resolution: Resolution, now: number): string {
  const main = state.main ? describeTarget(state.main.target, state) : 'the site';
  if (sequenceLive(state, now)) {
    const seq = state.sequence!;
    return `Sequence armed · ${seq.cursor} of ${seq.steps.length} claimed · ${left(seq.expiresAt - now)} left`;
  }
  if (resolution.source === 'temp') {
    return `Temporary for ${left(resolution.expiresAt - now)}: ${describeTarget(resolution.target, state)} · then ${main}`;
  }
  if (resolution.source === 'main') return `Main: ${main}`;
  return `The site: ${main}`;
}

function left(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

/** The flat send body: a nested target, or one of the shorthand fields. */
interface SendBody {
  slot?: string;
  target?: Target;
  durationMs?: number;
  minutes?: number;
  text?: string;
  url?: string;
  query?: string;
  /** A link if it parses as one, otherwise a message. What a QR scan yields. */
  value?: string;
  /** A saved bookmark, by label or by what it points at. */
  bookmark?: string;
  /** Anything truthy: the traffic light. */
  traffic?: unknown;
}

/** A duration in ms from either form, with the default in minutes. */
function durationOf(body: { durationMs?: number | string; minutes?: number | string }, defaultMinutes: number): number {
  // A shell one-liner or a Shortcut sends numbers as strings as often as not.
  return body.durationMs !== undefined ? Number(body.durationMs) : Number(body.minutes ?? defaultMinutes) * 60_000;
}

/**
 * Point a slot at a target. The one path behind send, upload-and-send, and
 * therefore the Shortcut. Returns an error message, or null when it took.
 */
async function applySend(
  env: Env,
  slot: string,
  target: Target,
  durationMs: number,
  now: number,
): Promise<{ state: State } | { error: string }> {
  if (slot === 'main') {
    return { state: (await callState(env, 'set-main', { target, now })) as State };
  }
  if (slot === 'temp') {
    const expiresAt = now + clampDuration(durationMs);
    return { state: (await callState(env, 'set-temp', { target, now, expiresAt })) as State };
  }
  if (slot === 'sequence') {
    const state = (await callState(env, 'get')) as State;
    const steps: SequenceStep[] = [
      ...(state.sequence?.steps ?? []),
      { id: crypto.randomUUID(), target },
    ];
    if (steps.length > MAX_STEPS) return { error: `Too many steps (max ${MAX_STEPS})` };
    return { state: (await callState(env, 'set-steps', { steps })) as State };
  }
  if (DOMAINS.has(slot)) {
    return { state: (await callState(env, 'set-domain', { host: slot, target, now })) as State };
  }
  return { error: 'Unknown slot' };
}

/** A name for an upload that arrived without one, from its type and the clock. */
function defaultName(type: string, now: number): string {
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/heic': 'heic', 'image/webp': 'webp' }[type] ?? 'bin';
  return `photo-${new Date(now).toISOString().slice(0, 16).replace(/[T:]/g, '-')}.${ext}`;
}

const MAX_MESSAGE_LENGTH = 280;

/** A target from the flat send form. Undefined when no field was given. */
async function flatTarget(env: Env, body: SendBody): Promise<Target | undefined> {
  if (body.text !== undefined) return { kind: 'text', text: String(body.text) };
  if (body.url !== undefined) return { kind: 'url', url: String(body.url) };
  if (body.query !== undefined) return { kind: 'giphy', query: String(body.query) };
  if (body.traffic) return { kind: 'traffic' };
  if (body.value !== undefined) {
    const value = String(body.value);
    // "Hi!" would parse as https://hi!/; a link has to look like one.
    const looksLikeLink = /^[a-z][a-z0-9+.-]*:/i.test(value.trim()) || /^[^\s/]+\.[^\s/]+/.test(value.trim());
    return looksLikeLink && validateUrl(value).ok ? { kind: 'url', url: value } : { kind: 'text', text: value };
  }
  if (body.bookmark !== undefined) {
    const state = (await callState(env, 'get')) as State;
    const wanted = String(body.bookmark).trim().toLowerCase();
    const match = state.bookmarks.find((b) =>
      [b.label, bookmarkLabel(b, state), describeTarget(b.target, state)]
        .some((name) => name.trim().toLowerCase() === wanted));
    // A missing bookmark falls through to "Missing target" below, which is
    // the honest answer: nothing was sent.
    return match?.target;
  }
  return undefined;
}

function normaliseTarget(target: Target | undefined): { value: Target } | { error: string } {
  if (!target || typeof target !== 'object') return { error: 'Missing target' };

  if (target.kind === 'file') {
    if (!target.key || !target.name) return { error: 'Malformed file target' };
    return { value: { kind: 'file', key: target.key, name: target.name, label: target.label } };
  }

  if (target.kind === 'pool') {
    if (!target.poolId) return { error: 'Malformed image set target' };
    return { value: { kind: 'pool', poolId: target.poolId, label: target.label } };
  }

  if (target.kind === 'traffic') return { value: { kind: 'traffic', label: target.label } };

  if (target.kind === 'giphy') {
    const query = String(target.query ?? '').trim();
    if (query.length > 100) return { error: 'Search is longer than 100 characters' };
    return { value: { kind: 'giphy', query, label: target.label } };
  }

  if (target.kind === 'text') {
    const text = String(target.text ?? '').trim();
    if (!text) return { error: 'Message is empty' };
    if (text.length > MAX_MESSAGE_LENGTH) {
      return { error: `Message is longer than ${MAX_MESSAGE_LENGTH} characters` };
    }
    return { value: { kind: 'text', text, label: target.label } };
  }

  const result = validateUrl(String(target.url ?? ''));
  if (!result.ok) return { error: result.error! };
  return { value: { kind: 'url', url: result.url!, label: target.label } };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
