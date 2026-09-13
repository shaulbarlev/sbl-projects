import { SELF } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGIN = 'https://q.test';
const PASSWORD = 'test-password';

async function login(): Promise<string> {
  const response = await SELF.fetch(`${ORIGIN}/_/login`, {
    method: 'POST',
    body: new URLSearchParams({ password: PASSWORD }),
    redirect: 'manual',
  });
  return response.headers.get('set-cookie')!.split(';')[0];
}

function authed(cookie: string, body?: unknown, method?: string): RequestInit {
  return {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: {
      cookie,
      'x-skin-request': '1',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  };
}

function scan(extraHeaders: Record<string, string> = {}): Promise<Response> {
  return SELF.fetch(ORIGIN, {
    redirect: 'manual',
    headers: {
      'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/605.1',
      ...extraHeaders,
    },
  });
}

async function feed(query: string) {
  await SELF.fetch(`${ORIGIN}/_/api/send`,
    authed(cookie, { slot: 'main', target: { kind: 'giphy', query } }));
}

const gifUrl = (id: string) => `https://media.giphy.com/${id}/giphy.gif`;

/** The shape of a Giphy search response, reduced to the fields we read. */
function page(ids: string[]) {
  return {
    data: ids.map((id) => ({
      id,
      title: id,
      images: {
        fixed_width_small: { url: `https://media.giphy.com/${id}/200_s.gif` },
        downsized: { url: gifUrl(id) },
        original: { url: `https://media.giphy.com/${id}/orig.gif` },
      },
    })),
  };
}

let cookie: string;

beforeAll(() => {
  // The test and the Worker share one isolate here, so stubbing the global
  // fetch is what stands in for Giphy. Bindings (SELF, the DO stub) do not go
  // through it, so only the outbound call is faked.
  const real = globalThis.fetch;
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== 'api.giphy.com') return real(input, init);
    const q = url.searchParams.get('q');
    if (q === 'broken') return Promise.resolve(new Response('nope', { status: 500 }));
    // Any "cats…" query has exactly two results — one query per test, since
    // feed progress lives in the DO and is not reset between tests: page one is a and b, page two is empty.
    const ids = q?.startsWith('cats') && url.searchParams.get('offset') === '0' ? ['a', 'b'] : [];
    return Promise.resolve(Response.json(page(ids)));
  });
});

beforeEach(async () => {
  cookie = await login();
  await SELF.fetch(`${ORIGIN}/_/api/sequence/arm`, authed(cookie, undefined, 'DELETE'));
  await SELF.fetch(`${ORIGIN}/_/api/temp`, authed(cookie, undefined, 'DELETE'));
  await SELF.fetch(`${ORIGIN}/_/api/splash`, authed(cookie, { on: false }));
});

describe('a gif feed', () => {
  it('hands out the results in order, then wraps around', async () => {
    await feed('cats-order');
    expect((await scan()).headers.get('location')).toBe(gifUrl('a'));
    expect((await scan()).headers.get('location')).toBe(gifUrl('b'));
    // Page two is empty, so the feed starts over rather than dead-ending.
    expect((await scan()).headers.get('location')).toBe(gifUrl('a'));
  });

  it('lets a prefetch or an unfurler peek without taking the next gif', async () => {
    await feed('cats-peek');
    const prefetch = await scan({ 'sec-purpose': 'prefetch' });
    expect(prefetch.headers.get('location')).toBe(gifUrl('a'));
    const unfurler = await scan({ 'user-agent': 'Slackbot-LinkExpanding 1.0' });
    expect(unfurler.headers.get('location')).toBe(gifUrl('a'));
    // The person who then actually scans gets the one they were shown.
    expect((await scan()).headers.get('location')).toBe(gifUrl('a'));
    expect((await scan()).headers.get('location')).toBe(gifUrl('b'));
  });

  it('falls back rather than erroring when Giphy is down', async () => {
    await feed('broken');
    const response = await scan();
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://fallback.example.com/');
  });

  it('works as a sequence step, and shows up in the panel view by name', async () => {
    await SELF.fetch(`${ORIGIN}/_/api/sequence/steps`, authed(cookie, {
      steps: [{ target: { kind: 'giphy', query: 'cats-step' } }],
    }));
    await SELF.fetch(`${ORIGIN}/_/api/sequence/arm`, authed(cookie, { durationMs: 3600_000 }));
    expect((await scan()).headers.get('location')).toBe(gifUrl('a'));
  });

  it('rejects an absurdly long search', async () => {
    const response = await SELF.fetch(`${ORIGIN}/_/api/send`,
      authed(cookie, { slot: 'main', target: { kind: 'giphy', query: 'x'.repeat(101) } }));
    expect(response.status).toBe(400);
  });
});
