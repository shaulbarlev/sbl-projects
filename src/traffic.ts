import { h } from './dom'

/**
 * The traffic light at home, drawn on the map: two lamps and, while its own switch is on,
 * the party button under them. Each is a real switch in my apartment, reached through the
 * QR Worker (qr/docs/traffic-light.md), which serves this site too. Its socket pushes state as it changes and
 * takes taps; it is open only while the light is near the view, as each open one keeps the
 * Worker's object awake. Taps are clicks, so the map's own drag check tells them apart.
 */
// Same origin in production: the QR Worker that serves the site answers /traffic/* on every host.
const ORIGIN = import.meta.env.DEV ? 'https://shaulb.com' : location.origin
/** Whether the light exists right now (its master switch), what is lit, and whether home is reachable */
export const STATE_URL = `${ORIGIN}/traffic/state`
/** Top to bottom. The Worker and the agent at home allow these entities and no others. */
export const LAMPS = [
  { entity: 'switch.traffic_green', label: 'Green', color: '#22c55e' },
  { entity: 'switch.traffic_orange', label: 'Orange', color: '#f59e0b' },
]
const PARTY = 'input_boolean.party'

/** While a tap is this recent, a pushed state that disagrees is an earlier tap still landing, not the truth */
const SETTLE_MS = 1500
/** Out of view this long, the socket closes */
const LINGER_MS = 20_000

type Home = { type?: string; enabled?: boolean; online?: boolean; party?: boolean; states?: Record<string, string>; error?: string }

export function createLight(opts: {
  /** Every change of what is lit, in LAMPS order */
  onLamps: (lamps: { color: string; on: boolean }[]) => void
  /** The master switch, as the socket hears it flip */
  onEnabled: (on: boolean) => void
  /** Each tap that reached a lamp */
  onTap: () => void
}) {
  const lamps = LAMPS.map((l) =>
    h('button', { class: 'lamp', type: 'button', style: `--c:${l.color}`, 'aria-label': `${l.label} light`, 'aria-pressed': 'false', disabled: true }),
  )
  const party = h('button', { class: 'lamp party', type: 'button', 'aria-label': 'Party', 'aria-pressed': 'false', disabled: true }, h('span', { class: 'ball' }))
  const partyBox = h('div', { class: 'housing party-box', hidden: true }, party)
  const field = h('input', {
    type: 'text', name: 'name', autocomplete: 'name', autocapitalize: 'words', autocorrect: 'off', spellcheck: 'false',
    maxlength: 40, placeholder: "what's your name?", 'aria-label': 'Your name', enterkeyhint: 'send',
  })
  const form = h('form', { class: 'who', hidden: true }, field, h('button', { type: 'submit', 'aria-label': 'Send' }, '→'))
  const el = h('div', { class: 'tile island light' }, h('div', { class: 'housing' }, ...lamps), h('div', { class: 'below' }, partyBox, form))

  const entities = [...LAMPS.map((l) => l.entity), PARTY]
  const buttons = [...lamps, party]
  const wanted: Record<string, { state: string; at: number }> = {}
  const report = () => opts.onLamps(LAMPS.map((l, i) => ({ color: l.color, on: lamps[i].getAttribute('aria-pressed') === 'true' })))

  function paint(data: Home) {
    if (data.enabled !== undefined && data.type === 'state') opts.onEnabled(data.enabled)
    if (data.party !== undefined) {
      partyBox.hidden = !data.party
      if (data.party && !party.querySelector('i')) buildBall(party.firstElementChild as HTMLElement)
    }
    if (!data.states) return
    entities.forEach((entity, i) => {
      const state = data.states![entity]
      const want = wanted[entity]
      if (!(want && performance.now() - want.at < SETTLE_MS && state !== want.state)) buttons[i].setAttribute('aria-pressed', String(state === 'on'))
      buttons[i].disabled = !data.online
    })
    glow()
    report()
  }

  // --- the socket, open while the light is near the view
  let ws: WebSocket | null = null
  let wanting = false
  let backoff = 1000
  let poller: ReturnType<typeof setInterval> | undefined
  let linger: ReturnType<typeof setTimeout> | undefined
  const open = () => ws?.readyState === WebSocket.OPEN
  const refresh = () =>
    fetch(STATE_URL, { cache: 'no-store' })
      .then((r) => r.json() as Promise<Home>)
      .then((d) => paint({ ...d, type: 'state' }))
      .catch(() => buttons.forEach((b) => (b.disabled = true)))

  function connect() {
    if (ws || !wanting) return
    const sock = (ws = new WebSocket(`${ORIGIN.replace(/^http/, 'ws')}/traffic/ws`))
    sock.onopen = () => {
      backoff = 1000
      clearInterval(poller)
      poller = undefined
      flush()
    }
    sock.onmessage = (e) => {
      if (e.data === 'pong') return
      try {
        const data = JSON.parse(e.data) as Home
        // A tap's own result says nothing about state: the push from home that follows does.
        if (data.type === 'state' || data.error) paint(data)
      } catch {
        // not ours
      }
    }
    sock.onclose = () => {
      if (ws !== sock) return
      ws = null
      if (!wanting) return
      // Refused (the light switched off, or too many open): ask over HTTP meanwhile.
      if (!poller) {
        void refresh()
        poller = setInterval(refresh, 3000)
      }
      setTimeout(connect, backoff)
      backoff = Math.min(backoff * 2, 15000)
    }
  }
  function disconnect() {
    wanting = false
    clearInterval(poller)
    poller = undefined
    const sock = ws
    ws = null
    sock?.close()
  }
  const send = (msg: object | string) => open() && ws!.send(typeof msg === 'string' ? msg : JSON.stringify(msg))
  // Keeps the object awake while someone is looking, so a tap never pays a wake-up.
  setInterval(() => send({ type: 'warm' }), 5000)
  setInterval(() => send('ping'), 25000)
  document.addEventListener('visibilitychange', () => !document.hidden && send('ping'))

  new IntersectionObserver(
    ([entry]) => {
      clearTimeout(linger)
      if (entry.isIntersecting) {
        wanting = true
        connect()
        // Hidden is switched off, not out of view: it keeps listening, to hear it is back on.
      } else if (!el.hidden) linger = setTimeout(disconnect, LINGER_MS)
    },
    { rootMargin: '50%' },
  ).observe(el)

  // --- taps
  buttons.forEach((b, i) =>
    b.addEventListener('click', () => {
      if (b.disabled) return
      if (!player.tap()) return
      const entity = entities[i]
      const next = b.getAttribute('aria-pressed') === 'true' ? 'off' : 'on'
      // Optimistic: it flips now, and the tap names the state it wants rather than "toggle",
      // so a burst lands exactly as tapped.
      b.setAttribute('aria-pressed', String(next === 'on'))
      wanted[entity] = { state: next, at: performance.now() }
      navigator.vibrate?.(10)
      if (open()) send({ type: 'set', entity, state: next })
      // No socket: the same tap over HTTP; its answer carries the real state.
      else
        fetch(`${ORIGIN}/traffic/toggle`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-skin-request': '1' }, body: JSON.stringify({ entity, state: next }) })
          .then((r) => r.json() as Promise<Home>)
          .then((d) => d.error && paint(d))
          .catch(() => {})
      glow()
      report()
      opts.onTap()
    }),
  )

  // --- the party button: a dim magenta lamp off; on, a turning mirror ball whose glow jumps hue
  let hue: ReturnType<typeof setInterval> | undefined
  function glow() {
    const on = party.getAttribute('aria-pressed') === 'true'
    if (on && !hue) hue = setInterval(() => party.style.setProperty('--gc', `hsl(${Math.random() * 360} 100% 65%)`), 150)
    else if (!on && hue) {
      clearInterval(hue)
      hue = undefined
      party.style.removeProperty('--gc')
    }
  }

  // --- who is playing
  const player = whoIsPlaying(form, field, el, (msg) => {
    pendingPlayer = msg
    flush()
  })
  let pendingPlayer: object | null = null
  // A record made while the socket is down waits for it to open.
  function flush() {
    if (pendingPlayer && open()) {
      send(pendingPlayer)
      pendingPlayer = null
    }
  }

  return { el }
}

/** Tiles on a sphere, turned by CSS; built once, the first time the button shows */
function buildBall(ball: HTMLElement) {
  const r = 50
  const tile = 7
  const step = Math.PI / 20
  const rnd = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1))
  ball.append(h('b'))
  for (let t = 0.001; t < Math.PI; t += step) {
    const z = r * Math.cos(t)
    const ring = Math.abs(Math.sin(t)) * r * 0.8
    const fit = Math.max(1, Math.floor((2 * Math.PI * ring) / tile))
    for (let k = 0; k < fit; k++) {
      const a = ((k + 0.5) * 2 * Math.PI) / fit
      const c = t > 1.3 && t < 1.9 ? rnd(130, 255) : rnd(100, 180)
      const x = r * Math.cos(a) * Math.sin(t)
      const y = r * Math.sin(a) * Math.sin(t)
      ball.append(
        h('i', {
          style: `--x:${x.toFixed(1)}cqw;--y:${y.toFixed(1)}cqw;--z:${z.toFixed(1)}cqw;--a:${a.toFixed(3)}rad;--t:${t.toFixed(3)}rad;--k:${rnd(2, 15) / 10};--grey:rgb(${c} ${c} ${c + 4});animation-delay:${rnd(0, 20) / 10}s`,
        }),
      )
    }
  }
}

/**
 * Somebody who taps has no idea whose light it is, and it says nothing. Two seconds of
 * continuous play (taps under two seconds apart) and a name is asked for: the field comes up
 * under the light and the lamps are held until one is sent. A returning player who never gave
 * one is asked at their first tap. A name is reused without asking while this browser keeps
 * coming back; a week away brings the question back, prefilled. Each visit that plays is
 * recorded once at its first pause, and again if a name is given later.
 *
 * `tap` answers whether the tap may go through to the lamp.
 */
function whoIsPlaying(form: HTMLFormElement, field: HTMLInputElement, el: HTMLElement, record: (msg: object) => void) {
  const KEY = 'skin.player'
  const WEEK = 604_800_000
  const PAUSE = 2000
  const PLAY = 2000
  const id = () => Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  let me: { id?: string; name?: string; dismissed?: boolean; plays?: number; seen?: number; at?: number } = {}
  try {
    me = JSON.parse(localStorage.getItem(KEY) || '{}') || {}
  } catch {
    // private window: a stranger every time
  }
  const visit = id()
  const opened = performance.now()
  const away = Date.now() - (me.seen || me.at || 0)
  let askOnTap = (me.plays || 0) > 0 && !me.name
  let taps = 0
  let burst = 0
  let since = 0
  let idle: ReturnType<typeof setTimeout> | undefined
  let asked = false
  let gated = false
  let logged = false
  let counted = false

  function remember(patch: typeof me, touch = false) {
    me = { ...me, ...patch, id: me.id || id() }
    if (touch || !me.at) me.at = Date.now()
    try {
      localStorage.setItem(KEY, JSON.stringify(me))
    } catch {
      // not kept
    }
  }
  function send(name: string) {
    if (!me.id) remember({})
    record({ type: 'player', id: me.id, visit, name, dismissed: false, taps, seconds: Math.round((performance.now() - opened) / 1000) })
  }
  function count() {
    if (counted) return
    counted = true
    remember({ plays: (me.plays || 0) + 1, seen: Date.now() })
  }
  function gate(on: boolean) {
    gated = on
    el.classList.toggle('gated', on)
    form.hidden = !on
    if (on) field.focus({ preventScroll: true })
  }
  function ask() {
    if (asked) return
    asked = true
    const fresh = away < WEEK
    if (fresh && (me.dismissed || me.name)) return
    field.value = me.name || ''
    gate(true)
  }
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    const name = field.value.trim()
    if (!name) return
    remember({ name, dismissed: false }, true)
    logged = true
    send(name)
    field.blur()
    gate(false)
  })

  return {
    tap(): boolean {
      if (gated) {
        field.focus({ preventScroll: true })
        return false
      }
      if (askOnTap) {
        askOnTap = false
        asked = true
        gate(true)
        return false
      }
      const now = performance.now()
      if (!burst) since = now
      taps++
      burst++
      clearTimeout(idle)
      idle = setTimeout(() => {
        if (burst >= 2) count()
        burst = 0
        if (!logged) {
          logged = true
          send(me.name && away < WEEK ? me.name : '')
        }
      }, PAUSE)
      if (burst >= 2 && now - since >= PLAY) {
        count()
        ask()
      }
      return !gated
    },
  }
}
