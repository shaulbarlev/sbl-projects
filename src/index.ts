import {
  checkPassword,
  clearedCookie,
  hasCsrfHeader,
  isAuthed,
  issueSession,
  sessionCookie,
} from './auth';
import { adminPage, loginPage, MANIFEST } from './admin/page';
import { renderMessage } from './message';
import { qrSvg } from './qr';
import {
  describeTarget,
  resolve,
  sequenceLive,
  sequenceRunOpen,
  stepsRemaining,
  stepTarget,
  targetToUrl,
} from './resolve';
import { DEFAULT_TEMPLATE_ID, renderSplash } from './splash';
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

    try {
      if (path === '/_' || path.startsWith('/_/')) return await handleAdmin(request, env, url);
      if (path.startsWith('/f/')) return await serveFile(request, env, path);
      return await handleRedirect(request, env, ctx, url);
    } catch (err) {
      console.error('unhandled', err);
      // A QR that resolves to a stack trace is worse than one that resolves
      // somewhere boring.
      return Response.redirect(env.FALLBACK_URL, 302);
    }
  },
};

function stub(env: Env, slug = '') {
  return env.STATE.get(env.STATE.idFromName(slug || 'default'));
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

  // An image set resolves to a different file on every scan. The draw happens
  // in the Durable Object so that concurrent scanners advance the same bag
  // instead of racing, and it counts the hit in the same round trip so a set
  // scan costs no more latency than any other.
  let served: Target = resolution.target;
  if (served.kind === 'pool') {
    const drawn = (await callState(env, 'pool-draw', { poolId: served.poolId })) as {
      key: string | null;
    };
    const file = drawn.key ? state.files.find((f) => f.key === drawn.key) : null;
    if (file) {
      served = { kind: 'file', key: file.key, name: file.name };
    } else {
      // The set emptied out from under us between read and draw.
      served = { kind: 'url', url: env.FALLBACK_URL };
    }
  } else {
    // Counted after the response is on its way — telemetry never delays a scan.
    ctx.waitUntil(callState(env, 'hit', {}));
  }

  const headers = new Headers({
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
  });
  if (claimCookie) headers.append('set-cookie', claimCookie);

  // A text target is the destination, so there is nothing to redirect to and
  // nothing for a splash to precede.
  if (served.kind === 'text') {
    headers.set('content-type', 'text/html; charset=utf-8');
    return new Response(renderMessage(served.text), { headers });
  }

  const destination = targetToUrl(served, url.origin);

  if (state.splash && !isRobot) {
    headers.set('content-type', 'text/html; charset=utf-8');
    return new Response(
      renderSplash(DEFAULT_TEMPLATE_ID, {
        targetUrl: destination,
        label: describeTarget(served, state),
      }),
      { headers },
    );
  }

  // 302, never 301: a cached permanent redirect poisons the QR on every device
  // that ever scanned it, and there is no way to un-ring that bell.
  headers.set('location', destination);
  return new Response(null, { status: 302, headers });
}

/**
 * Work out which sequence step this visitor gets.
 *
 * A step is claimed once per device and then sticks: reloading, locking the
 * phone, or coming back later shows the same message, because the whole point
 * is to hold the screen up while four phones get arranged. Only a genuinely new
 * visitor consumes the next step.
 */
async function claimStep(
  request: Request,
  env: Env,
  state: State,
  now: number,
): Promise<{ index: number; target: Target; cookie: string | null } | null> {
  const sequence = state.sequence!;

  const existing = readRequestCookie(request, STEP_COOKIE);
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

  const claimed = (await callState(env, 'burn-step', { now })) as {
    index: number | null;
    runId?: string;
  };
  if (claimed.index === null) return null;

  const target = stepTarget(state, claimed.index);
  if (!target) return null;

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

function readRequestCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

async function serveFile(request: Request, env: Env, path: string): Promise<Response> {
  const key = path.split('/')[2];
  if (!key) return new Response('Not found', { status: 404 });

  const object = await env.FILES.get(key);
  if (!object) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
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

  if (!(await isAuthed(request, env, now))) {
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

  if (route === 'main' && request.method === 'POST') {
    const body = (await request.json()) as { target: Target };
    const target = normaliseTarget(body.target);
    if ('error' in target) return json({ error: target.error }, 400);
    await callState(env, 'set-main', { target: target.value, now });
    return json(await view(env));
  }

  if (route === 'temp' && request.method === 'POST') {
    const body = (await request.json()) as { target: Target; durationMs: number };
    const target = normaliseTarget(body.target);
    if ('error' in target) return json({ error: target.error }, 400);
    const expiresAt = now + clampDuration(body.durationMs);
    await callState(env, 'set-temp', { target: target.value, now, expiresAt });
    return json(await view(env));
  }

  if (route === 'temp' && request.method === 'DELETE') {
    await callState(env, 'clear-temp', {});
    return json(await view(env));
  }

  if (route === 'temp/extend' && request.method === 'POST') {
    const body = (await request.json()) as { byMs: number };
    await callState(env, 'extend-temp', { byMs: clampDuration(body.byMs) });
    return json(await view(env));
  }

  if (route === 'sequence/steps' && request.method === 'POST') {
    const body = (await request.json()) as { steps: { target: Target }[] };
    if (!Array.isArray(body.steps)) return json({ error: 'Malformed steps' }, 400);
    if (body.steps.length > 24) return json({ error: 'Too many steps (max 24)' }, 400);

    const steps: SequenceStep[] = [];
    for (const [position, step] of body.steps.entries()) {
      const target = normaliseTarget(step.target);
      if ('error' in target) return json({ error: `Step ${position + 1}: ${target.error}` }, 400);
      steps.push({ id: crypto.randomUUID(), target: target.value });
    }
    await callState(env, 'set-steps', { steps });
    return json(await view(env));
  }

  if (route === 'sequence/arm' && request.method === 'POST') {
    const body = (await request.json()) as { durationMs?: number };
    const expiresAt = now + clampDuration(body.durationMs ?? DEFAULT_SEQUENCE_MS);
    await callState(env, 'arm-sequence', { now, expiresAt, runId: crypto.randomUUID() });
    return json(await view(env));
  }

  if (route === 'sequence/arm' && request.method === 'DELETE') {
    await callState(env, 'disarm-sequence', {});
    return json(await view(env));
  }

  if (route === 'splash' && request.method === 'POST') {
    const body = (await request.json()) as { on: boolean };
    await callState(env, 'set-splash', { on: body.on });
    return json(await view(env));
  }

  if (route === 'bookmarks' && request.method === 'POST') {
    const body = (await request.json()) as { label: string; target: Target };
    const target = normaliseTarget(body.target);
    if ('error' in target) return json({ error: target.error }, 400);
    if (!body.label?.trim()) return json({ error: 'Label is required' }, 400);
    await callState(env, 'add-bookmark', {
      id: crypto.randomUUID(),
      label: body.label.trim(),
      target: target.value,
      now,
    });
    return json(await view(env));
  }

  if (route.startsWith('bookmarks/') && request.method === 'DELETE') {
    await callState(env, 'remove-bookmark', { id: decodeURIComponent(route.slice(10)) });
    return json(await view(env));
  }

  if (route === 'upload' && request.method === 'POST') {
    const name = url.searchParams.get('name') ?? 'upload';
    if (!request.body) return json({ error: 'Empty upload' }, 400);

    // Unguessable key: anyone who has ever scanned the code knows the origin,
    // and sequential keys would let them enumerate everything ever hosted.
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const key = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    const type = request.headers.get('content-type') ?? 'application/octet-stream';

    const stored = await env.FILES.put(key, request.body, {
      httpMetadata: {
        contentType: type,
        contentDisposition: `inline; filename="${name.replace(/["\\]/g, '')}"`,
      },
    });

    const file: StoredFile = {
      key,
      name,
      type,
      size: stored?.size ?? 0,
      uploadedAt: now,
    };
    await callState(env, 'add-file', { file });

    // Uploading straight into a set is the common case for this feature —
    // otherwise adding twelve photos means twelve uploads plus twelve
    // separate "add to set" taps.
    const poolId = url.searchParams.get('pool');
    if (poolId) await callState(env, 'pool-add-item', { poolId, key });

    return json({ state: await view(env), file });
  }

  if (route === 'pools' && request.method === 'POST') {
    const body = (await request.json()) as { name?: string };
    const name = String(body.name ?? '').trim();
    if (!name) return json({ error: 'Name is required' }, 400);
    await callState(env, 'add-pool', { id: crypto.randomUUID(), name, now });
    return json(await view(env));
  }

  if (route.startsWith('pools/') && request.method === 'DELETE') {
    const rest = route.slice('pools/'.length);
    const [poolId, section, key] = rest.split('/').map(decodeURIComponent);

    if (section === 'items' && key) {
      // Removing an image from a set leaves the file itself in the Library.
      await callState(env, 'pool-remove-item', { poolId, key });
      return json(await view(env));
    }
    await callState(env, 'remove-pool', { id: poolId });
    return json(await view(env));
  }

  if (route.startsWith('pools/') && route.endsWith('/items') && request.method === 'POST') {
    const poolId = decodeURIComponent(route.slice('pools/'.length, -'/items'.length));
    const body = (await request.json()) as { key?: string };
    if (!body.key) return json({ error: 'Missing file key' }, 400);
    await callState(env, 'pool-add-item', { poolId, key: body.key });
    return json(await view(env));
  }

  if (route.startsWith('files/') && request.method === 'DELETE') {
    const key = decodeURIComponent(route.slice(6));
    await env.FILES.delete(key);
    await callState(env, 'remove-file', { key });
    return json(await view(env));
  }

  return json({ error: 'Not found' }, 404);
}

/** Default life of an armed sequence, if the panel does not say otherwise. */
const DEFAULT_SEQUENCE_MS = 60 * 60 * 1000;

/**
 * State plus the resolver's current verdict, so the panel shows live truth.
 *
 * The sequence is reported separately from `resolution` because a live
 * sequence has not resolved to anything yet — it resolves per scanner. The
 * panel needs to show both "the next scan gets step 3 of 4" and "when this is
 * done, scans go back to main".
 */
async function view(env: Env) {
  const now = Date.now();
  const state = (await callState(env, 'get')) as State;
  return {
    ...state,
    resolution: resolve(state, now, env.FALLBACK_URL),
    sequenceStatus: {
      live: sequenceLive(state, now),
      remaining: stepsRemaining(state, now),
      cursor: state.sequence?.cursor ?? 0,
      total: state.sequence?.steps.length ?? 0,
      expiresAt: state.sequence?.expiresAt ?? 0,
    },
  };
}

const MAX_MESSAGE_LENGTH = 280;

function normaliseTarget(target: Target): { value: Target } | { error: string } {
  if (!target || typeof target !== 'object') return { error: 'Missing target' };

  if (target.kind === 'file') {
    if (!target.key || !target.name) return { error: 'Malformed file target' };
    return { value: { kind: 'file', key: target.key, name: target.name, label: target.label } };
  }

  if (target.kind === 'pool') {
    if (!target.poolId) return { error: 'Malformed image set target' };
    return { value: { kind: 'pool', poolId: target.poolId, label: target.label } };
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
