#!/usr/bin/env python3
"""The home end of the traffic light.

Keeps one WebSocket open to the Durable Object at sbl.cx and one to Home
Assistant on the LAN. Pushes the lamps' state up whenever it changes and flips
a switch when asked. Hard allowlist: two switches, on/off/toggle only, so even
a compromised Worker cannot reach anything else through here.

Configuration comes from the environment (see skin-agent.service):
  SKIN_URL     wss://sbl.cx/_/agent
  AGENT_TOKEN  the bearer the Worker expects
  HA_URL       http://192.168.50.232:8123  (plain http on the LAN: the token
               travels in clear between this box and Home Assistant)
  HA_TOKEN     a Home Assistant long-lived access token
"""
import asyncio
import json
import logging
import os
import time
import urllib.request

import websockets

ALLOWED = {'switch.tasmota', 'switch.traffic_1_power1'}
SERVICES = {'toggle', 'turn_on', 'turn_off'}
# Per-lamp rate guard, the last line of defence if the Worker is ever
# compromised. Well above any finger: twenty a second.
MIN_GAP_S = 0.05

SKIN_URL = os.environ['SKIN_URL']
AGENT_TOKEN = os.environ['AGENT_TOKEN']
HA_URL = os.environ['HA_URL'].rstrip('/')
HA_TOKEN = os.environ['HA_TOKEN']
HA_WS = HA_URL.replace('http://', 'ws://', 1).replace('https://', 'wss://', 1) + '/api/websocket'

log = logging.getLogger('skin-agent')
states = {}     # entity -> 'on' | 'off' | ...
last_call = {}  # entity -> monotonic seconds of the last accepted call
locks = {}      # entity -> asyncio.Lock: calls land in order per lamp, lamps in parallel
tasks = set()   # in-flight calls; a task with no reference can be collected mid-run
skin = None     # the live socket to sbl.cx, if any


def ha_rest(method, path, body=None):
    req = urllib.request.Request(
        HA_URL + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Authorization': f'Bearer {HA_TOKEN}', 'Content-Type': 'application/json'})
    # Under the Worker's 4 s wait, so a slow device reads as failed here and
    # there alike, never as failed to the scanner while it still flips.
    with urllib.request.urlopen(req, timeout=3) as r:
        return json.load(r)


def read_states():
    for entity in ALLOWED:
        states[entity] = ha_rest('GET', f'/api/states/{entity}')['state']


async def push(ws, kind):
    await ws.send(json.dumps({'type': kind, 'states': states}))


async def handle_call(ws, msg):
    entity, service = msg.get('entity'), msg.get('service', 'toggle')
    reply = {'type': 'reply', 'id': msg.get('id')}
    if entity not in ALLOWED or service not in SERVICES:
        log.warning('refused %s %s', service, entity)
        reply.update(ok=False, error='not allowed')
        await ws.send(json.dumps(reply))
        return
    async with locks.setdefault(entity, asyncio.Lock()):
        now = time.monotonic()
        if now - last_call.get(entity, 0) < MIN_GAP_S:
            reply.update(ok=False, error='busy')
            await ws.send(json.dumps(reply))
            return
        last_call[entity] = now
        try:
            started = time.monotonic()
            # The service call answers with every state it changed. A Tasmota
            # reports over MQTT after the call returns, so its state is usually
            # not in the list yet; then say nothing about state — the
            # subscription in ha_loop pushes the truth the moment it lands,
            # and a stale value here would only make the page flicker.
            changed = await asyncio.to_thread(
                ha_rest, 'POST', f'/api/services/switch/{service}', {'entity_id': entity})
            seen = {s['entity_id']: s['state'] for s in changed if s.get('entity_id') in ALLOWED}
            reply.update(ok=True, haMs=round((time.monotonic() - started) * 1000))
            if entity in seen:
                states.update(seen)
                reply['states'] = states
            log.info('%s %s (%sms)', service, entity, reply['haMs'])
        except Exception as err:  # noqa: BLE001 - report, never crash the loop
            log.warning('home assistant call failed: %s', err)
            reply.update(ok=False, error='home assistant error')
    await ws.send(json.dumps(reply))


async def skin_loop():
    """Stay connected to sbl.cx; answer calls."""
    global skin
    backoff = 1
    while True:
        try:
            async with websockets.connect(
                SKIN_URL, additional_headers={'Authorization': f'Bearer {AGENT_TOKEN}'},
            ) as ws:
                skin = ws
                backoff = 1
                await asyncio.to_thread(read_states)
                await push(ws, 'hello')
                log.info('connected to %s', SKIN_URL)
                try:
                    async for raw in ws:
                        if raw == 'pong':
                            continue
                        try:
                            msg = json.loads(raw)
                        except ValueError:
                            continue
                        if msg.get('type') == 'call':
                            # Not awaited: a burst of taps must not queue
                            # behind one another here. Order per lamp is
                            # kept by the lock in handle_call.
                            task = asyncio.create_task(handle_call(ws, msg))
                            tasks.add(task)
                            task.add_done_callback(tasks.discard)
                finally:
                    skin = None
        except Exception as err:  # noqa: BLE001
            log.warning('sbl.cx socket: %s; retry in %ss', err, backoff)
        await asyncio.sleep(backoff)
        backoff = min(backoff * 2, 60)


async def ha_loop():
    """Follow the lamps in Home Assistant; push changes up as they happen."""
    backoff = 1
    while True:
        try:
            async with websockets.connect(HA_WS) as ws:
                await ws.recv()  # auth_required
                await ws.send(json.dumps({'type': 'auth', 'access_token': HA_TOKEN}))
                hello = json.loads(await ws.recv())
                if hello.get('type') != 'auth_ok':
                    raise RuntimeError(f'home assistant auth: {hello.get("type")}')
                await ws.send(json.dumps({'id': 1, 'type': 'subscribe_events', 'event_type': 'state_changed'}))
                backoff = 1
                log.info('subscribed to home assistant at %s', HA_URL)
                async for raw in ws:
                    msg = json.loads(raw)
                    if msg.get('type') != 'event':
                        continue
                    data = msg['event']['data']
                    entity = data.get('entity_id')
                    if entity in ALLOWED and data.get('new_state'):
                        states[entity] = data['new_state']['state']
                        if skin is not None:
                            await push(skin, 'state')
        except Exception as err:  # noqa: BLE001
            log.warning('home assistant socket: %s; retry in %ss', err, backoff)
        await asyncio.sleep(backoff)
        backoff = min(backoff * 2, 60)


async def main():
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    await asyncio.gather(skin_loop(), ha_loop())


if __name__ == '__main__':
    asyncio.run(main())
