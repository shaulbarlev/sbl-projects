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

/** A scan from a brand-new device: no cookies, an ordinary phone user agent. */
function scan(extraHeaders: Record<string, string> = {}): Promise<Response> {
  return SELF.fetch(ORIGIN, {
    redirect: 'manual',
    headers: {
      'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/605.1',
      ...extraHeaders,
    },
  });
}

/** The claim cookie a scanner was handed, ready to send back. */
function claimOf(response: Response): string {
  const raw = response.headers.get('set-cookie') ?? '';
  return raw.split(';')[0];
}

let cookie: string;

const MESSAGES = ['you are first', 'second!', 'third', 'last one'];

async function setUpFourStepSequence(durationMs = 3600_000) {
  await SELF.fetch(`${ORIGIN}/_/api/sequence/steps`, authed(cookie, {
    steps: MESSAGES.map((text) => ({ target: { kind: 'text', text } })),
  }));
  return SELF.fetch(`${ORIGIN}/_/api/sequence/arm`, authed(cookie, { durationMs }));
}

/** The per-device switch. Off by default; the sticky-claim tests turn it on. */
function sticky(on: boolean) {
  return SELF.fetch(`${ORIGIN}/_/api/sequence/sticky`, authed(cookie, { on }));
}

beforeEach(async () => {
  cookie = await login();
  await sticky(false);
  await SELF.fetch(`${ORIGIN}/_/api/sequence/arm`, authed(cookie, undefined, 'DELETE'));
  await SELF.fetch(`${ORIGIN}/_/api/sequence/steps`, authed(cookie, { steps: [] }));
  await SELF.fetch(`${ORIGIN}/_/api/temp`, authed(cookie, undefined, 'DELETE'));
  await SELF.fetch(`${ORIGIN}/_/api/splash`, authed(cookie, { on: false }));
  await SELF.fetch(`${ORIGIN}/_/api/send`, authed(cookie, { slot: 'main',
    target: { kind: 'url', url: 'https://main.example.com/' },
  }));
});

describe('the four-friends scenario', () => {
  it('hands each consecutive scanner the next message, then returns to main', async () => {
    await setUpFourStepSequence();

    for (const expected of MESSAGES) {
      const response = await scan();
      expect(response.status).toBe(200);
      expect(await response.text()).toContain(expected);
    }

    // Fifth person: the sequence is spent, so normal resolution resumes.
    const after = await scan();
    expect(after.status).toBe(302);
    expect(after.headers.get('location')).toBe('https://main.example.com/');
  });

  /**
   * The one that makes the feature usable. Friend #1 locks their phone, Safari
   * reloads on unlock — without a sticky claim they would be showing friend
   * #2's message and friend #4 would get nothing.
   */
  it('by default a refresh moves on to the next step, and hands out no claim', async () => {
    await setUpFourStepSequence();

    const first = await scan();
    expect(await first.text()).toContain('you are first');
    expect(first.headers.get('set-cookie')).toBeNull();

    // Same phone, refreshed: the next step, not the same one again.
    const refreshed = await scan();
    expect(await refreshed.text()).toContain('second!');

    // A stale sticky cookie from an earlier mode is ignored, not honoured.
    const withOldClaim = await scan({ cookie: 'skin_step=whatever.0' });
    expect(await withOldClaim.text()).toContain('third');
  });

  it('keeps a claimed step on that device across reloads', async () => {
    await sticky(true);
    await setUpFourStepSequence();

    const first = await scan();
    expect(await first.text()).toContain('you are first');
    const claim = claimOf(first);

    for (let reload = 0; reload < 3; reload++) {
      const again = await scan({ cookie: claim });
      expect(await again.text()).toContain('you are first');
      // A reload must not hand out a second cookie or consume anything.
      expect(again.headers.get('set-cookie')).toBeNull();
    }

    // And the queue has only moved by one.
    const second = await scan();
    expect(await second.text()).toContain('second!');
  });

  it('keeps a claimed step after the last step has been handed out', async () => {
    await sticky(true);
    await setUpFourStepSequence();

    const first = await scan();
    expect(await first.text()).toContain('you are first');
    const claim = claimOf(first);

    // Friends 2, 3 and 4 scan. The sequence is now spent — but the run is not
    // over, and #1 is still holding their phone up.
    await scan();
    await scan();
    await scan();

    const reload = await scan({ cookie: claim });
    expect(await reload.text()).toContain('you are first');
    expect(reload.headers.get('set-cookie')).toBeNull();
  });

  it('gives four simultaneous scanners four different steps', async () => {
    await setUpFourStepSequence();

    const responses = await Promise.all([scan(), scan(), scan(), scan()]);
    const seen = await Promise.all(responses.map((r) => r.text()));

    for (const message of MESSAGES) {
      expect(seen.filter((body) => body.includes(message))).toHaveLength(1);
    }
  });
});

describe('what must not burn a step', () => {
  it('ignores link unfurlers entirely', async () => {
    await setUpFourStepSequence();

    const unfurl = await scan({ 'user-agent': 'Slackbot-LinkExpanding 1.0' });
    expect(unfurl.status).toBe(302);
    expect(unfurl.headers.get('location')).toBe('https://main.example.com/');

    // The queue is untouched, so a real person still gets step one.
    expect(await (await scan()).text()).toContain('you are first');
  });

  // Browsers speculatively fetch links. Without this the step meant for the
  // person in front of you is consumed before they scan.
  it.each([
    ['sec-purpose', 'prefetch'],
    ['purpose', 'prefetch'],
    ['x-moz', 'prefetch'],
  ])('peeks without claiming when %s: %s', async (header, value) => {
    await setUpFourStepSequence();

    const speculative = await scan({ [header]: value });
    expect(await speculative.text()).toContain('you are first');
    expect(speculative.headers.get('set-cookie')).toBeNull();

    expect(await (await scan()).text()).toContain('you are first');
  });

  it('does not let a HEAD request consume a step', async () => {
    await setUpFourStepSequence();

    await SELF.fetch(ORIGIN, { method: 'HEAD', redirect: 'manual' });
    expect(await (await scan()).text()).toContain('you are first');
  });

  it('falls through rather than claiming when the cookie is forged out of range', async () => {
    await sticky(true);
    await setUpFourStepSequence();
    const first = await scan();
    const runId = claimOf(first).split('=')[1].split('.')[0];

    const forged = await scan({ cookie: `skin_step=${runId}.99` });
    expect(forged.status).toBe(302);
    expect(forged.headers.get('location')).toBe('https://main.example.com/');

    // Crucially it did not eat a step on the way past.
    expect(await (await scan()).text()).toContain('second!');
  });
});

describe('arming, disarming, expiry', () => {
  it('does nothing until armed', async () => {
    await SELF.fetch(`${ORIGIN}/_/api/sequence/steps`, authed(cookie, {
      steps: [{ target: { kind: 'text', text: 'not yet' } }],
    }));
    const response = await scan();
    expect(response.status).toBe(302);
  });

  it('outranks a live temp', async () => {
    await SELF.fetch(`${ORIGIN}/_/api/send`, authed(cookie, { slot: 'temp',
      target: { kind: 'url', url: 'https://temp.example.com/' },
      durationMs: 3600_000,
    }));
    await setUpFourStepSequence();

    expect(await (await scan()).text()).toContain('you are first');
  });

  it('reveals the temp again once the sequence is spent', async () => {
    await SELF.fetch(`${ORIGIN}/_/api/send`, authed(cookie, { slot: 'temp',
      target: { kind: 'url', url: 'https://temp.example.com/' },
      durationMs: 3600_000,
    }));
    await SELF.fetch(`${ORIGIN}/_/api/sequence/steps`, authed(cookie, {
      steps: [{ target: { kind: 'text', text: 'only one' } }],
    }));
    await SELF.fetch(`${ORIGIN}/_/api/sequence/arm`, authed(cookie, { durationMs: 3600_000 }));

    expect(await (await scan()).text()).toContain('only one');
    const next = await scan();
    expect(next.headers.get('location')).toBe('https://temp.example.com/');
  });

  it('disarms on demand but keeps the steps for next time', async () => {
    await setUpFourStepSequence();
    await scan();

    const disarmed = await (await SELF.fetch(
      `${ORIGIN}/_/api/sequence/arm`, authed(cookie, undefined, 'DELETE'))).json() as any;
    expect(disarmed.sequenceStatus.live).toBe(false);
    expect(disarmed.sequence.steps).toHaveLength(4);

    expect((await scan()).status).toBe(302);
  });

  it('re-arming restarts from step one and voids old claims', async () => {
    await sticky(true);
    await setUpFourStepSequence();
    const first = await scan();
    const staleClaim = claimOf(first);
    await scan();

    await SELF.fetch(`${ORIGIN}/_/api/sequence/arm`, authed(cookie, { durationMs: 3600_000 }));

    // The old claim carries a dead run id, so this device is treated as new.
    const returning = await scan({ cookie: staleClaim });
    expect(await returning.text()).toContain('you are first');
    expect(returning.headers.get('set-cookie')).toBeTruthy();
  });

  // Arming records a deadline. That the deadline is actually *honoured* is a
  // property of the pure resolver and is tested against the clock in
  // resolve.test.ts, rather than by sleeping for a minute here.
  it('records a bounded deadline when armed', async () => {
    await setUpFourStepSequence(60_000);
    const status = await (await SELF.fetch(`${ORIGIN}/_/api/state`, authed(cookie))).json() as any;
    expect(status.sequenceStatus.live).toBe(true);
    expect(status.sequenceStatus.expiresAt - Date.now()).toBeLessThanOrEqual(60_000);
  });

  it('clamps an absurd arm duration to the seven day ceiling', async () => {
    await setUpFourStepSequence(1e15);
    const status = await (await SELF.fetch(`${ORIGIN}/_/api/state`, authed(cookie))).json() as any;
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    expect(status.sequenceStatus.expiresAt - Date.now()).toBeLessThanOrEqual(sevenDays + 1000);
  });

  it('adding a step to a spent run does not silently re-arm it', async () => {
    await SELF.fetch(`${ORIGIN}/_/api/sequence/steps`, authed(cookie, {
      steps: [{ target: { kind: 'text', text: 'only one' } }],
    }));
    await SELF.fetch(`${ORIGIN}/_/api/sequence/arm`, authed(cookie, { durationMs: 3600_000 }));
    await scan();

    const edited = await (await SELF.fetch(`${ORIGIN}/_/api/sequence/steps`, authed(cookie, {
      steps: [
        { target: { kind: 'text', text: 'only one' } },
        { target: { kind: 'text', text: 'added later' } },
      ],
    }))).json() as any;
    expect(edited.sequenceStatus.live).toBe(false);

    // The deadline has not passed, so without the guard this scan would be
    // ambushed by a step nobody armed.
    expect((await scan()).status).toBe(302);
  });

  it('editing steps mid-run leaves already-claimed positions alone', async () => {
    await setUpFourStepSequence();
    await scan();
    await scan();

    const edited = await (await SELF.fetch(`${ORIGIN}/_/api/sequence/steps`, authed(cookie, {
      steps: [...MESSAGES.slice(0, 3), 'rewritten last'].map((text) => ({
        target: { kind: 'text', text },
      })),
    }))).json() as any;
    expect(edited.sequenceStatus.cursor).toBe(2);

    expect(await (await scan()).text()).toContain('third');
    expect(await (await scan()).text()).toContain('rewritten last');
  });
});

describe('message targets', () => {
  it('renders text rather than redirecting, and escapes it', async () => {
    await SELF.fetch(`${ORIGIN}/_/api/send`, authed(cookie, { slot: 'main',
      target: { kind: 'text', text: '<img src=x onerror=alert(1)>' },
    }));
    const response = await scan();
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).not.toContain('<img src=x');
    expect(body).toContain('&lt;img src=x');
  });

  it('rejects an empty message', async () => {
    const response = await SELF.fetch(`${ORIGIN}/_/api/send`,
      authed(cookie, { slot: 'main', target: { kind: 'text', text: '   ' } }));
    expect(response.status).toBe(400);
  });

  // Splash precedes a redirect; a message has nothing to redirect to.
  it('skips the splash for messages', async () => {
    await SELF.fetch(`${ORIGIN}/_/api/splash`, authed(cookie, { on: true }));
    await SELF.fetch(`${ORIGIN}/_/api/send`,
      authed(cookie, { slot: 'main', target: { kind: 'text', text: 'straight to this' } }));

    const body = await (await scan()).text();
    expect(body).toContain('straight to this');
    expect(body).not.toContain('thank you for scanning');
  });

  it('still shows the splash for link steps in a sequence', async () => {
    await SELF.fetch(`${ORIGIN}/_/api/splash`, authed(cookie, { on: true }));
    await SELF.fetch(`${ORIGIN}/_/api/sequence/steps`, authed(cookie, {
      steps: [{ target: { kind: 'url', url: 'https://step.example.com/' } }],
    }));
    await SELF.fetch(`${ORIGIN}/_/api/sequence/arm`, authed(cookie, { durationMs: 3600_000 }));

    const body = await (await scan()).text();
    expect(body).toContain('thank you for scanning');
    expect(body).toContain('https://step.example.com/');
  });
});
