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
    headers: {
      cookie,
      'x-skin-request': '1',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  };
}

function scan(extraHeaders: Record<string, string> = {}, method = 'GET'): Promise<Response> {
  return SELF.fetch(ORIGIN, {
    method,
    redirect: 'manual',
    headers: { 'user-agent': 'Mozilla/5.0 (iPhone) Safari/605.1', ...extraHeaders },
  });
}

/** The file key a scan landed on, from its /f/<key>/<name> redirect. */
async function scannedKey(): Promise<string | null> {
  const response = await scan();
  const location = response.headers.get('location') ?? '';
  const match = location.match(/\/f\/([0-9a-f]+)\//);
  return match ? match[1] : null;
}

let cookie: string;

async function makePool(name: string, imageCount: number): Promise<string> {
  const created = await (await SELF.fetch(`${ORIGIN}/_/api/pools`,
    authed(cookie, { name }))).json() as any;
  const pool = created.pools[created.pools.length - 1];

  for (let i = 0; i < imageCount; i++) {
    await SELF.fetch(`${ORIGIN}/_/api/upload?name=img${i}.png&pool=${pool.id}`, {
      method: 'POST',
      headers: { cookie, 'x-skin-request': '1', 'content-type': 'image/png' },
      body: `fake-image-${i}`,
      redirect: 'manual',
    });
  }
  return pool.id;
}

beforeEach(async () => {
  cookie = await login();
  await SELF.fetch(`${ORIGIN}/_/api/sequence/arm`, authed(cookie, undefined, 'DELETE'));
  await SELF.fetch(`${ORIGIN}/_/api/temp`, authed(cookie, undefined, 'DELETE'));
  await SELF.fetch(`${ORIGIN}/_/api/splash`, authed(cookie, { on: false }));
  await SELF.fetch(`${ORIGIN}/_/api/send`, authed(cookie, { slot: 'main',
    target: { kind: 'url', url: 'https://main.example.com/' },
  }));
});

describe('serving a random image', () => {
  it('sends each scan to an image from the set', async () => {
    const poolId = await makePool('Photos', 4);
    await SELF.fetch(`${ORIGIN}/_/api/send`,
      authed(cookie, { slot: 'main', target: { kind: 'pool', poolId } }));

    for (let i = 0; i < 6; i++) {
      const response = await scan();
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toMatch(/\/f\/[0-9a-f]{32}\/img\d\.png$/);
    }
  });

  /**
   * The reason this draws from a shuffled bag instead of picking at random.
   * With three images, pure random repeats back-to-back a third of the time,
   * which reads as a bug rather than as randomness.
   */
  it('shows every image once before repeating any', async () => {
    const poolId = await makePool('Photos', 5);
    await SELF.fetch(`${ORIGIN}/_/api/send`,
      authed(cookie, { slot: 'main', target: { kind: 'pool', poolId } }));

    const firstPass = [];
    for (let i = 0; i < 5; i++) firstPass.push(await scannedKey());
    expect(new Set(firstPass).size).toBe(5);

    const secondPass = [];
    for (let i = 0; i < 5; i++) secondPass.push(await scannedKey());
    expect(new Set(secondPass).size).toBe(5);
  });

  /**
   * Two images and many draws makes this a near-deterministic detector: with a
   * two-image set the draw order must strictly alternate, so a single repeat
   * anywhere is a seam failure. At three images a short run would let a broken
   * seam slip through about a third of the time.
   */
  it('never repeats across the seam between two passes', async () => {
    const poolId = await makePool('Pair', 2);
    await SELF.fetch(`${ORIGIN}/_/api/send`,
      authed(cookie, { slot: 'main', target: { kind: 'pool', poolId } }));

    const drawn: (string | null)[] = [];
    for (let i = 0; i < 40; i++) drawn.push(await scannedKey());

    const repeats = drawn.filter((key, i) => i > 0 && key === drawn[i - 1]);
    expect(repeats).toHaveLength(0);
    // Sanity: it really did alternate between two distinct images.
    expect(new Set(drawn).size).toBe(2);
  });

  it('handles a one-image set without spinning', async () => {
    const poolId = await makePool('Just one', 1);
    await SELF.fetch(`${ORIGIN}/_/api/send`,
      authed(cookie, { slot: 'main', target: { kind: 'pool', poolId } }));

    const a = await scannedKey();
    const b = await scannedKey();
    expect(a).toBeTruthy();
    expect(b).toBe(a);
  });

  it('counts every scan of a set', async () => {
    const poolId = await makePool('Photos', 3);
    await SELF.fetch(`${ORIGIN}/_/api/send`,
      authed(cookie, { slot: 'main', target: { kind: 'pool', poolId } }));

    const before = await (await SELF.fetch(`${ORIGIN}/_/api/state`, authed(cookie))).json() as any;
    await scan();
    await scan();
    const after = await (await SELF.fetch(`${ORIGIN}/_/api/state`, authed(cookie))).json() as any;
    expect(after.hits).toBe(before.hits + 2);
  });

  it('shows the splash first when it is on', async () => {
    const poolId = await makePool('Photos', 2);
    await SELF.fetch(`${ORIGIN}/_/api/send`,
      authed(cookie, { slot: 'main', target: { kind: 'pool', poolId } }));
    await SELF.fetch(`${ORIGIN}/_/api/splash`, authed(cookie, { on: true }));

    const body = await (await scan()).text();
    expect(body).toContain('thank you for scanning');
    expect(body).toMatch(/\/f\/[0-9a-f]{32}\/img\d\.png/);
  });
});

describe('an empty or broken set never dead-ends a scan', () => {
  it('falls through to main when a temp points at an empty set', async () => {
    const created = await (await SELF.fetch(`${ORIGIN}/_/api/pools`,
      authed(cookie, { name: 'Empty' }))).json() as any;
    const poolId = created.pools[created.pools.length - 1].id;

    await SELF.fetch(`${ORIGIN}/_/api/send`, authed(cookie, { slot: 'temp',
      target: { kind: 'pool', poolId }, durationMs: 3600_000,
    }));

    const response = await scan();
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://main.example.com/');
  });

  it('falls back rather than 404ing when main is an empty set', async () => {
    const created = await (await SELF.fetch(`${ORIGIN}/_/api/pools`,
      authed(cookie, { name: 'Empty' }))).json() as any;
    const poolId = created.pools[created.pools.length - 1].id;

    await SELF.fetch(`${ORIGIN}/_/api/send`,
      authed(cookie, { slot: 'main', target: { kind: 'pool', poolId } }));

    const response = await scan();
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain('fallback.example.com');
  });

  /**
   * A set holding the key of a deleted object would hand a 404 to whoever drew
   * it, so deleting a file has to reach into the sets that reference it.
   */
  it('drops a deleted file out of every set that held it', async () => {
    const poolId = await makePool('Photos', 3);
    const state = await (await SELF.fetch(`${ORIGIN}/_/api/state`, authed(cookie))).json() as any;
    const victim = state.pools.find((p: any) => p.id === poolId).items[0];

    const after = await (await SELF.fetch(`${ORIGIN}/_/api/files/${victim}`,
      authed(cookie, undefined, 'DELETE'))).json() as any;

    const pool = after.pools.find((p: any) => p.id === poolId);
    expect(pool.items).not.toContain(victim);
    expect(pool.bag).not.toContain(victim);
    expect(pool.items).toHaveLength(2);
  });

  it('emptying a set by deletion sends scans back to normal resolution', async () => {
    const poolId = await makePool('Photos', 1);
    await SELF.fetch(`${ORIGIN}/_/api/send`,
      authed(cookie, { slot: 'main', target: { kind: 'url', url: 'https://main.example.com/' } }));
    await SELF.fetch(`${ORIGIN}/_/api/send`, authed(cookie, { slot: 'temp',
      target: { kind: 'pool', poolId }, durationMs: 3600_000,
    }));
    expect((await scan()).headers.get('location')).toMatch(/\/f\//);

    const state = await (await SELF.fetch(`${ORIGIN}/_/api/state`, authed(cookie))).json() as any;
    const onlyImage = state.pools.find((p: any) => p.id === poolId).items[0];
    await SELF.fetch(`${ORIGIN}/_/api/files/${onlyImage}`, authed(cookie, undefined, 'DELETE'));

    expect((await scan()).headers.get('location')).toBe('https://main.example.com/');
  });
});

describe('managing sets', () => {
  it('rejects an unnamed set', async () => {
    const response = await SELF.fetch(`${ORIGIN}/_/api/pools`, authed(cookie, { name: '  ' }));
    expect(response.status).toBe(400);
  });

  it('removes one image from a set but keeps the file in the library', async () => {
    const poolId = await makePool('Photos', 3);
    let state = await (await SELF.fetch(`${ORIGIN}/_/api/state`, authed(cookie))).json() as any;
    const key = state.pools.find((p: any) => p.id === poolId).items[0];

    state = await (await SELF.fetch(
      `${ORIGIN}/_/api/pools/${poolId}/items/${key}`,
      authed(cookie, undefined, 'DELETE'))).json() as any;

    expect(state.pools.find((p: any) => p.id === poolId).items).toHaveLength(2);
    expect(state.files.some((f: any) => f.key === key)).toBe(true);
  });

  it('adds an already-uploaded file to a set', async () => {
    const poolId = await makePool('Photos', 1);
    const upload = await (await SELF.fetch(`${ORIGIN}/_/api/upload?name=loose.png`, {
      method: 'POST',
      headers: { cookie, 'x-skin-request': '1', 'content-type': 'image/png' },
      body: 'loose',
      redirect: 'manual',
    })).json() as any;

    const state = await (await SELF.fetch(`${ORIGIN}/_/api/pools/${poolId}/items`,
      authed(cookie, { key: upload.file.key }))).json() as any;
    expect(state.pools.find((p: any) => p.id === poolId).items).toHaveLength(2);
  });

  it('deleting a set leaves its images in the library', async () => {
    const poolId = await makePool('Photos', 2);
    const state = await (await SELF.fetch(`${ORIGIN}/_/api/pools/${poolId}`,
      authed(cookie, undefined, 'DELETE'))).json() as any;

    expect(state.pools.some((p: any) => p.id === poolId)).toBe(false);
    expect(state.files.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects a malformed set target', async () => {
    const response = await SELF.fetch(`${ORIGIN}/_/api/send`,
      authed(cookie, { slot: 'main', target: { kind: 'pool' } }));
    expect(response.status).toBe(400);
  });
});

describe('what must not consume a draw', () => {
  /**
   * A draw is consumable in exactly the way a sequence step is, so it carries
   * the same guards. `peekedKey` asks what the next real scanner would get
   * without taking it, which is also the assertion these tests need.
   */
  async function peekedKey(): Promise<string | null> {
    const response = await scan({ 'sec-purpose': 'prefetch' });
    return (response.headers.get('location') ?? '').match(/\/f\/([0-9a-f]+)\//)?.[1] ?? null;
  }

  async function pointAtSet(images: number): Promise<void> {
    const poolId = await makePool('Photos', images);
    await SELF.fetch(`${ORIGIN}/_/api/send`,
      authed(cookie, { slot: 'temp', target: { kind: 'pool', poolId }, durationMs: 3600_000 }));
  }

  it('a browser prefetch peeks at the next image without taking it', async () => {
    await pointAtSet(4);
    const peeked = await peekedKey();
    expect(await scannedKey()).toBe(peeked);
  });

  it('link unfurlers preview the image the next scanner will get', async () => {
    await pointAtSet(4);
    const peeked = await peekedKey();

    // Pasting the code into a group chat can fire several of these at once.
    await scan({ 'user-agent': 'WhatsApp/2.0' });
    await scan({ 'user-agent': 'Slackbot-LinkExpanding 1.0' });
    await scan({ 'user-agent': 'facebookexternalhit/1.1' });

    expect(await scannedKey()).toBe(peeked);
  });

  it('a HEAD request does not consume an image', async () => {
    await pointAtSet(4);
    const peeked = await peekedKey();
    await scan({}, 'HEAD');
    expect(await scannedKey()).toBe(peeked);
  });

  it('a peek does not disturb the no-repeat guarantee of the pass', async () => {
    await pointAtSet(3);
    const drawn: (string | null)[] = [];
    for (let i = 0; i < 3; i++) {
      await scan({ 'sec-purpose': 'prefetch' });
      await scan({ 'user-agent': 'Twitterbot/1.0' });
      drawn.push(await scannedKey());
    }
    expect(new Set(drawn).size).toBe(3);
  });
});

describe('sets combined with the other layers', () => {
  it('works as a sequence step, so each person gets a random image', async () => {
    const poolId = await makePool('Photos', 4);
    await SELF.fetch(`${ORIGIN}/_/api/sequence/steps`, authed(cookie, {
      steps: [
        { target: { kind: 'text', text: 'you are first' } },
        { target: { kind: 'pool', poolId } },
      ],
    }));
    await SELF.fetch(`${ORIGIN}/_/api/sequence/arm`, authed(cookie, { durationMs: 3600_000 }));

    expect(await (await scan()).text()).toContain('you are first');
    expect((await scan()).headers.get('location')).toMatch(/\/f\/[0-9a-f]{32}\/img\d\.png$/);
  });
});
