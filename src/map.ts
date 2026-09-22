import type { Rect, World } from './layout'

const MIN_ZOOM = 0.4
const MAX_ZOOM = 2
/** Pointer travel (px) before a press counts as a drag rather than a click */
const DRAG_THRESHOLD = 6
/** How much of a drag gets through once the view is past the edge of the world */
const RUBBER = 0.35
/** Grid pitch in world px, and how much slower than the tiles it moves (it reads as further away) */
const GRID = 120
const GRID_DEPTH = 0.85
/** Distance of the edge markers from the edge of the screen */
const MARKER_INSET = 14
/** Sideways pull (px) that breaks the reading lock */
const BREAK = 80

type Camera = { x: number; y: number; z: number }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const centre = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })

/**
 * Pannable, zoomable view onto `plane`, which is `world` px in size.
 * The camera is the world point at the centre of the viewport, plus zoom.
 */
export function createMap(opts: {
  viewport: HTMLElement
  plane: HTMLElement
  minimap: HTMLElement
  readout: HTMLElement
  /** Holds the markers that point at tiles off screen */
  markers: HTMLElement
  world: World
  /** Accessible name for a tile's marker */
  label: (id: string) => string
  /** Called when home scrolls in or out of view */
  onHomeVisible: (visible: boolean) => void
  /** Called with the world rect in view after every move */
  onView?: (view: Rect) => void
  /** Called when a strong sideways pull breaks the reading lock */
  onBreak?: () => void
  /** Called once, the first time the visitor moves the map themselves */
  onExplore: () => void
}) {
  const { viewport, plane, minimap, readout, markers } = opts
  let world = opts.world
  let home = world.origin
  const cam: Camera = { ...home, z: 1 }
  let vw = 0
  let vh = 0
  const seen = new Set<string>()
  // A rect the world is stretched to hold while something (an open card) sticks out of it.
  let reach: Rect | null = null
  const worldW = () => Math.max(world.w, reach ? reach.x + reach.w + 40 : 0)
  const worldH = () => Math.max(world.h, reach ? reach.y + reach.h + 40 : 0)

  // --- animation state: either coasting on velocity, or flying to a target
  let vx = 0
  let vy = 0
  let flight: { from: Camera; to: Camera; t0: number; ms: number } | null = null
  let raf = 0
  let last = 0

  /** The camera pulled back inside the world; where the world is the smaller one, centred on it. */
  function bounded(c: Camera): Camera {
    const z = clamp(c.z, MIN_ZOOM, MAX_ZOOM)
    const halfW = vw / z / 2
    const halfH = vh / z / 2
    const W = worldW()
    const H = worldH()
    return {
      x: W > halfW * 2 ? clamp(c.x, halfW, W - halfW) : W / 2,
      y: H > halfH * 2 ? clamp(c.y, halfH, H - halfH) : H / 2,
      z,
    }
  }

  // --- minimap dots and edge markers, one of each per tile
  const frame = document.createElement('div')
  frame.className = 'mm-view'
  const dots = new Map<string, HTMLElement>()
  const pointersTo = new Map<string, HTMLElement>()

  function drawOverlays() {
    const dot = (r: Rect, cls: string) => {
      const d = document.createElement('div')
      d.className = cls
      d.style.left = `${(r.x / world.w) * 100}%`
      d.style.top = `${(r.y / world.h) * 100}%`
      d.style.width = `${(r.w / world.w) * 100}%`
      d.style.height = `${(r.h / world.h) * 100}%`
      return d
    }
    dots.clear()
    pointersTo.clear()
    for (const t of world.tiles) {
      dots.set(t.id, dot(t, 'mm-tile'))
      const m = document.createElement('button')
      m.type = 'button'
      m.className = 'marker'
      m.tabIndex = -1 // the tiles themselves are the tab stops
      m.setAttribute('aria-label', `Go to ${opts.label(t.id)}`)
      m.addEventListener('click', () => flyTo(centre(t), 600))
      pointersTo.set(t.id, m)
    }
    for (const id of seen) markSeen(id)
    minimap.style.aspectRatio = `${world.w} / ${world.h}`
    minimap.replaceChildren(dot(world.home, 'mm-home'), ...world.links.map((t) => dot(t, 'mm-link')), ...world.islands.map((t) => dot(t, 'mm-island')), ...dots.values(), frame)
    markers.replaceChildren(...pointersTo.values())
  }

  function markSeen(id: string) {
    seen.add(id)
    dots.get(id)?.classList.add('seen')
    pointersTo.get(id)?.classList.add('seen')
  }

  /** `soft` leaves the camera where it is even if that is past the edge (mid-drag, or springing back). */
  function render(soft = false) {
    if (!soft) Object.assign(cam, bounded(cam))
    cam.z = clamp(cam.z, MIN_ZOOM, MAX_ZOOM)
    const tx = vw / 2 - cam.x * cam.z
    const ty = vh / 2 - cam.y * cam.z
    plane.style.transform = `translate(${tx}px, ${ty}px) scale(${cam.z})`
    viewport.style.backgroundSize = `${GRID * cam.z}px ${GRID * cam.z}px`
    viewport.style.backgroundPosition = `${tx * GRID_DEPTH}px ${ty * GRID_DEPTH}px`

    const w = vw / cam.z
    const h = vh / cam.z
    const left = cam.x - w / 2
    const top = cam.y - h / 2
    frame.style.left = `${(left / world.w) * 100}%`
    frame.style.top = `${(top / world.h) * 100}%`
    frame.style.width = `${(w / world.w) * 100}%`
    frame.style.height = `${(h / world.h) * 100}%`
    readout.textContent = `x ${Math.round(cam.x - home.x)}  y ${Math.round(cam.y - home.y)}  ${Math.round(cam.z * 100)}%`

    const inView = (r: Rect) => r.x + r.w > left && r.x < left + w && r.y + r.h > top && r.y < top + h
    opts.onHomeVisible(inView(world.home))
    opts.onView?.({ x: left, y: top, w, h })

    // A marker sits where the line from the middle of the screen to its tile leaves the screen.
    for (const t of world.tiles) {
      const m = pointersTo.get(t.id)
      if (!m) continue
      const hidden = inView(t) || vw === 0
      m.hidden = hidden
      if (hidden) continue
      const c = centre(t)
      const dx = (c.x - cam.x) * cam.z
      const dy = (c.y - cam.y) * cam.z
      const k = Math.min((vw / 2 - MARKER_INSET) / Math.abs(dx || 1), (vh / 2 - MARKER_INSET) / Math.abs(dy || 1))
      m.style.transform = `translate(${vw / 2 + dx * k}px, ${vh / 2 + dy * k}px)`
      // nearer tiles are brighter
      m.style.opacity = String(clamp(1.15 - Math.hypot(dx, dy) / 1400, 0.3, 1))
    }
  }

  function tick(now: number) {
    const dt = Math.min(64, now - last)
    last = now
    let busy = false
    if (flight) {
      const t = clamp((now - flight.t0) / flight.ms, 0, 1)
      const e = 1 - Math.pow(1 - t, 3)
      cam.x = flight.from.x + (flight.to.x - flight.from.x) * e
      cam.y = flight.from.y + (flight.to.y - flight.from.y) * e
      cam.z = flight.from.z + (flight.to.z - flight.from.z) * e
      if (t === 1) flight = null
      busy = flight !== null
    } else if (Math.hypot(vx, vy) > 0.02) {
      cam.x -= (vx * dt) / cam.z
      cam.y -= (vy * dt) / cam.z
      // A flick of the finger glides further than a throw of the mouse.
      const decay = Math.pow(touch ? 0.9975 : 0.995, dt)
      vx *= decay
      vy *= decay
      // Coasting into an edge ends the glide on that axis.
      const b = bounded(cam)
      if (b.x !== cam.x) vx = 0
      if (b.y !== cam.y) vy = 0
      busy = true
    }
    // A flight may start past the edge (springing back from a rubber-banded drag).
    render(busy && flight !== null)
    raf = busy ? requestAnimationFrame(tick) : 0
  }

  function run() {
    if (raf) return
    last = performance.now()
    raf = requestAnimationFrame(tick)
  }

  let explored = false
  function exploring() {
    if (explored) return
    explored = true
    opts.onExplore()
  }

  function halt() {
    flight = null
    vx = vy = 0
  }

  function flyTo(to: Partial<Camera>, ms = 450) {
    halt()
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) ms = 0
    flight = { from: { ...cam }, to: bounded({ ...cam, ...to }), t0: performance.now(), ms: Math.max(1, ms) }
    run()
  }

  /** Zoom by `factor`, keeping the world point under screen point (sx, sy) fixed */
  function zoomAt(sx: number, sy: number, factor: number) {
    const z = clamp(cam.z * factor, MIN_ZOOM, MAX_ZOOM)
    const wx = cam.x + (sx - vw / 2) / cam.z
    const wy = cam.y + (sy - vh / 2) / cam.z
    cam.x = wx - (sx - vw / 2) / z
    cam.y = wy - (sy - vh / 2) / z
    cam.z = z
  }

  // --- pointer input: one pointer drags, two pinch
  const pointers = new Map<number, { x: number; y: number }>()
  let travelled = 0
  let dragged = false
  let lastMove = 0
  let touch = false
  // Reading lock: a drag moves only up and down, until pulled sideways hard enough.
  let locked = false
  let sideways = 0
  let startY = 0
  let broke = false

  const local = (e: PointerEvent | WheelEvent) => {
    const b = viewport.getBoundingClientRect()
    return { x: e.clientX - b.left, y: e.clientY - b.top }
  }

  viewport.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    halt()
    touch = e.pointerType !== 'mouse'
    if (pointers.size === 0) {
      travelled = 0
      dragged = false
      sideways = 0
      startY = e.clientY
      broke = false
    }
    pointers.set(e.pointerId, local(e))
  })

  viewport.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId)
    if (!prev) return
    const p = local(e)
    pointers.set(e.pointerId, p)

    if (pointers.size === 1) {
      const dx = p.x - prev.x
      const dy = p.y - prev.y
      travelled += Math.hypot(dx, dy)
      if (!dragged && travelled > DRAG_THRESHOLD) {
        dragged = true
        exploring()
        // Capturing only once it is a drag keeps plain clicks landing on tiles.
        viewport.setPointerCapture(e.pointerId)
        viewport.classList.add('dragging')
      }
      if (!dragged) return
      let px = dx
      if (locked && !broke) {
        // The pull builds up unseen; past the threshold it is let go all at once, like snapping free.
        sideways += dx
        if (Math.abs(sideways) > BREAK && Math.abs(sideways) > Math.abs(e.clientY - startY)) {
          broke = true
          px = sideways
          opts.onBreak?.()
        } else px = 0
      }
      // Past the edge the world resists, and springs back on release.
      const b = bounded(cam)
      cam.x -= (px / cam.z) * (b.x === cam.x ? 1 : RUBBER)
      cam.y -= (dy / cam.z) * (b.y === cam.y ? 1 : RUBBER)
      const dt = Math.max(1, e.timeStamp - lastMove)
      vx = locked && !broke ? 0 : vx * 0.6 + (dx / dt) * 0.4
      vy = vy * 0.6 + (dy / dt) * 0.4
      lastMove = e.timeStamp
    } else if (pointers.size === 2) {
      const other = [...pointers.entries()].find(([id]) => id !== e.pointerId)![1]
      const before = Math.hypot(prev.x - other.x, prev.y - other.y)
      const after = Math.hypot(p.x - other.x, p.y - other.y)
      dragged = true
      exploring()
      cam.x -= (p.x - prev.x) / 2 / cam.z
      cam.y -= (p.y - prev.y) / 2 / cam.z
      if (before > 0) zoomAt((p.x + other.x) / 2, (p.y + other.y) / 2, after / before)
    }
    render(true)
  })

  const release = (e: PointerEvent) => {
    if (!pointers.delete(e.pointerId)) return
    if (pointers.size > 0) {
      vx = vy = 0
      return
    }
    viewport.classList.remove('dragging')
    const b = bounded(cam)
    if (b.x !== cam.x || b.y !== cam.y) {
      flyTo(b, 350)
      return
    }
    // A pause before letting go means "stop here", not "throw".
    if (e.timeStamp - lastMove > 80) vx = vy = 0
    if (dragged) run()
  }
  viewport.addEventListener('pointerup', release)
  viewport.addEventListener('pointercancel', release)

  // The click that ends a drag must not open whatever was under the pointer.
  viewport.addEventListener(
    'click',
    (e) => {
      if (!dragged) return
      e.preventDefault()
      e.stopPropagation()
      dragged = false
    },
    true,
  )
  viewport.addEventListener('dragstart', (e) => e.preventDefault())
  // iOS Safari: keep a pinch from zooming the page instead of the map.
  viewport.addEventListener('gesturestart', (e) => e.preventDefault())

  viewport.addEventListener(
    'wheel',
    (e) => {
      // A card's own scrolling body takes the wheel itself.
      if ((e.target as Element).closest('.scrolls')) return
      e.preventDefault()
      halt()
      exploring()
      const unit = e.deltaMode === 1 ? 16 : 1
      if (e.ctrlKey || e.metaKey) {
        // ctrl+wheel, which is also what a trackpad pinch sends
        const p = local(e)
        zoomAt(p.x, p.y, Math.exp(-e.deltaY * unit * 0.01))
      } else {
        cam.x += (e.deltaX * unit) / cam.z
        cam.y += (e.deltaY * unit) / cam.z
      }
      render()
    },
    { passive: false },
  )

  // --- minimap input: press or drag to move the view there
  const jump = (e: PointerEvent, animate: boolean) => {
    const b = minimap.getBoundingClientRect()
    const to = {
      x: ((e.clientX - b.left) / b.width) * world.w,
      y: ((e.clientY - b.top) / b.height) * world.h,
    }
    if (animate) flyTo(to, 300)
    else {
      halt()
      Object.assign(cam, to)
      render()
    }
  }
  minimap.addEventListener('pointerdown', (e) => {
    jump(e, true)
    minimap.setPointerCapture(e.pointerId)
  })
  minimap.addEventListener('pointermove', (e) => {
    if (minimap.hasPointerCapture(e.pointerId)) jump(e, false)
  })

  function resize() {
    const b = viewport.getBoundingClientRect()
    vw = b.width
    vh = b.height
    render()
  }
  new ResizeObserver(resize).observe(viewport)
  drawOverlays()
  resize()

  return {
    /** Swap in a new layout and start again from home */
    setWorld(next: World) {
      world = next
      home = world.origin
      drawOverlays()
      halt()
      Object.assign(cam, home, { z: 1 })
      render()
    },
    markSeen,
    viewport: () => ({ w: vw, h: vh }),
    /** Stretch the world to hold `r` (null to let go); the plane is the caller's to resize */
    reach(r: Rect | null) {
      reach = r
    },
    go: flyTo,
    /** Fly to `fallback` if the camera is outside the world, else stay */
    settle(fallback: Rect, ms = 500) {
      const b = bounded(cam)
      if (b.x !== cam.x || b.y !== cam.y) flyTo(centre(fallback), ms)
    },
    /** While on, drags move only up and down (see BREAK) */
    lock(on: boolean) {
      locked = on
    },
    /** Cut to a view of the whole world, as far as the zoom range allows */
    overview() {
      halt()
      Object.assign(cam, { x: world.w / 2, y: world.h / 2, z: Math.min(vw / world.w, vh / world.h, 1) })
      render()
    },
    goHome: (ms?: number) => flyTo({ ...home, z: 1 }, ms),
    /** `ms` 0 cuts straight there, for when the map is not on screen */
    focus: (r: Rect, ms?: number) => flyTo({ ...centre(r), z: Math.max(cam.z, 0.8) }, ms),
    /** Fly to `r` at whatever zoom shows all of it, with `margin` screen px to spare on each side */
    fit(r: Rect, margin = 20) {
      const z = Math.min((vw - 2 * margin) / r.w, (vh - 2 * margin) / r.h)
      flyTo({ ...centre(r), z: clamp(z, MIN_ZOOM, MAX_ZOOM) })
    },
    panBy(dx: number, dy: number) {
      exploring()
      const from = flight?.to ?? cam
      flyTo({ x: from.x + dx / cam.z, y: from.y + dy / cam.z }, 200)
    },
    zoomBy(factor: number) {
      const from = flight?.to ?? cam
      flyTo({ z: clamp(from.z * factor, MIN_ZOOM, MAX_ZOOM) }, 200)
    },
  }
}
