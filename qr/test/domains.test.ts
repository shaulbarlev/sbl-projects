import { SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

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
    headers: { cookie, 'x-skin-request': '1', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  };
}

const visit = (url: string) => SELF.fetch(url, { redirect: 'manual' });

let cookie: string;

beforeEach(async () => {
  cookie = await login();
  for (const host of ['shaulb.com', 'shaulbarlev.com']) {
    await SELF.fetch(`${ORIGIN}/_/api/domain/${host}`, authed(cookie, undefined, 'DELETE'));
  }
});

describe('the other domains', () => {
  it('are the site at their own address with nothing set, whatever the QR is doing', async () => {
    await SELF.fetch(`${ORIGIN}/_/api/send`, authed(cookie, { slot: 'temp', target: { kind: 'url', url: 'https://party.example.com/' }, durationMs: 60_000 }));
    expect((await visit(ORIGIN)).headers.get('location')).toBe('https://party.example.com/');
    const response = await visit('https://shaulb.com/doorlock/?x=1');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('the site /doorlock/');
    expect(await (await visit('https://shaulbarlev.com/')).text()).toBe('the site /');
    expect(await (await visit('https://www.shaulbarlev.com/x')).text()).toBe('the site /x');
    await SELF.fetch(`${ORIGIN}/_/api/temp`, authed(cookie, undefined, 'DELETE'));
  });

  it('can each be pointed at a link, on their own, and cleared again', async () => {
    await SELF.fetch(`${ORIGIN}/_/api/send`, authed(cookie, { slot: 'shaulb.com', target: { kind: 'url', url: 'https://elsewhere.example.com/' } }));
    expect((await visit('https://shaulb.com/')).headers.get('location')).toBe('https://elsewhere.example.com/');
    expect(await (await visit('https://shaulbarlev.com/')).text()).toBe('the site /');
    // the QR itself is untouched
    const root = await SELF.fetch(ORIGIN, { redirect: 'manual' });
    expect(root.status).toBe(200);

    const state = (await (await SELF.fetch(`${ORIGIN}/_/api/domain/shaulb.com`, authed(cookie, undefined, 'DELETE'))).json()) as any;
    expect(state.domains['shaulb.com']).toBeUndefined();
    expect(await (await visit('https://shaulb.com/')).text()).toBe('the site /');
  });

  it('render a message in place, and refuse a domain that is not theirs', async () => {
    await SELF.fetch(`${ORIGIN}/_/api/send`, authed(cookie, { slot: 'shaulbarlev.com', target: { kind: 'text', text: 'back soon' } }));
    const page = await visit('https://shaulbarlev.com/');
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('back soon');

    const bad = await SELF.fetch(`${ORIGIN}/_/api/send`, authed(cookie, { slot: 'example.com', target: { kind: 'url', url: 'https://x.example.com/' } }));
    expect(bad.status).toBe(400);
    expect((await SELF.fetch(`${ORIGIN}/_/api/domain/example.com`, authed(cookie, undefined, 'DELETE'))).status).toBe(400);
  });

  it('list themselves for the panel', async () => {
    const state = (await (await SELF.fetch(`${ORIGIN}/_/api/state`, authed(cookie))).json()) as any;
    expect(state.domainHosts).toEqual(['shaulb.com', 'shaulbarlev.com']);
  });
});
