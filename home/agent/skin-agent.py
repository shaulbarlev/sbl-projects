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
import html
import http.server
import json
import logging
import os
import threading
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
# The ledger as a page, for the iframe card on the Advanced controls
# dashboard. LAN only: this CT is not port-forwarded, and the page carries no
# address or user-agent even so -- a dashboard on a wall is a different
# exposure from a 0600 file.
LEDGER_PORT = int(os.environ.get('LEDGER_PORT', '8099'))

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
           ('name', 'dismissed', 'browser', 'visit', 'taps', 'seconds', 'ip', 'ua', 'lang', 'geo')}
    row['at'] = time.strftime('%Y-%m-%dT%H:%M:%S%z')
    # Other people's addresses live in here: 0600, not the 0644 that open()
    # would give it.
    fd = os.open(LEDGER, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
    os.fchmod(fd, 0o600)  # the mode above applies only on creation
    with os.fdopen(fd, 'a') as f:
        f.write(json.dumps(row) + '\n')
    log.info('player: %s (%s taps, %ss, %s)', row['name'] or '—', row['taps'], row['seconds'], row['geo'])


def ledger_rows(limit=100):
    """The newest records first, skipping anything unparseable. A visit that
    was recorded nameless and then named shows once, as the named row; the
    file keeps both lines."""
    rows = []
    try:
        with open(LEDGER) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rows.append(json.loads(line))
                except ValueError:
                    continue
    except FileNotFoundError:
        return []
    latest = {}
    for i, r in enumerate(rows):
        if r.get('visit'):
            latest[r['visit']] = i
    rows = [r for i, r in enumerate(rows) if not r.get('visit') or latest[r['visit']] == i]
    return rows[::-1][:limit]


def render_ledger():
    """One table, Home Assistant's own dark colours, refreshing itself."""
    rows = ledger_rows()
    body = []
    for r in rows:
        when = str(r.get('at', ''))[:19].replace('T', ' ')
        # "IL / Tel Aviv / Some Network Ltd" -> "Tel Aviv, IL": the network
        # name is noise on a dashboard.
        parts = [p.strip() for p in str(r.get('geo') or '').split('/')]
        where = ', '.join([p for p in reversed(parts[:2]) if p])
        body.append(
            '<tr><td class="t">{}</td><td class="n">{}</td><td>{}</td>'
            '<td class="r">{}</td><td class="r">{}s</td></tr>'.format(
                html.escape(when), html.escape(str(r.get('name') or '—')),
                html.escape(where), r.get('taps', 0), r.get('seconds', 0)))
    return """<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="20">
<title>Who played</title><style>
 :root { color-scheme: dark; }
 body { margin: 0; padding: 12px; background: #111417; color: #e1e1e1;
        font: 14px/1.45 -apple-system, "Segoe UI", Roboto, sans-serif; }
 table { width: 100%; border-collapse: collapse; }
 th { text-align: left; font-weight: 500; font-size: 12px; letter-spacing: .04em;
      text-transform: uppercase; color: #9b9b9b; padding: 0 8px 6px; }
 td { padding: 7px 8px; border-top: 1px solid #23282d; vertical-align: baseline; }
 tr:hover td { background: #191d21; }
 .t { color: #9b9b9b; white-space: nowrap; font-variant-numeric: tabular-nums; }
 .n { font-weight: 600; }
 .r { text-align: right; font-variant-numeric: tabular-nums; }
 .none { color: #9b9b9b; padding: 16px 8px; }
</style></head><body>
""" + ("<table><thead><tr><th>When</th><th>Who</th><th>Where</th><th>Taps</th><th>For</th></tr></thead><tbody>"
       + "".join(body) + "</tbody></table>"
       if body else '<div class="none">Nobody has played yet.</div>') + "</body></html>"


class LedgerHandler(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def do_GET(self):  # noqa: N802 - the stdlib spells it this way
        if self.path.split('?')[0] not in ('/', '/index.html'):
            self.send_error(404)
            return
        page = render_ledger().encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(page)))
        self.send_header('Cache-Control', 'no-store')
        # Deliberately no X-Frame-Options: Home Assistant is a different
        # origin and SAMEORIGIN would blank the card. There is nothing to
        # click on this page and nothing it can act on, so framing it costs
        # nothing; what protects it is being on the LAN only.
        self.end_headers()
        self.wfile.write(page)

    def log_message(self, *args):
        pass  # a page that refreshes every 20 s would fill the journal


def serve_ledger():
    """A page on the LAN, in its own thread, never touching the event loop."""
    try:
        http.server.ThreadingHTTPServer(('', LEDGER_PORT), LedgerHandler).serve_forever()
    except Exception as err:  # noqa: BLE001
        log.warning('ledger page not served: %s', err)


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
    threading.Thread(target=serve_ledger, daemon=True).start()
    log.info('ledger page on :%s', LEDGER_PORT)
    asyncio.run(skin_loop())
