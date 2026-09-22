import { h } from './dom'

/**
 * The move between a tile and its project: the tile's picture grows until it
 * covers the project's panel and the project fades in over it, or the reverse.
 *
 * The project is a fixed, screen-sized layer with its scrolling inside, and the
 * map stays put underneath it. So all that is animated is a transform on the
 * picture and an opacity on that layer, never anything as tall as the page.
 * The picture is opaque from start to finish: once it covers the screen, the
 * map cannot show through the half-faded project.
 */

const MS = 320
const EASE = 'cubic-bezier(0.3, 0, 0.1, 1)'
/** The most the zoom waits for the page's pictures */
const READY_MS = 300

const still = matchMedia('(prefers-reduced-motion: reduce)')
const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Ends the dive in progress, so that a second one never stacks on it. */
let settle = () => {}

/**
 * A fresh page's first frame is heavy: the video controls' layout, the pictures'
 * first paint. An animation started on that frame takes its timestamp, so by the
 * next frame the browser can show it is most of the way through: the zoom looks
 * skipped. So the page is committed, and the pictures in view decoded, before
 * anything moves.
 */
async function ready(page: HTMLElement) {
  await frame()
  await frame()
  const pictures = [...page.querySelectorAll('img')].filter((img) => img.getBoundingClientRect().top < innerHeight)
  await Promise.race([Promise.all(pictures.map((img) => img.decode().catch(() => {}))), wait(READY_MS)])
}

const pageOf = (picture: HTMLImageElement | undefined) => {
  const page = document.querySelector<HTMLElement>('.pv')
  return picture && page && !still.matches ? page : null
}

function dive(picture: HTMLImageElement, page: HTMLElement, opening: boolean, done: () => void) {
  const from = picture.getBoundingClientRect()
  const to = page.querySelector('.pv-panel')!.getBoundingClientRect()
  // A phone's page is covered edge to edge. A modal has the map showing around it, so there the picture stays inside.
  const scale = (to.width < innerWidth ? Math.min : Math.max)(to.width, to.height) / from.width
  const dx = to.left + to.width / 2 - (from.left + from.width / 2)
  const dy = to.top + to.height / 2 - (from.top + from.height / 2)

  const zoom = h('img', { class: 'dive', src: picture.src, alt: '', decoding: 'sync' })
  Object.assign(zoom.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px` })
  page.before(zoom)

  // One clock for both layers. The curve sits on the picture's moving keyframe alone: as the timing's easing it
  // would bend the fade too, and have it over before the picture arrives. And every list ends at offset 1: left
  // out, that end is the element's own state, and the picture flies back.
  const timing = { duration: MS, fill: 'both' } as const
  const near = 'none'
  const far = `translate(${dx}px, ${dy}px) scale(${scale})`
  const moves = opening
    ? [
        zoom.animate([{ transform: near, easing: EASE }, { transform: far, offset: 0.85 }, { transform: far }], timing),
        page.animate([{ opacity: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 1 }], timing),
      ]
    : [
        zoom.animate([{ transform: far }, { transform: far, offset: 0.2, easing: EASE }, { transform: near }], timing),
        page.animate([{ opacity: 1 }, { opacity: 0, offset: 0.4 }, { opacity: 0 }], timing),
      ]
  const finish = () => {
    settle = () => {}
    for (const move of moves) move.cancel()
    zoom.remove()
    page.classList.remove('diving')
    done()
  }
  settle = finish
  // A cancelled move rejects, and has been finished already.
  Promise.all(moves.map((move) => move.finished)).then(finish, () => {})
}

/** Tile → project. `build` puts the project on the page; `arrived` is called once it is in full view. */
export async function diveIn(picture: HTMLImageElement | undefined, build: () => void, arrived: () => void) {
  settle()
  build()
  const page = pageOf(picture)
  if (!page) return arrived()
  // Hidden and inert while it gets ready; a dive that cuts in meanwhile just shows it.
  page.classList.add('diving')
  let waiting = true
  settle = () => {
    waiting = false
    page.classList.remove('diving')
  }
  await ready(page)
  if (waiting) dive(picture!, page, true, arrived)
}

/** Project → tile, or with no picture just the switch. `clear` takes the project off the page. */
export function diveOut(picture: HTMLImageElement | undefined, clear: () => void) {
  settle()
  const page = pageOf(picture)
  if (!page) return clear()
  page.classList.add('diving')
  dive(picture!, page, false, clear)
}
