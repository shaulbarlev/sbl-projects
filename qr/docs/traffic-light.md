# The sbl.cx traffic light — how it is built and how a tap flows

Written 14 September 2026. Everything here is deployed. Code in
`~/playground/skin`, branch `send-gifs-sticky`.

## What it is

A page at `https://sbl.cx/traffic`: a vector traffic light, green over orange,
no words. Each lamp is a real switch in your house. Tapping a lamp flips it.
The page can also take over the root of the QR code, so a scan lands on the
lamps instead of a redirect. A switch in the panel's Home card turns the whole
thing on or off.

Nothing in your house listens on the internet. A small agent on the home
network dials out and holds one connection open; everything flows over that.

## The pieces

```
phone ──wss──▶ Worker (Tel Aviv) ──▶ Durable Object (Europe) ◀──wss── agent (LXC 300) ──http──▶ Home Assistant ──mqtt──▶ Tasmota relays
                                            │                             ▲
                                            └──────── state pushes ───────┘
```

| piece | where | role |
| --- | --- | --- |
| Worker | Cloudflare edge, the colo nearest the phone | serves the page, routes taps, checks the allowlist |
| Durable Object | one Cloudflare data center in Europe | the one stateful thing: holds the agent's socket and every open page's socket, caches lamp states, enforces the master switch and the daily ceiling |
| Home agent `skin-agent` | Proxmox `serv` → LXC 300 "connection", 192.168.50.171 | Python service; dials out to the object; posts taps to a local-only Home Assistant webhook; hard allowlist of the two switches; holds no Home Assistant credential |
| Home Assistant | HAOS, 192.168.50.232 | owns the switches; drives the Tasmotas over MQTT; two automations and one `rest_command` for the traffic light |
| Lamps | `src/traffic.ts` | green on top is `switch.traffic_1_power1`, orange below is `switch.tasmota` |

Secrets: `AGENT_TOKEN` on the Worker, in `/etc/skin-agent.env` at home, and
in Home Assistant's `secrets.yaml` for the state report; two webhook ids in
the agent's env. No Home Assistant long-lived token exists for this any more.

## Setup, once

1. The agent starts, reads its env file, and opens one WebSocket to
   `wss://sbl.cx/_/agent` with `Authorization: Bearer AGENT_TOKEN`.
2. The Worker checks the token in constant time and hands the connection to the
   Durable Object, which accepts it with Cloudflare's hibernation API and tags
   it `agent`. An idle connection costs nothing; the object sleeps and wakes
   with the socket still attached.
3. The agent posts to the report webhook. Home Assistant's "report lamp state"
   automation runs its `rest_command`, which posts both switches' state to
   `/_/agent/state` on the Worker with the same bearer token. The object
   stores it. From now on the panel's Home card shows "Home online" and the
   lamp states.

In Home Assistant, three things exist for this, all added 14 September 2026:
the automation "sbl.cx traffic light: set a lamp" (webhook trigger, local
only, four branches with the entity ids hardcoded), the automation "sbl.cx
traffic light: report lamp state" (state trigger on both switches plus the
report webhook), and `rest_command.skin_state` in `configuration.yaml` with
its bearer in `secrets.yaml`. Backups of both files sit beside them with a
`.bak-` suffix.

If the connection drops, the agent reconnects with backoff (1 s doubling to
60 s). A reconnect replaces the old socket in the object.

## Opening the page

1. Phone loads `/traffic` (or the root, when the traffic light has been sent
   as a destination). The Worker asks the object one question, "is the master
   switch on", and if so serves the inlined page: two `<button>` lamps, CSS,
   and a small script. No fonts, no external files.
2. The script opens a WebSocket to `/traffic/ws`. The Worker hands it straight
   to the object, which refuses if the switch is off, caps open pages at
   twenty, tags the socket `page`, and immediately sends
   `{state, online, states}`. The lamps light up to match.
3. Every 5 s the page sends `{warm}` so the object stays resident while
   someone is looking; every 25 s it sends `ping`, which the object answers
   without waking.
4. If the socket cannot be opened, the page falls back to `GET /traffic/state`
   every 3 s and `POST /traffic/toggle` for taps.

## A tap, step by step

1. **Finger down.** The handler is on `pointerdown`, not `click`, because a
   touch click waits for the finger to lift, 50 to 100 ms of nothing. The lamp
   flips on screen immediately and the phone ticks (`navigator.vibrate(10)`).
2. **The page names the state it wants.** It sends `{set, entity, state: on|off}`
   rather than "toggle". Two fast toggles could both read the same old state at
   home and land the same way; on then off always lands as on then off. It
   also records what it asked for and when.
3. **The object checks and forwards.** Entity must be one of the two lamps,
   the service one of on/off/toggle, the master switch on, the lamp under its
   daily ceiling of two thousand. Then it sends `{call, id, entity, service}`
   down the agent's socket and keeps a 4 s timer under that id. Calls are not
   serialised: a burst goes down as it arrives, each with its own id.
4. **The agent acts.** It checks its own allowlist, takes a lock for that lamp
   so its calls land in order while the other lamp runs in parallel, and posts
   `{entity, state}` to the local-only setting webhook with a 3 s timeout. The
   automation behind it matches one of four hardcoded branches and calls
   `switch.turn_on` or `switch.turn_off`. Home Assistant publishes the MQTT
   command; the Tasmota switches the relay and reports back over MQTT.
5. **The agent answers with timing only.** `{reply, id, ok, haMs}`. The
   object forwards it to the tapping page as `result`. The page does not repaint
   from it. A Tasmota reports its state after the command is sent, so a state
   here would be stale and flicker the lamp back.
6. **Confirmation by push, from Home Assistant itself.** The Tasmota's report
   changes the switch's state, which triggers the "report lamp state"
   automation; its `rest_command` posts both states to the Worker, the object
   stores them and broadcasts to every open page. That push is the truth.
   While a tap is less than 1.5 s old, the page ignores a push that disagrees
   with what it asked for, since it is an intermediate state from an earlier
   tap still landing; once the finger stops, the truth wins.

The same push path is how a change made from anywhere else, the Home
Assistant app, a wall switch, appears on every open page within about 60 ms.

## What it measures as, from Israel

| step | time |
| --- | --- |
| Worker alone | 60 ms |
| one Worker to object hop | about 60 ms |
| page load to first state | about 150 ms |
| tap to reply | about 180 ms |
| tap to device confirmation pushed | about 200 ms |
| Home Assistant plus relay, inside that | 10 to 80 ms |
| six taps 120 ms apart | all six landed in order, final state correct |

The floor is geography: phone to Tel Aviv, Tel Aviv to the object in Europe,
object to Frankfurt where your home connection lands, then the LAN and the
relay, and the same road back. Tel Aviv hosts no Durable Objects. The object
was recreated with a Middle East location hint and landed in Europe, which is
equivalent because the home leg terminates in Frankfurt either way; before
that move a hop cost 330 ms and a tap 750 ms.

## The master switch

`trafficEnabled` in the app state, flipped from the Home card or
`POST /_/api/traffic {on}`. Off: `/traffic` and its socket are the site's like
any other path (the bare embedded copy stays up, dark), a sent traffic target is skipped like an empty image set so a temp
pointing at it falls through to main, and a traffic step in a sequence is
passed over rather than burned. On: the page is public. That is the point of a
traffic light.

Taking over the root: send "Traffic light" from the Home card or the Shortcut,
as a temp for a duration or as main. The resolver then renders the page in
place of a redirect for as long as that lasts.

## Security, in layers

- **No Home Assistant credential anywhere in this.** The agent knows two
  webhook ids; the webhooks are local-only, so only the LAN can reach them;
  and the setting automation hardcodes the two entities per branch, so the
  payload cannot name anything else. A compromised Worker, Cloudflare account,
  or even the agent box reaches nothing else in the house. The agent's own
  allowlist is a second copy of the same rule.
- **Agent auth.** `AGENT_TOKEN`, 48 random characters, constant-time compare,
  outside the login lockout so bad password guesses cannot hold the light
  offline.
- **Socket tags.** Only the `agent` socket may report state or answer a call;
  a `page` socket may only tap. Binary frames and messages over 4 KB are
  dropped unparsed; pages are capped at twenty.
- **Worker checks.** Entity against the allowlist, the CSRF header on HTTP
  taps, bodies over 256 bytes refused unread.
- **Rate.** No floor between taps, by your choice: every tap lands. The agent
  has no guard either. A ceiling of two thousand per lamp per day in the object
  is what remains against a runaway script.
- **Sandbox at home.** systemd dynamic user, read-only system, no capabilities,
  no home, private tmp and devices. No syscall filter: Python under the LXC
  dies with SIGSYS under one.
- Reviewed twice by a Fable agent, once for security (seven findings, all
  fixed) and once for latency (its ranking drove the object move and the page
  socket).

## Operating it

- **Is it up?** The Home card says "Home online" with both lamp states, or
  "Home agent offline". `curl https://sbl.cx/traffic/state` says the same.
- **The agent.** On `serv` (192.168.50.90): `pct exec 300 -- systemctl status
  skin-agent`, `journalctl -u skin-agent -f`. Script at
  `/opt/skin-agent/skin-agent.py`, unit at
  `/etc/systemd/system/skin-agent.service`, env at `/etc/skin-agent.env`.
  Update by `pct push` of the script and `systemctl restart skin-agent`.
- **Timing a tap.** `POST /traffic/toggle` returns a `Server-Timing` header
  with object, agent and Home Assistant time; the page logs tap-to-state in
  the browser console.
- **Rotate the agent token.** `npx wrangler secret put AGENT_TOKEN`, update the
  env file at home, restart the agent.
- **Cut the agent off from Home Assistant.** Disable the two automations, or
  change the webhook ids in them. There is no token to revoke.
- **Undo the Home Assistant changes entirely.** Delete the two automations,
  remove the `rest_command:` block from `configuration.yaml` and the
  `skin_agent_token` line from `secrets.yaml` (or restore the `.bak-` copies),
  restart Core.
- **Swap or change lamps.** `LIGHTS` in `src/traffic.ts`; the agent's
  `ALLOWED` set must list the same entities.
- **Tests.** `npm test` covers the page, the sockets with a simulated agent,
  bursts in order, the master switch, and the refusals.

## Exactly what is on the homelab

Verified on 14 September 2026, 15:58. Everything was done over SSH as root on
the Proxmox host `serv` (192.168.50.90), and inside the existing LXC 300
"connection" through `pct exec` and `pct push`. No other container, VM, or
host setting was touched; no host package was installed.

Inside CT 300:

| item | what |
| --- | --- |
| `/opt/skin-agent/skin-agent.py` | the agent, 7 KB of Python, root-owned, world-readable |
| `/etc/systemd/system/skin-agent.service` | the unit, enabled, starts at boot |
| `/etc/skin-agent.env` | root-only (600): `SKIN_URL`, `AGENT_TOKEN`, `HA_URL`, `HA_TOKEN` |
| package `python3-websockets` 15.0.1 | installed with apt; the only dependency |
| process `skin-agent.py` | runs as the systemd dynamic user `skin-agent`, not root |
| connections | exactly two, both outbound: 104.21.53.179:443 (Cloudflare, sbl.cx) and 192.168.50.232:8123 (Home Assistant) |

Untouched in CT 300: `webhook.service` (was and is inactive), `tailscaled`
(active), everything else. Two files show recent change dates that are not
mine: `/etc/resolv.conf` in the container, managed by the system, and
`/etc/pve/authkey.pub` on the host, which Proxmox rotates daily.

Home Assistant: one long-lived access token was created through your logged-in
browser session, named "skin-agent (sbl.cx traffic light)", under Profile →
Security. It is the only credential the agent holds for Home Assistant. Both
switches were toggled a number of times during testing and each time returned
to where they were, except when you were testing at the same time.

Cleaned up: a tarball left in `/tmp` on the host, ownership of the two files
(they arrived owned by my Mac's user id), and a `__pycache__` from a compile
check.

## What would make it faster still

- The agent calling the Tasmota's own HTTP interface instead of going through
  Home Assistant: 20 to 40 ms, needs the two devices' LAN addresses.
- A direct phone-to-home channel (WebRTC) would cut the Europe round trip,
  but takes 1 to 3 s to set up and fails behind carrier NAT often enough not
  to be worth it for a page strangers scan.

## The master switch in Home Assistant

Added 15 September 2026. `input_boolean.sbl_cx_traffic_light` in Home
Assistant is a live mirror of the panel's Home card switch, shown on its own
"Advanced controls" dashboard next to the two lamps. Flip it there and the
automation "master switch → sbl.cx" posts it through `rest_command.skin_traffic`
to `/_/agent/traffic` on the Worker, under the same bearer as the state
report. Flip it in the panel or the Shortcut and the object sends `{switch,
on}` down the agent's socket; the agent posts to a third local-only webhook
and the automation "master switch ← sbl.cx" sets the helper. The object sends
that only on a real change, and again once on every agent reconnect, so the
two sides converge and an echo dies in one round. Nothing here takes over the
root of the QR; that stays a deliberate act in the panel or the Shortcut.

## The party button

Added 15 September 2026. Under the light sits a second, smaller housing with
one round button. Off, it is a dim magenta lamp; on, it is a mirror ball that
turns, shimmers, and throws a glow whose hue jumps every 150 ms. It flips
`input_boolean.party` at home, through the same path as a lamp: the page
socket, the object, the agent, the "set a lamp" webhook (two more hardcoded
branches), and back up through the state report. Its ceiling is 100 flips a
day rather than 2000.

The button is on the page only while its own switch is on. That switch lives
in the panel's Home card and, mirrored exactly like the master switch, in
Home Assistant as `input_boolean.sbl_cx_party_button` on the Advanced
controls dashboard: the helper posts through `rest_command.skin_party` to
`/_/agent/party`; the object sends `{switch: "party", on}` down the agent's
socket and the automation "switches ← sbl.cx" sets the helper. Off, the
entity is still known to every allowlist but a tap is refused as if the
light were off, and the page hides the housing.
