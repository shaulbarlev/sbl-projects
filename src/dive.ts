import { h } from './dom'

/**
 * The move between a tile and its project: the tile's picture zooms to fill the
 * screen and dissolves into the project's empty panel, or the reverse.
 *
 * Only transform and opacity are animated, on screen-sized layers at most, and
 * the project itself is built while an opaque panel covers it — never during
 * the zoom. That is what keeps this smooth on a phone, where the project is a
 * page many screens long with videos in it.
 */

const OPEN_MS = 400
const CLOSE_MS = 300
const EASE = 'cubic-bezier(0.3, 0, 0.1, 1)'

/**
 * The picture's two tracks. Every keyframe list here ends at offset 1 on purpose:
 * leave the end out and the browser supplies the element's own state there, and
 * the picture flies back to where it started.
 */
const travel = (from: string, to: string): Keyframe[] => [{ transform: from }, { transform: to }]
/*
 * The fades run on linear time, not on the zoom's easing: an ease-out is nearly
 * done by half time, so a fade sharing it goes dark while the zoom is still
 * moving. Opening, the picture holds until the zoom has all but arrived and only
 * then dissolves into the panel; closing, it is back early and lands in plain sight.
 */
const PICTURE_AWAY: Keyframe[] = [{ opacity: 1 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }]
const PANEL_IN: Keyframe[] = [{ opacity: 0 }, { opacity: 0, offset: 0.45 }, { opacity: 1 }]
const PICTURE_BACK: Keyframe[] = [{ opacity: 0 }, { opacity: 1, offset: 0.35 }, { opacity: 1 }]
const PANEL_OUT: Keyframe[] = [{ opacity: 1 }, { opacity: 0, offset: 0.6 }, { opacity: 0 }]

const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches
const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))

/** Ends the dive in progress, if any, so a second one never stacks on it. */
let finishNow: (() => void) | null = null

function stage(picture: HTMLImageElement) {
  const from = picture.getBoundingClientRect()
  // The project's own skeleton, so the panel that fades in is exactly where the real one will be.
  const shell = h('div', { class: 'pv shell' }, h('div', { class: 'pv-backdrop' }), h('article', { class: 'pv-panel' }))
  const zoom = h('img', { class: 'dive', src: picture.currentSrc || picture.src, alt: '' })
  Object.assign(zoom.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px` })
  // Centred on the screen and big enough to cover it
  const scale = Math.max(innerWidth, innerHeight) / from.width
  const dx = innerWidth / 2 - (from.left + from.width / 2)
  const dy = innerHeight / 2 - (from.top + from.height / 2)
  return { shell, zoom, near: 'translate(0px, 0px) scale(1)', far: `translate(${dx}px, ${dy}px) scale(${scale})` }
}

/** Tile → project. `build` puts the project on the page. */
export async function diveIn(picture: HTMLImageElement | undefined, build: () => void) {
  finishNow?.()
  if (!picture || still()) return build()

  const { shell, zoom, near, far } = stage(picture)
  document.body.append(shell, zoom)
  let done = false
  const finish = () => {
    if (done) return
    done = true
    finishNow = null
    build()
    shell.remove()
    zoom.remove()
  }
  finishNow = finish

  const timing = { duration: OPEN_MS, easing: EASE, fill: 'both' } as const
  shell.animate(PANEL_IN, { ...timing, easing: 'linear' })
  zoom.animate(PICTURE_AWAY, { ...timing, easing: 'linear' })
  await zoom.animate(travel(near, far), timing).finished.catch(() => {})
  if (done) return

  // Build under cover: the shell's panel hides the page while it lays out and
  // first paints, then fades away. Its backdrop goes at once, as the real one is there now.
  done = true
  finishNow = null
  build()
  zoom.remove()
  shell.querySelector('.pv-backdrop')?.remove()
  await frame()
  await frame()
  await shell.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'ease-out', fill: 'both' }).finished.catch(() => {})
  shell.remove()
}

/** Project → tile. `clear` takes the project off the page; `find` then locates the tile's picture on the map. */
export async function diveOut(clear: () => void, find: () => HTMLImageElement | undefined) {
  finishNow?.()
  if (still()) return clear()

  // Cover first, so the map can come back underneath unseen.
  const cover = h('div', { class: 'pv shell' }, h('div', { class: 'pv-backdrop' }), h('article', { class: 'pv-panel' }))
  document.body.append(cover)
  clear()
  const picture = find()
  if (!picture) {
    cover.remove()
    return
  }

  const { zoom, near, far } = stage(picture)
  document.body.append(zoom)
  let done = false
  const finish = () => {
    if (done) return
    done = true
    finishNow = null
    cover.remove()
    zoom.remove()
  }
  finishNow = finish

  const timing = { duration: CLOSE_MS, easing: EASE, fill: 'both' } as const
  cover.animate(PANEL_OUT, { ...timing, easing: 'linear' })
  zoom.animate(PICTURE_BACK, { ...timing, easing: 'linear' })
  await zoom.animate(travel(far, near), timing).finished.catch(() => {})
  finish()
}
