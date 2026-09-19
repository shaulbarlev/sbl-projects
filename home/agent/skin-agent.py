#!/usr/bin/env python3
"""The home end of the traffic light.

Keeps one WebSocket open to the Durable Object at sbl.cx. When a tap arrives
it posts to a Home Assistant webhook on the LAN, whose automation is the only
thing that touches the switches. Lamp state flows the other way without this
agent: a second automation posts every change straight to sbl.cx, and a
report webhook makes it post the current state on request.

This agent holds no Home Assistant credential. Its blast radius, if the
Worker were ever compromised, is two webhook ids that can set two switches
and one party toggle on or off, and nothing else.

Configuration comes from the environment (see skin-agent.service):
  SKIN_URL        wss://sbl.cx/_/agent
  AGENT_TOKEN     the bearer the Worker expects
  HA_URL          http://192.168.50.232:8123
  WEBHOOK_SET     id of the webhook that sets a lamp: {"entity", "state"}
  WEBHOOK_REPORT  id of the webhook that makes Home Assistant report state
  WEBHOOK_SWITCH  id of the webhook that mirrors the page's switches into Home Assistant:
                  {"switch": "traffic"|"party", "on"}
"""
import asyncio
import json
import logging
import os
import time
import urllib.request

import websockets

ALLOWED = {'switch.tasmota', 'switch.traffic_1_power1', 'input_boolean.party'}
SERVICES = {'turn_on': 'on', 'turn_off': 'off'}

SKIN_URL = os.environ['SKIN_URL']
AGENT_TOKEN = os.environ['AGENT_TOKEN']
HA_URL = os.environ['HA_URL'].rstrip('/')
WEBHOOK_SET = os.environ['WEBHOOK_SET']
WEBHOOK_REPORT = os.environ['WEBHOOK_REPORT']
WEBHOOK_SWITCH = os.environ['WEBHOOK_SWITCH']
# The guest book. StateDirectory=skin-agent in the unit makes this writable
# under DynamicUser and ProtectSystem=strict; $STATE_DIRECTORY is where
# systemd says it landed.
LEDGER = os.path.join(os.environ.get('STATE_DIRECTORY', '/var/lib/skin-agent'), 'players.jsonl')
# A guest book that cannot fill the disk the agent runs on. Fifty megabytes
# is roughly 80,000 visits; past it, records are refused rather than written.
LEDGER_MAX = 50 * 1024 * 1024

log = logging.getLogger('skin-agent')
locks = {}      # entity -> asyncio.Lock: calls land in order per lamp, lamps in parallel
tasks = set()   # in-flight calls; a task with no reference can be collected mid-run


def webhook(webhook_id, body=None):
    """POST to a Home Assistant webhook. No auth: the id is the secret, and
    the webhooks are local_only, so only this LAN can reach them at all."""
    req = urllib.request.Request(
        f'{HA_URL}/api/webhook/{webhook_id}', method='POST',
        data=json.dumps(body or {}).encode(), headers={'Content-Type': 'application/json'})
    # Under the Worker's 4 s wait, so a slow device reads as failed here and
    # there alike, never as failed to the scanner while it still flips.
    with urllib.request.urlopen(req, timeout=3) as r:
        return r.status


async def handle_call(ws, msg):
    entity, service = msg.get('entity'), msg.get('service')
    reply = {'type': 'reply', 'id': msg.get('id')}
    if entity not in ALLOWED or service not in SERVICES:
        log.warning('refused %s %s', service, entity)
        reply.update(ok=False, error='not allowed')
        await ws.send(json.dumps(reply))
        return
    # No rate guard here by choice: every tap lands. The lock only keeps one
    # lamp's calls in order.
    async with locks.setdefault(entity, asyncio.Lock()):
        try:
            started = time.monotonic()
            await asyncio.to_thread(webhook, WEBHOOK_SET, {'entity': entity, 'state': SERVICES[service]})
            reply.update(ok=True, haMs=round((time.monotonic() - started) * 1000))
            log.info('%s %s (%sms)', service, entity, reply['haMs'])
        except Exception as err:  # noqa: BLE001 - report, never crash the loop
            log.warning('home assistant webhook failed: %s', err)
            reply.update(ok=False, error='home assistant error')
    await ws.send(json.dumps(reply))


async def mirror_switch(name, on):
    """The page has two switches, the master one and the party button's; the
    automation behind the webhook branches on the name."""
    try:
        await asyncio.to_thread(webhook, WEBHOOK_SWITCH, {'switch': name, 'on': bool(on)})
        log.info('%s switch mirrored: %s', name, 'on' if on else 'off')
    except Exception as err:  # noqa: BLE001
        log.warning('switch webhook failed: %s', err)


def record_player(msg):
    """Append one visit to the ledger. A line per record, opened in append
    mode for each write, so a crash costs at most the line being written and
    `tail -f` shows visits as they happen. Nothing here reaches Home
    Assistant: this is a guest book, not a control path.

    Three things this file has to survive, all of them reachable by a
    stranger with a browser:
      * growth — the object at sbl.cx allows one record per page, but a
        reconnect loop can still write, so the file is capped and the cap is
        the real backstop. This disk also holds the agent itself.
      * unpaired surrogates — a name like "Yo\\ud800ssi" is valid to
        JavaScript and to json.loads, and raises on a utf-8 write. With
        ensure_ascii the escape is kept as text and nothing raises.
      * U+2028, U+2029 and NEL — raw, they split one record into three for
        anything reading with splitlines(). ensure_ascii escapes those too,
        which is why it is left at its default here rather than turned off
        for prettier Hebrew. Read the file with `jq` and names render fine.
    """
    if os.path.exists(LEDGER) and os.path.getsize(LEDGER) > LEDGER_MAX:
        log.warning('ledger at %s bytes: refusing to grow it', LEDGER_MAX)
        return
    row = {k: msg.get(k) for k in
           ('name', 'dismissed', 'browser', 'taps', 'seconds', 'ip', 'ua', 'lang', 'geo')}
    row['at'] = time.strftime('%Y-%m-%dT%H:%M:%S%z')
    # Other people's addresses live in here: 0600, not the 0644 that open()
    # would give it.
    fd = os.open(LEDGER, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
    with os.fdopen(fd, 'a') as f:
        f.write(json.dumps(row) + '\n')
    log.info('player: %s (%s taps, %ss, %s)', row['name'] or '—', row['taps'], row['seconds'], row['geo'])


async def write_player(msg):
    """The ledger write, off the event loop and unable to kill it."""
    try:
        await asyncio.to_thread(record_player, msg)
    except Exception as err:  # noqa: BLE001
        log.warning('ledger write failed: %s', err)


async def skin_loop():
    """Stay connected to sbl.cx; answer calls."""
    backoff = 1
    while True:
        try:
            async with websockets.connect(
                SKIN_URL, additional_headers={'Authorization': f'Bearer {AGENT_TOKEN}'},
            ) as ws:
                backoff = 1
                await ws.send(json.dumps({'type': 'hello'}))
                log.info('connected to %s', SKIN_URL)
                # Ask Home Assistant to post the current lamp states up, so a
                # fresh object or a long outage starts from the truth.
                try:
                    await asyncio.to_thread(webhook, WEBHOOK_REPORT)
                except Exception as err:  # noqa: BLE001
                    log.warning('report webhook failed: %s', err)
                async for raw in ws:
                    if raw == 'pong':
                        continue
                    try:
                        msg = json.loads(raw)
                    except ValueError:
                        continue
                    if msg.get('type') == 'switch':
                        # A switch changed on sbl.cx (or this is the resync
                        # on connect): mirror it into Home Assistant.
                        name = msg.get('name') if msg.get('name') == 'party' else 'traffic'
                        task = asyncio.create_task(mirror_switch(name, msg.get('on')))
                        tasks.add(task)
                        task.add_done_callback(tasks.discard)
                        continue
                    if msg.get('type') == 'player':
                        # Somebody who played gave a name or waved the prompt
                        # away. Written here and nowhere else — and not
                        # awaited, so a disk that is slow or full can never
                        # queue in front of somebody's tap.
                        task = asyncio.create_task(write_player(msg))
                        tasks.add(task)
                        task.add_done_callback(tasks.discard)
                        continue
                    if msg.get('type') == 'call':
                        # Not awaited: a burst of taps must not queue behind
                        # one another here. Order per lamp is kept by the
                        # lock in handle_call.
                        task = asyncio.create_task(handle_call(ws, msg))
                        tasks.add(task)
                        task.add_done_callback(tasks.discard)
        except Exception as err:  # noqa: BLE001
            log.warning('sbl.cx socket: %s; retry in %ss', err, backoff)
        await asyncio.sleep(backoff)
        backoff = min(backoff * 2, 60)


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    asyncio.run(skin_loop())
