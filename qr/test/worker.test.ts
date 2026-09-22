import { SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { decodeQrSvg } from './qr-decode';

const ORIGIN = 'https://q.test';
const PASSWORD = 'test-password';

async function login(): Promise<string> {
  const body = new URLSearchParams({ password: PASSWORD });
  const response = await SELF.fetch(`${ORIGIN}/_/login`, {
    method: 'POST',
    body,
    redirect: 'manual',
  });
  expect(response.status).toBe(303);
  const cookie = response.headers.get('set-cookie');
  expect(cookie).toBeTruthy();
  return cookie!.split(';')[0];
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

let cookie: string;

beforeEach(async () => {
  cookie = await login();
  // Each test starts from a known slate.
  await SELF.fetch(`${ORIGIN}/_/api/temp`, authed(cookie, undefined, 'DELETE'));
  await SELF.fetch(`${ORIGIN}/_/api/splash`, authed(cookie, { on: false }));
});

describe('a served file', () => {
  it('answers a range request with that piece, as a video player needs', async () => {
    const upload = await SELF.fetch(`${ORIGIN}/_/api/upload?name=clip.bin`, {
      method: 'POST',
      headers: { cookie, 'x-skin-request': '1', 'content-type': 'application/octet-stream' },
      body: new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
    });
    const { file } = (await upload.json()) as any;
    const whole = await SELF.fetch(`${ORIGIN}/f/${file.key}/clip.bin`);
    expect(whole.status).toBe(200);
    expect(whole.headers.get('accept-ranges')).toBe('bytes');
    const piece = await SELF.fetch(`${ORIGIN}/f/${file.key}/clip.bin`, { headers: { range: 'bytes=2-4' } });
    expect(piece.status).toBe(206);
    expect(piece.headers.get('content-range')).toBe('bytes 2-4/10');
    expect([...new Uint8Array(await piece.arrayBuffer())]).toEqual([2, 3, 4]);
    const tail = await SELF.fetch(`${ORIGIN}/f/${file.key}/clip.bin`, { headers: { range: 'bytes=7-' } });
    expect(tail.headers.get('content-range')).toBe('bytes 7-9/10');
  });
});

describe('public redirect', () => {
  it('serves the site before anything is configured', async () => {
    await SELF.fetch(`${ORIGIN}/_/api/temp`, authed(cookie, undefined, 'DELETE'));
    const response = await SELF.fetch(ORIGIN, { redirect: 'manual' });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('the site /');
  });

  it('serves the site for every path that is not its own', async () => {
    expect(await (await SELF.fetch(`${ORIGIN}/doorlock/`)).text()).toBe('the site /doorlock/');
    expect(await (await SELF.fetch(`${ORIGIN}/assets/main.js`)).text()).toBe('the site /assets/main.js');
  });

  it('still serves a file, and an image from a set, though they live on this host too', async () => {
    const upload = await SELF.fetch(`${ORIGIN}/_/api/upload?name=pic.png&slot=main`, {
      method: 'POST',
      headers: { cookie, 'x-skin-request': '1', 'content-type': 'image/png' },
      body: new Uint8Array([1, 2, 3]),
    });
    const { file } = (await upload.json()) as any;
    // At the real address: a file's URL is on the site's own host, which must not make it "the site".
    const scan = await SELF.fetch('https://sbl.cx/', { redirect: 'manual' });
    expect(scan.status).toBe(302);
    expect(scan.headers.get('location')).toBe(`https://sbl.cx/f/${file.key}/pic.png`);
  });

  it('serves the site when the destination is the site itself, rather than hop there', async () => {
    for (const site of ['https://sbl.cx/', 'https://shaulb.com/', 'https://fallback.example.com/']) {
      await SELF.fetch(`${ORIGIN}/_/api/send`, authed(cookie, { slot: 'main', target: { kind: 'url', url: site } }));
      const response = await SELF.fetch(ORIGIN, { redirect: 'manual' });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('the site /');
    }
  });

  // A 301 would be cached near-permanently by the browser of every device that
  // ever scanned the code, and could not be taken back.
  it('never issues a permanent redirect', async () => {
    await SELF.fetch(`${ORIGIN}/_/api/send`,
      authed(cookie, { slot: 'main', target: { kind: 'url', url: 'https://main.example.com/' } }));
    const response = await SELF.fetch(ORIGIN, { redirect: 'manual' });
    expect(response.status).toBe(302);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('prefers a live temp, and reverts to main when it is ended', async () => {
    await SELF.fetch(`${ORIGIN}/_/api/send`,
      authed(cookie, { slot: 'main', target: { kind: 'url', url: 'https://main.example.com/' } }));
    await SELF.fetch(`${ORIGIN}/_/api/send`,
      authed(cookie, { slot: 'temp', target: { kind: 'url', url: 'https://temp.example.com/' }, durationMs: 3600_000 }));

    let response = await SELF.fetch(ORIGIN, { redirect: 'manual' });
    expect(response.headers.get('location')).toBe('https://temp.example.com/');

    await SELF.fetch(`${ORIGIN}/_/api/temp`, authed(cookie, undefined, 'DELETE'));
    response = await SELF.fetch(ORIGIN, { redirect: 'manual' });
    expect(response.headers.get('location')).toBe('https://main.example.com/');
  });

  it('keeps a live temp alive when main is changed underneath it', async () => {
    await SELF.fetch(`${ORIGIN}/_/api/send`,
      authed(cookie, { slot: 'temp', target: { kind: 'url', url: 'https://temp.example.com/' }, durationMs: 3600_000 }));
    await SELF.fetch(`${ORIGIN}/_/api/send`,
      authed(cookie, { slot: 'main', target: { kind: 'url', url: 'https://new-main.example.com/' } }));

    const response = await SELF.fetch(ORIGIN, { redirect: 'manual' });
    expect(response.headers.get('location')).toBe('https://temp.example.com/');
  });

  it('leaves unknown paths to the site, whatever the QR points at', async () => {
    await SELF.fetch(`${ORIGIN}/_/api/send`,
      authed(cookie, { slot: 'main', target: { kind: 'url', url: 'https://main.example.com/' } }));
    const response = await SELF.fetch(`${ORIGIN}/some/mistyped/path`, { redirect: 'manual' });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('the site /some/mistyped/path');
  });

  it('counts scans', async () => {
    const before = await (await SELF.fetch(`${ORIGIN}/_/api/state`, authed(cookie))).json() as any;
    await SELF.fetch(ORIGIN, { redirect: 'manual' });
    const after = await (await SELF.fetch(`${ORIGIN}/_/api/state`, authed(cookie))).json() as any;
    expect(after.hits).toBeGreaterThan(before.hits);
  });
});

describe('splash', () => {
  beforeEach(async () => {
    await SELF.fetch(`${ORIGIN}/_/api/send`,
      authed(cookie, { slot: 'main', target: { kind: 'url', url: 'https://main.example.com/' } }));
    await SELF.fetch(`${ORIGIN}/_/api/splash`, authed(cookie, { on: true }));
  });

  it('serves the inlined splash instead of redirecting', async () => {
    const response = await SELF.fetch(ORIGIN, { redirect: 'manual' });
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('thank you for scanning');
    expect(body).toContain('location.replace');
    expect(body).toContain('rel="prefetch"');
    expect(body).toContain('http-equiv="refresh"');
  });

  // Otherwise pasting the link into a chat unfurls the splash page instead of
  // the actual destination.
  it('bypasses the splash for link unfurlers', async () => {
    const response = await SELF.fetch(ORIGIN, {
      redirect: 'manual',
      headers: { 'user-agent': 'Slackbot-LinkExpanding 1.0' },
    });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://main.example.com/');
  });

  it('escapes a hostile target rather than emitting it raw', async () => {
    await SELF.fetch(`${ORIGIN}/_/api/send`,
      authed(cookie, { slot: 'main', target: { kind: 'url', url: 'https://evil.example.com/"></script><script>x' } }));
    const body = await (await SELF.fetch(ORIGIN, { redirect: 'manual' })).text();
    expect(body).not.toContain('</script><script>x');
  });
});

describe('auth', () => {
  it('redirects an anonymous visitor away from the panel', async () => {
    const response = await SELF.fetch(`${ORIGIN}/_/`, { redirect: 'manual' });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain('/_/login');
  });

  it('401s anonymous api calls', async () => {
    const response = await SELF.fetch(`${ORIGIN}/_/api/state`, { redirect: 'manual' });
    expect(response.status).toBe(401);
  });

  // The Shortcut path: no cookie, no CSRF header, just the token.
  it('accepts the api token in place of a session, and sets a message with the flat form', async () => {
    const response = await SELF.fetch(`${ORIGIN}/_/api/send`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'hello from a shortcut' }),
    });
    expect(response.status).toBe(200);
    const state = (await response.json()) as any;
    expect(state.resolution.source).toBe('temp');
    expect(state.resolution.target.text).toBe('hello from a shortcut');
    // No duration given: an hour, not the one-minute floor.
    expect(state.temp.expiresAt - state.temp.setAt).toBe(60 * 60_000);

    const scan = await SELF.fetch(ORIGIN, { redirect: 'manual' });
    expect(await scan.text()).toContain('hello from a shortcut');
  });

  it('turns a scanned value into a link or a message, whichever it is', async () => {
    const asToken = (body: unknown) => SELF.fetch(`${ORIGIN}/_/api/send`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    let state = (await (await asToken({ value: 'shaulb.com/menu' })).json()) as any;
    expect(state.resolution.target).toMatchObject({ kind: 'url', url: 'https://shaulb.com/menu' });
    state = (await (await asToken({ value: 'back in 10' })).json()) as any;
    expect(state.resolution.target).toMatchObject({ kind: 'text', text: 'back in 10' });
    expect(state.summary).toMatch(/^Temporary for 1h 0m: back in 10 · then /);
  });

  it('sends a bookmark by name, and refuses one it does not know', async () => {
    await SELF.fetch(`${ORIGIN}/_/api/bookmarks`, authed(cookie, {
      label: 'Menu', target: { kind: 'url', url: 'https://example.com/menu' },
    }));
    const hit = await SELF.fetch(`${ORIGIN}/_/api/send`, authed(cookie, { bookmark: 'menu', minutes: 5 }));
    const state = (await hit.json()) as any;
    expect(state.resolution.target.url).toBe('https://example.com/menu');
    expect(state.bookmarkLabels).toContain('Menu');
    const miss = await SELF.fetch(`${ORIGIN}/_/api/send`, authed(cookie, { bookmark: 'nope' }));
    expect(miss.status).toBe(400);
    // Storage is shared across this file; leave the bookmark list as found.
    const id = state.bookmarks.find((b: any) => b.label === 'Menu').id;
    await SELF.fetch(`${ORIGIN}/_/api/bookmarks/${id}`, authed(cookie, undefined, 'DELETE'));
  });

  it('uploads and points the code at the file in one request', async () => {
    const response = await SELF.fetch(`${ORIGIN}/_/api/upload?slot=temp&minutes=5`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-token', 'content-type': 'image/jpeg' },
      body: 'not really a jpeg',
    });
    const { state, file } = (await response.json()) as any;
    expect(file.name).toMatch(/^photo-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.jpg$/);
    expect(state.resolution).toMatchObject({ source: 'temp', target: { kind: 'file', key: file.key } });
    expect(state.temp.expiresAt - state.temp.setAt).toBe(5 * 60_000);
  });

  it('extends by minutes', async () => {
    await SELF.fetch(`${ORIGIN}/_/api/send`, authed(cookie, { text: 'x', minutes: 10 }));
    const response = await SELF.fetch(`${ORIGIN}/_/api/temp/extend`, authed(cookie, { minutes: 30 }));
    const state = (await response.json()) as any;
    expect(state.temp.expiresAt - state.temp.setAt).toBe(40 * 60_000);
  });

  it('rejects a wrong token', async () => {
    const response = await SELF.fetch(`${ORIGIN}/_/api/state`, {
      headers: { authorization: 'Bearer nope' },
    });
    expect(response.status).toBe(401);
  });

  it('rejects a wrong password', async () => {
    const response = await SELF.fetch(`${ORIGIN}/_/login`, {
      method: 'POST',
      body: new URLSearchParams({ password: 'not-it' }),
      redirect: 'manual',
    });
    expect(response.status).toBe(401);
  });

  it('rejects a forged session cookie', async () => {
    const forged = `skin_session=${Date.now() + 100000}.deadbeef`;
    const response = await SELF.fetch(`${ORIGIN}/_/api/state`, {
      headers: { cookie: forged },
      redirect: 'manual',
    });
    expect(response.status).toBe(401);
  });

  // Without this, a page in your browser could silently repoint the QR code.
  it('rejects writes that lack the CSRF header', async () => {
    const response = await SELF.fetch(`${ORIGIN}/_/api/send`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ slot: 'main', target: { kind: 'url', url: 'https://attacker.example.com/' } }),
      redirect: 'manual',
    });
    expect(response.status).toBe(403);
  });
});

describe('validation at the api boundary', () => {
  it('refuses an unknown send slot', async () => {
    const response = await SELF.fetch(`${ORIGIN}/_/api/send`,
      authed(cookie, { slot: 'forever', target: { kind: 'url', url: 'https://example.com/' } }));
    expect(response.status).toBe(400);
  });

  it('appends to the sequence through send', async () => {
    await SELF.fetch(`${ORIGIN}/_/api/sequence/steps`, authed(cookie, { steps: [] }));
    await SELF.fetch(`${ORIGIN}/_/api/send`,
      authed(cookie, { slot: 'sequence', target: { kind: 'text', text: 'one' } }));
    const response = await SELF.fetch(`${ORIGIN}/_/api/send`,
      authed(cookie, { slot: 'sequence', target: { kind: 'text', text: 'two' } }));
    const state = await response.json() as any;
    expect(state.sequence.steps.map((s: any) => s.target.text)).toEqual(['one', 'two']);
    // Adding steps to an idle sequence must not arm it.
    expect(state.sequenceStatus.live).toBe(false);
  });

  // The import route fetches a URL and republishes it on this origin, so it
  // must only ever fetch Giphy — never an arbitrary host the admin was tricked
  // into pasting.
  it('refuses to import a gif from anywhere but giphy', async () => {
    for (const url of ['https://evil.example.com/x.gif', 'http://media.giphy.com/x.gif', 'nonsense']) {
      const response = await SELF.fetch(`${ORIGIN}/_/api/gifs/import`, authed(cookie, { url }));
      expect(response.status).toBe(400);
    }
  });

  it('refuses a javascript: target', async () => {
    const response = await SELF.fetch(`${ORIGIN}/_/api/send`,
      authed(cookie, { slot: 'main', target: { kind: 'url', url: 'javascript:alert(1)' } }));
    expect(response.status).toBe(400);
  });

  it('clamps an absurd temp duration to the ceiling', async () => {
    await SELF.fetch(`${ORIGIN}/_/api/send`,
      authed(cookie, { slot: 'temp', target: { kind: 'url', url: 'https://temp.example.com/' }, durationMs: 1e15 }));
    const state = await (await SELF.fetch(`${ORIGIN}/_/api/state`, authed(cookie))).json() as any;
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    expect(state.temp.expiresAt - Date.now()).toBeLessThanOrEqual(sevenDays + 1000);
  });
});

describe('files', () => {
  it('round-trips an upload and sandboxes it on the way out', async () => {
    const upload = await SELF.fetch(`${ORIGIN}/_/api/upload?name=note.html`, {
      method: 'POST',
      headers: { cookie, 'x-skin-request': '1', 'content-type': 'text/html' },
      body: '<h1>hello</h1>',
      redirect: 'manual',
    });
    expect(upload.status).toBe(200);
    const { file } = await upload.json() as any;

    const served = await SELF.fetch(`${ORIGIN}/f/${file.key}/note.html`, { redirect: 'manual' });
    expect(served.status).toBe(200);
    expect(await served.text()).toBe('<h1>hello</h1>');
    // Uploads share an origin with the admin panel; without this an uploaded
    // page could script against it and lift the session cookie.
    expect(served.headers.get('content-security-policy')).toBe('sandbox');
    expect(served.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('serves a file target through the resolver', async () => {
    const upload = await SELF.fetch(`${ORIGIN}/_/api/upload?name=menu.txt`, {
      method: 'POST',
      headers: { cookie, 'x-skin-request': '1', 'content-type': 'text/plain' },
      body: 'soup',
      redirect: 'manual',
    });
    const { file } = await upload.json() as any;

    await SELF.fetch(`${ORIGIN}/_/api/send`,
      authed(cookie, { slot: 'temp', target: { kind: 'file', key: file.key, name: file.name }, durationMs: 600_000 }));

    const response = await SELF.fetch(ORIGIN, { redirect: 'manual' });
    expect(response.headers.get('location')).toBe(`${ORIGIN}/f/${file.key}/menu.txt`);
  });

  it('404s an unknown file key', async () => {
    const response = await SELF.fetch(`${ORIGIN}/f/nope/x.txt`, { redirect: 'manual' });
    expect(response.status).toBe(404);
  });
});

describe('bookmarks and qr', () => {
  it('adds and removes a bookmark', async () => {
    const added = await (await SELF.fetch(`${ORIGIN}/_/api/bookmarks`,
      authed(cookie, { label: 'Site', target: { kind: 'url', url: 'example.com' } }))).json() as any;
    expect(added.bookmarks).toHaveLength(1);
    expect(added.bookmarks[0].target.url).toBe('https://example.com/');

    const removed = await (await SELF.fetch(
      `${ORIGIN}/_/api/bookmarks/${added.bookmarks[0].id}`,
      authed(cookie, undefined, 'DELETE'))).json() as any;
    expect(removed.bookmarks).toHaveLength(0);
  });

  it('accepts a bookmark with no label at all', async () => {
    const added = await (await SELF.fetch(`${ORIGIN}/_/api/bookmarks`,
      authed(cookie, { target: { kind: 'url', url: 'example.com/unnamed' } }))).json() as any;
    expect(added.bookmarks).toHaveLength(1);
    expect(added.bookmarks[0].label).toBe('');
    expect(added.bookmarks[0].target.url).toBe('https://example.com/unnamed');
  });

  it('still rejects a bookmark with no usable target', async () => {
    const response = await SELF.fetch(`${ORIGIN}/_/api/bookmarks`,
      authed(cookie, { label: 'Nowhere', target: { kind: 'url', url: '' } }));
    expect(response.status).toBe(400);
  });

  it('records recently used targets', async () => {
    await SELF.fetch(`${ORIGIN}/_/api/send`,
      authed(cookie, { slot: 'main', target: { kind: 'url', url: 'https://recent.example.com/' } }));
    const state = await (await SELF.fetch(`${ORIGIN}/_/api/state`, authed(cookie))).json() as any;
    expect(state.mru[0].target.url).toBe('https://recent.example.com/');
  });

  it('renders a qr svg', async () => {
    const response = await SELF.fetch(`${ORIGIN}/_/qr.svg`, authed(cookie));
    expect(response.headers.get('content-type')).toBe('image/svg+xml');
    const body = await response.text();
    expect(body.startsWith('<svg')).toBe(true);
    expect(body).toContain('<path');
  });

  // This image gets printed. Encoding http:// would cost every scan, forever,
  // an extra redirect hop — so it must not follow the request's own scheme.
  it('always encodes https, even when reached over http', async () => {
    const response = await SELF.fetch('http://q.test/_/qr.svg', authed(cookie));
    const decoded = decodeQrSvg(await response.text());
    expect(decoded).toBe('https://q.test/');
  });

  it('exports state as a downloadable file', async () => {
    const response = await SELF.fetch(`${ORIGIN}/_/export.json`, authed(cookie));
    expect(response.headers.get('content-disposition')).toContain('attachment');
    expect(await response.json()).toHaveProperty('bookmarks');
  });
});
