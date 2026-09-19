# home

The house end of the traffic light: what runs at home so that a phone
scanning the printed QR can flip two switches, with nothing here listening on
the internet and no Home Assistant credential anywhere in the path. The Worker
side is the rest of this repo; the whole design and a tap step by step are in
[`../docs/traffic-light.md`](../docs/traffic-light.md).

```
phone ──wss──▶ Worker ──▶ Durable Object ◀──wss── agent (LXC 300) ──webhook──▶ Home Assistant ──mqtt──▶ relays
                                 ▲                         │                          │
                                 │                         └── players.jsonl          │
                                 └──────── rest_command, on every change ──────────────┘
```

## What is where

| piece | path here | lives at |
| --- | --- | --- |
| the agent | `agent/skin-agent.py` | `/opt/skin-agent/skin-agent.py` in Proxmox LXC 300 |
| its unit | `agent/skin-agent.service` | `/etc/systemd/system/skin-agent.service` |
| its env | `agent/skin-agent.env.example` | `/etc/skin-agent.env`, mode 600, written by hand |
| the player ledger | — | `/var/lib/skin-agent/players.jsonl`, written by the agent, read by you |
| set-a-lamp automation | `homeassistant/automations/set-a-lamp.yaml` | Home Assistant, created via the config API |
| report automation | `homeassistant/automations/report-lamp-state.yaml` | Home Assistant, same |
| state push and master switch push | `homeassistant/rest_command.yaml` | appended to `/config/configuration.yaml` |
| master-switch mirror | `homeassistant/automations/master-switch-*.yaml` | Home Assistant, plus the helper `input_boolean.sbl_cx_traffic_light` and the "Advanced controls" dashboard |
| its bearer | `homeassistant/secrets.example.yaml` | `/config/secrets.yaml` |

Secrets are not in this repo: the real webhook ids are in the live
automations and the agent's env; the bearer is the Worker's `AGENT_TOKEN`.

## Install or update the agent

```sh
SSHPASS='<proxmox root password>' ./install.sh          # host 192.168.50.90, CT 300
```

It copies the script and unit in, installs `python3-websockets`, enables and
restarts the service, and prints the last log lines. The env file is written
once by hand from the example. The service runs as a systemd dynamic user
under a read-only system with no capabilities; there is deliberately no
syscall filter, Python under the LXC dies with SIGSYS under one.
`StateDirectory=skin-agent` is what gives that dynamic user somewhere to write
the ledger.

## The ledger

One JSON object per line, appended when somebody answers the name prompt:

```json
{"name":"Yossi","dismissed":false,"browser":"k3f…","taps":11,"seconds":48,
 "ip":"203.0.113.7","ua":"Mozilla/5.0 (iPhone…)","lang":"he-IL","geo":"IL / Tel Aviv / Bezeq","at":"2026-09-19T12:04:22+0300"}
```

### On the dashboard

The agent also serves the ledger as a page on the LAN, `http://192.168.50.171:8099/`,
which the **Advanced controls** dashboard embeds in an `iframe` card under
"Who played". It refreshes itself every 20 seconds, newest first, and shows
time, name, city, taps and seconds — **no address and no user-agent**: a
dashboard on a wall is a different exposure from a 0600 file. Port from
`LEDGER_PORT`, nothing else is served, and there is deliberately no
`X-Frame-Options` because Home Assistant is a different origin and
`SAMEORIGIN` would blank the card.

Read the raw file with `ssh serv "pct exec 300 -- tail /var/lib/skin-agent/players.jsonl"`,
or `jq .` for names in Hebrew, which are written as `\uXXXX` escapes on
purpose: raw U+2028 or a lone surrogate in a name would split or break a
record for whatever reads the file next.

**Only two columns are attested.** `ip` and `geo` come from Cloudflare. The
name, the browser id, the tap count, the seconds, the user-agent and the
language are all sent by the page, which means a stranger with a console can
put anything there, including somebody else's name and browser id. Read the
file as a guest book, not as evidence.

A dismissal is recorded with no `ip`, `ua` or `lang`: it is counted without
buying a record of who refused.

The file is `0600` inside a `0700` directory, and it stops accepting records
at 50 MB (roughly 80,000 visits) rather than filling the disk the agent runs
on. Nothing rotates it. It holds other people's addresses — treat it
accordingly.

## Home Assistant, once

1. Create the helper `input_boolean.sbl_cx_traffic_light` (a Toggle helper
   named "sbl.cx traffic light"), then the four automations from the YAML here,
   filling in fresh random webhook ids (`openssl rand -hex 16`), and put the
   same ids in the agent's env.
2. Append `rest_command.yaml` to `configuration.yaml` and the secret to
   `secrets.yaml`. A new YAML integration loads only on a Core restart;
   `reload_all` does not pick it up.
3. Restart Core, then `rest_command.skin_state` exists and the report
   automation works.

## Undo

Disable or delete the automations, remove the `rest_command:` block and the
secret, restart Core, and in the LXC:

```sh
systemctl disable --now skin-agent
rm -rf /opt/skin-agent /etc/systemd/system/skin-agent.service /etc/skin-agent.env /var/lib/skin-agent
apt-get remove python3-websockets
```
