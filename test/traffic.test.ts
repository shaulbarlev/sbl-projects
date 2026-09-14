import { SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

function scan(): Promise<Response> {
  return SELF.fetch(ORIGIN, {
    redirect: 'manual',
    headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/605.1' },
  });
}

function toggle(entity: string, withHeader = true): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/traffic/toggle`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(withHeader ? { 'x-skin-request': '1' } : {}) },
    body: JSON.stringify({ entity }),
  });
}

let cookie: string;

function traffic(on: boolean) {
  return SELF.fetch(`${ORIGIN}/_/api/traffic`, authed(cookie, { on }));
}

beforeEach(async () => {
  cookie = await login();
  await SELF.fetch(`${ORIGIN}/_/api/sequence/arm`, authed(cookie, undefined, 'DELETE'));
  await SELF.fetch(`${ORIGIN}/_/api/temp`, authed(cookie, undefined, 'DELETE'));
  await SELF.fetch(`${ORIGIN}/_/api/splash`, authed(cookie, { on: false }));
  await SELF.fetch(`${ORIGIN}/_/api/send`, authed(cookie, { slot: 'main', url: 'https://main.example.com/' }));
  await traffic(false);
});

describe('the traffic light page', () => {
  it('is just a stray path while the master switch is off', async () => {
    const response = await SELF.fetch(`${ORIGIN}/traffic`, { redirect: 'manual' });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://main.example.com/');
  });

  it('renders while on', async () => {
    await traffic(true);
    const response = await SELF.fetch(`${ORIGIN}/traffic`);
    expect(response.status).toBe(200);
    const page = await response.text();
    expect(page).toContain('aria-label="Green light"');
    expect(page).toContain('aria-label="Orange light"');
  });

  it('takes over the root when sent, and steps aside when switched off', async () => {
    await traffic(true);
    await SELF.fetch(`${ORIGIN}/_/api/send`, authed(cookie, { traffic: 'yes', minutes: 5 }));
    const takeover = await scan();
    expect(takeover.status).toBe(200);
    expect(await takeover.text()).toContain('<title>Traffic light</title>');

    // Off is off everywhere: the temp is still there but skipped, like an
    // empty image set.
    await traffic(false);
    const after = await scan();
    expect(after.status).toBe(302);
    expect(after.headers.get('location')).toBe('https://main.example.com/');
  });

  it('refuses a toggle without the request header, for an unknown light, or with a fat body', async () => {
    await traffic(true);
    expect((await toggle('switch.tasmota', false)).status).toBe(403);
    expect((await toggle('switch.everything_else')).status).toBe(400);
    const fat = await SELF.fetch(`${ORIGIN}/traffic/toggle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-skin-request': '1' },
      body: JSON.stringify({ entity: 'switch.tasmota', padding: 'x'.repeat(400) }),
    });
    expect(fat.status).toBe(413);
  });

  it('as a sequence step, steps aside with the switch off instead of burning steps', async () => {
    await SELF.fetch(`${ORIGIN}/_/api/sequence/steps`, authed(cookie, {
      steps: [{ target: { kind: 'traffic' } }, { target: { kind: 'text', text: 'second' } }],
    }));
    await SELF.fetch(`${ORIGIN}/_/api/sequence/arm`, authed(cookie, { durationMs: 3600_000 }));
    const response = await scan();
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://main.example.com/');
    const state = (await (await SELF.fetch(`${ORIGIN}/_/api/state`, authed(cookie))).json()) as any;
    expect(state.sequenceStatus.cursor).toBe(0);
  });

  it('reports offline when no agent is connected', async () => {
    await traffic(true);
    const state = (await (await SELF.fetch(`${ORIGIN}/traffic/state`)).json()) as any;
    expect(state.online).toBe(false);
    expect((await toggle('switch.tasmota')).status).toBe(503);
  });
});

describe('the page socket', () => {
  it('refuses a page socket while the light is off', async () => {
    const response = await SELF.fetch(`${ORIGIN}/traffic/ws`, { headers: { upgrade: 'websocket' } });
    expect(response.status).toBe(404);
  });

  it('pushes state on connect and after a tap, and never takes state from a page', async () => {
    const agentRes = await SELF.fetch(`${ORIGIN}/_/agent`, {
      headers: { upgrade: 'websocket', authorization: 'Bearer test-agent-token' },
    });
    const agent = agentRes.webSocket!;
    agent.accept();
    const calls: any[] = [];
    agent.addEventListener('message', (event) => {
      const m = JSON.parse(String(event.data));
      if (m.type !== 'call') return;
      calls.push(m);
      agent.send(JSON.stringify({ type: 'reply', id: m.id, ok: true, states: { [m.entity]: 'on' }, haMs: 7 }));
    });
    agent.send(JSON.stringify({ type: 'hello', states: { 'switch.tasmota': 'off', 'switch.traffic_1_power1': 'off' } }));
    await traffic(true);

    const pageRes = await SELF.fetch(`${ORIGIN}/traffic/ws`, { headers: { upgrade: 'websocket' } });
    expect(pageRes.status).toBe(101);
    const page = pageRes.webSocket!;
    page.accept();
    const seen: any[] = [];
    page.addEventListener('message', (event) => seen.push(JSON.parse(String(event.data))));
    await vi.waitFor(() => expect(seen.some((m) => m.type === 'state' && m.online === true)).toBe(true));

    page.send(JSON.stringify({ type: 'set', entity: 'switch.tasmota', state: 'on' }));
    // The tap's own answer carries timing, not state; the state arrives as
    // a push once the agent reports it.
    await vi.waitFor(() => expect(seen.some((m) => m.type === 'result' && m.ok)).toBe(true));
    await vi.waitFor(() =>
      expect(seen.some((m) => m.type === 'state' && m.states?.['switch.tasmota'] === 'on')).toBe(true));
    expect(calls[0]).toMatchObject({ entity: 'switch.tasmota', service: 'turn_on' });

    // Fast taps all go down, in order.
    for (const state of ['off', 'on', 'off']) {
      page.send(JSON.stringify({ type: 'set', entity: 'switch.tasmota', state }));
    }
    await vi.waitFor(() => expect(calls).toHaveLength(4));
    expect(calls.slice(1).map((c) => c.service)).toEqual(['turn_off', 'turn_on', 'turn_off']);
    const result = seen.find((m) => m.type === 'result');
    expect(result.haMs).toBe(7);
    expect(typeof result.agentMs).toBe('number');
    expect(result.states).toBeUndefined();

    // A page cannot masquerade as the agent.
    page.send(JSON.stringify({ type: 'state', states: { 'switch.tasmota': 'off' } }));
    page.send(JSON.stringify({ type: 'reply', id: 'anything', ok: true, states: { 'switch.tasmota': 'off' } }));
    await new Promise((resolve) => setTimeout(resolve, 60));
    const state = (await (await SELF.fetch(`${ORIGIN}/traffic/state`)).json()) as any;
    expect(state.states['switch.tasmota']).toBe('on');

    page.close();
    agent.close();
  });
});

describe('the home agent socket', () => {
  it('rejects a bad token', async () => {
    const response = await SELF.fetch(`${ORIGIN}/_/agent`, {
      headers: { upgrade: 'websocket', authorization: 'Bearer nope' },
    });
    expect(response.status).toBe(401);
  });

  it('relays state and toggles through a connected agent', async () => {
    const response = await SELF.fetch(`${ORIGIN}/_/agent`, {
      headers: { upgrade: 'websocket', authorization: 'Bearer test-agent-token' },
    });
    expect(response.status).toBe(101);
    const ws = response.webSocket!;
    ws.accept();
    const inbox: any[] = [];
    ws.addEventListener('message', (event) => inbox.push(JSON.parse(String(event.data))));

    ws.send(JSON.stringify({ type: 'hello', states: { 'switch.tasmota': 'on', 'switch.traffic_1_power1': 'off' } }));
    await traffic(true);
    await vi.waitFor(async () => {
      const state = (await (await SELF.fetch(`${ORIGIN}/traffic/state`)).json()) as any;
      expect(state.online).toBe(true);
      expect(state.states['switch.tasmota']).toBe('on');
    });

    // A tap: the agent gets a call and answers with the new state.
    const tap = toggle('switch.tasmota');
    await vi.waitFor(() => expect(inbox.some((m) => m.type === 'call')).toBe(true));
    const call = inbox.find((m) => m.type === 'call');
    expect(call).toMatchObject({ entity: 'switch.tasmota', service: 'toggle' });
    ws.send(JSON.stringify({ type: 'reply', id: call.id, ok: true, states: { 'switch.tasmota': 'off' } }));

    const result = await tap;
    expect(result.status).toBe(200);
    expect(((await result.json()) as any).ok).toBe(true);
    expect(result.headers.get('server-timing')).toMatch(/^do;dur=\d+, agent;dur=\d+, ha;dur=/);
    // The agent's reply carried the state, so the read reflects it.
    const read = (await (await SELF.fetch(`${ORIGIN}/traffic/state`)).json()) as any;
    expect(read.states['switch.tasmota']).toBe('off');

    // A burst lands in full and in order, each tap naming the state it wants.
    const burst = ['on', 'off', 'on'].map((state) => SELF.fetch(`${ORIGIN}/traffic/toggle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-skin-request': '1' },
      body: JSON.stringify({ entity: 'switch.traffic_1_power1', state }),
    }));
    const orange = () => inbox.filter((m) => m.type === 'call' && m.entity === 'switch.traffic_1_power1');
    await vi.waitFor(() => expect(orange()).toHaveLength(3));
    expect(orange().map((c) => c.service)).toEqual(['turn_on', 'turn_off', 'turn_on']);
    for (const c of orange()) ws.send(JSON.stringify({ type: 'reply', id: c.id, ok: true }));
    for (const response of await Promise.all(burst)) expect(response.status).toBe(200);

    // Only the known lamps are remembered, whatever the agent says.
    ws.send(JSON.stringify({ type: 'state', states: { 'switch.tasmota': 'on', 'lock.front_door': 'unlocked' } }));
    await vi.waitFor(async () => {
      const state = (await (await SELF.fetch(`${ORIGIN}/traffic/state`)).json()) as any;
      expect(state.states['switch.tasmota']).toBe('on');
      expect(state.states['lock.front_door']).toBeUndefined();
    });
    ws.close();
  });
});
