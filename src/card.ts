import type { Rect } from './layout'

/**
 * A project opens where its tile stands: the tile grows into a page-shaped card
 * in the map's own space, its picture becoming the card's header. On a wide
 * screen the card fills most of the view and its content scrolls inside it. On
 * a phone it takes its full height and is read by panning the map, its top in
 * view first. Either way, panning away from it folds it back into the tile.
 */

/** Screen px kept clear around the card, and how long it takes to grow or fold */
const MARGIN = 16
const MS = 420
/** How much of the card may leave the view before it folds */
const KEEP = 0.3
const WIDEST = 1100

export type MapFor = {
  viewport(): { w: number; h: number }
  reach(r: Rect | null): void
  go(to: { x?: number; y?: number; z?: number }, ms?: number): void
  settle(fallback: Rect): void
}

export type Card = {
  id: string
  /** Folds the card back into its tile; `instant` skips the animation */
  close(instant?: boolean): void
  /** Folds the card if `view` has mostly left it (called after every move) */
  check(view: Rect): void
}

export function openCard(opts: {
  id: string
  tile: HTMLElement
  at: Rect
  map: MapFor
  narrow: boolean
  /** The plane the tile lives on, resized to hold the card */
  plane: HTMLElement
  world: { w: number; h: number }
  /** Builds the project's content once the card has grown */
  content: () => HTMLElement
  /** Called after the fold, however it was triggered */
  onClosed: () => void
  cut?: boolean
}): Card {
  const { id, tile, at, map, narrow, plane, world, content } = opts
  const { w: vw, h: vh } = map.viewport()
  // The card is laid out at 1:1, so its world size is its screen size at zoom 1.
  const w = Math.min(vw - 2 * MARGIN, WIDEST)
  const rect: Rect = {
    x: Math.round(Math.max(MARGIN, Math.min(at.x + at.w / 2 - w / 2, world.w - w - MARGIN))),
    y: at.y,
    w,
    h: narrow ? vh : vh - 2 * MARGIN,
  }
  // 16:9 of the width, but on a wide screen the page must keep most of the height
  const hero = Math.min(Math.round((w * 9) / 16), narrow ? Infinity : 280)
  const put = (r: Rect) => Object.assign(tile.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` })
  const stretch = (r: Rect) => {
    map.reach(r)
    plane.style.width = `${Math.max(world.w, r.x + r.w + 40)}px`
    plane.style.height = `${Math.max(world.h, r.y + r.h + 40)}px`
  }

  let view: HTMLElement | null
  let armed = false
  let done = false
  const timers: number[] = []
  const later = (fn: () => void, ms: number) => timers.push(window.setTimeout(fn, ms))

  if (opts.cut) tile.classList.add('cut')
  tile.classList.add('card')
  tile.style.setProperty('--hero', `${hero}px`)
  tile.style.setProperty('--panel', `${rect.h - hero}px`)
  stretch(rect)
  put(rect)
  // A phone reads the card by panning down, so its top goes to the top of the screen.
  map.go(narrow ? { x: rect.x + w / 2, y: rect.y + vh / 2 - MARGIN, z: 1 } : { x: rect.x + w / 2, y: rect.y + rect.h / 2, z: 1 }, opts.cut ? 0 : 450)

  // The content is there from the start, fading in under the growth, so the page unfolds rather than arrives.
  view = content()
  if (!narrow) view.querySelector('.pv-body')?.classList.add('scrolls')
  tile.append(view)
  if (narrow) {
    // As tall as its page; the extra height is below the fold while the width grows.
    tile.style.height = 'auto'
    rect.h = tile.offsetHeight
    stretch(rect)
  }
  later(() => {
    view?.querySelector<HTMLElement>('.pv-panel')?.focus({ preventScroll: true })
    armed = true
  }, opts.cut ? 0 : MS)

  function close(instant = false) {
    if (done) return
    done = true
    timers.forEach(clearTimeout)
    view?.remove()
    view = null
    tile.classList.remove('cut')
    tile.classList.toggle('folding', !instant)
    put(at)
    const finish = () => {
      tile.classList.remove('card', 'folding')
      tile.style.removeProperty('height')
      // The world shrinks back once the card has. A camera left outside it (deep in a
      // long card) flies to the tile the card came from, rather than to empty ground.
      map.reach(null)
      plane.style.width = `${world.w}px`
      plane.style.height = `${world.h}px`
      map.settle(at)
      opts.onClosed()
    }
    if (instant) finish()
    else window.setTimeout(finish, MS)
  }

  function check(v: Rect) {
    if (!armed || done) return
    const ix = Math.max(0, Math.min(rect.x + rect.w, v.x + v.w) - Math.max(rect.x, v.x))
    const iy = Math.max(0, Math.min(rect.y + rect.h, v.y + v.h) - Math.max(rect.y, v.y))
    const shown = (ix * iy) / Math.min(rect.w * rect.h, v.w * v.h)
    if (shown < KEEP) close()
  }

  return { id, close, check }
}
