import type { Rect, World } from './layout'

const MIN_ZOOM = 0.4
const MAX_ZOOM = 2
/** Pointer travel (px) before a press counts as a drag rather than a click */
const DRAG_THRESHOLD = 6

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
  world: World
  /** Called when home scrolls in or out of view */
  onHomeVisible: (visible: boolean) => void
}) {
  const { viewport, plane, minimap, readout } = opts
  let world = opts.world
  let home = centre(world.home)
  const cam: Camera = { ...home, z: 1 }
  let vw = 0
  let vh = 0

  // --- animation state: either coasting on velocity, or flying to a target
  let vx = 0
  let vy = 0
  let flight: { from: Camera; to: Camera; t0: number; ms: number } | null = null
  let raf = 0
  let last = 0

  // --- minimap
  const frame = document.createElement('div')
  frame.className = 'mm-view'
  function drawMinimap() {
    const dot = (r: Rect, cls: string) => {
      const d = document.createElement('div')
      d.className = cls
      d.style.left = `${(r.x / world.w) * 100}%`
      d.style.top = `${(r.y / world.h) * 100}%`
      d.style.width = `${(r.w / world.w) * 100}%`
      d.style.height = `${(r.h / world.h) * 100}%`
      return d
    }
    minimap.style.aspectRatio = `${world.w} / ${world.h}`
    minimap.replaceChildren(dot(world.home, 'mm-home'), ...world.tiles.map((t) => dot(t, 'mm-tile')), frame)
  }
  drawMinimap()

  function render() {
    cam.z = clamp(cam.z, MIN_ZOOM, MAX_ZOOM)
    // Keep the view inside the world; where the world is the smaller one, centre it.
    const halfW = vw / cam.z / 2
    const halfH = vh / cam.z / 2
    cam.x = world.w > halfW * 2 ? clamp(cam.x, halfW, world.w - halfW) : world.w / 2
    cam.y = world.h > halfH * 2 ? clamp(cam.y, halfH, world.h - halfH) : world.h / 2
    plane.style.transform = `translate(${vw / 2 - cam.x * cam.z}px, ${vh / 2 - cam.y * cam.z}px) scale(${cam.z})`

    const w = halfW * 2
    const h = halfH * 2
    frame.style.left = `${((cam.x - w / 2) / world.w) * 100}%`
    frame.style.top = `${((cam.y - h / 2) / world.h) * 100}%`
    frame.style.width = `${(w / world.w) * 100}%`
    frame.style.height = `${(h / world.h) * 100}%`
    readout.textContent = `x ${Math.round(cam.x - home.x)}  y ${Math.round(cam.y - home.y)}  ${Math.round(cam.z * 100)}%`

    const r = world.home
    opts.onHomeVisible(
      r.x + r.w > cam.x - w / 2 && r.x < cam.x + w / 2 && r.y + r.h > cam.y - h / 2 && r.y < cam.y + h / 2,
    )
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
      busy = true
    }
    render()
    raf = busy ? requestAnimationFrame(tick) : 0
  }

  function run() {
    if (raf) return
    last = performance.now()
    raf = requestAnimationFrame(tick)
  }

  function halt() {
    flight = null
    vx = vy = 0
  }

  function flyTo(to: Partial<Camera>, ms = 450) {
    halt()
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) ms = 0
    flight = { from: { ...cam }, to: { ...cam, ...to }, t0: performance.now(), ms: Math.max(1, ms) }
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
        // Capturing only once it is a drag keeps plain clicks landing on tiles.
        viewport.setPointerCapture(e.pointerId)
        viewport.classList.add('dragging')
      }
      if (!dragged) return
      cam.x -= dx / cam.z
      cam.y -= dy / cam.z
      const dt = Math.max(1, e.timeStamp - lastMove)
      vx = vx * 0.6 + (dx / dt) * 0.4
      vy = vy * 0.6 + (dy / dt) * 0.4
      lastMove = e.timeStamp
    } else if (pointers.size === 2) {
      const other = [...pointers.entries()].find(([id]) => id !== e.pointerId)![1]
      const before = Math.hypot(prev.x - other.x, prev.y - other.y)
      const after = Math.hypot(p.x - other.x, p.y - other.y)
      dragged = true
      cam.x -= (p.x - prev.x) / 2 / cam.z
      cam.y -= (p.y - prev.y) / 2 / cam.z
      if (before > 0) zoomAt((p.x + other.x) / 2, (p.y + other.y) / 2, after / before)
    }
    render()
  })

  const release = (e: PointerEvent) => {
    if (!pointers.delete(e.pointerId)) return
    if (pointers.size > 0) {
      vx = vy = 0
      return
    }
    viewport.classList.remove('dragging')
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
      e.preventDefault()
      halt()
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
    // Hidden (a project page is showing on mobile): keep the last known size.
    if (b.width === 0) return
    vw = b.width
    vh = b.height
    render()
  }
  new ResizeObserver(resize).observe(viewport)
  resize()

  return {
    /** Swap in a new layout and start again from home */
    setWorld(next: World) {
      world = next
      home = centre(world.home)
      drawMinimap()
      halt()
      Object.assign(cam, home, { z: 1 })
      render()
    },
    goHome: (ms?: number) => flyTo({ ...home, z: 1 }, ms),
    focus: (r: Rect) => flyTo(centre(r)),
    panBy(dx: number, dy: number) {
      const from = flight?.to ?? cam
      flyTo({ x: from.x + dx / cam.z, y: from.y + dy / cam.z }, 200)
    },
    zoomBy(factor: number) {
      const from = flight?.to ?? cam
      flyTo({ z: clamp(from.z * factor, MIN_ZOOM, MAX_ZOOM) }, 200)
    },
  }
}
