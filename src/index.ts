import {
  checkPassword,
  clearedCookie,
  hasCsrfHeader,
  isAuthed,
  issueSession,
  sessionCookie,
} from './auth';
import { adminPage, loginPage, MANIFEST } from './admin/page';
import { qrSvg } from './qr';
import { resolve, targetToUrl } from './resolve';
import { DEFAULT_TEMPLATE_ID, renderSplash } from './splash';
import type { Env, State, StoredFile, Target } from './types';
import { clampDuration, validateUrl } from './validate';

export { RedirectState } from './state';

/**
 * Link unfurlers. They hit the URL when you paste it into a chat, and with
 * splash on they would scrape the splash page and unfurl nonsense — so they get
 * a plain redirect and can unfurl the real destination instead.
 */
const UNFURLER = /bot|crawler|spider|slack|discord|facebookexternalhit|twitterbot|whatsapp|telegram|linkedinbot|preview|skypeuripreview|embedly|quora link preview|redditbot|applebot|pinterest|vkshare|nuzzel|bitlybot|google-inspectiontool/i;

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
  const state = (await callState(env, 'get')) as State;
  const resolution = resolve(state, Date.now(), env.FALLBACK_URL);
  const destination = targetToUrl(resolution.target, url.origin);

  // Counted after the response is on its way — telemetry never delays a scan.
  ctx.waitUntil(callState(env, 'hit', {}));

  const agent = request.headers.get('user-agent') ?? '';
  const wantsSplash = state.splash && !UNFURLER.test(agent);

  if (wantsSplash) {
    return new Response(
      renderSplash(DEFAULT_TEMPLATE_ID, {
        targetUrl: destination,
        label: resolution.target.kind === 'file' ? resolution.target.name : resolution.target.label,
      }),
      {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'referrer-policy': 'no-referrer',
        },
      },
    );
  }

  // 302, never 301: a cached permanent redirect poisons the QR on every device
  // that ever scanned it, and there is no way to un-ring that bell.
  return new Response(null, {
    status: 302,
    headers: {
      location: destination,
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    },
  });
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
    if (request.method === 'GET') return html(loginPage());
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

    const guard = await callState(env, 'login-guard', { action: 'check', now });
    if (guard.locked) {
      return html(loginPage('Too many attempts. Try again later.'), 429);
    }

    const form = await request.formData();
    const supplied = String(form.get('password') ?? '');
    if (!(await checkPassword(supplied, env))) {
      await callState(env, 'login-guard', { action: 'fail', now });
      return html(loginPage('Incorrect password.'), 401);
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
    return json({ state: await view(env), file });
  }

  if (route.startsWith('files/') && request.method === 'DELETE') {
    const key = decodeURIComponent(route.slice(6));
    await env.FILES.delete(key);
    await callState(env, 'remove-file', { key });
    return json(await view(env));
  }

  return json({ error: 'Not found' }, 404);
}

/** State plus the resolver's current verdict, so the panel shows live truth. */
async function view(env: Env) {
  const state = (await callState(env, 'get')) as State;
  return { ...state, resolution: resolve(state, Date.now(), env.FALLBACK_URL) };
}

function normaliseTarget(target: Target): { value: Target } | { error: string } {
  if (!target || typeof target !== 'object') return { error: 'Missing target' };
  if (target.kind === 'file') {
    if (!target.key || !target.name) return { error: 'Malformed file target' };
    return { value: { kind: 'file', key: target.key, name: target.name, label: target.label } };
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
