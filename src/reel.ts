import { h } from './dom'
import type { Rect } from './layout'
import { REEL } from './projects'

/** How many times wider the tile gets, and the shape it takes: the reel's */
const GROW = 4
const ASPECT = 16 / 9
/** How much of the open reel may leave the view before it folds */
const KEEP = 0.3

/**
 * The film & art tile opens in place into the reel: it grows about its own
 * centre into a 16:9 player, poster up and controls ready, and the map is
 * brought to it at a zoom that shows the whole player. Panning away folds it.
 * Its link to the film site stays as the closed face, for opening in a new
 * tab and for when there is no script.
 */
export function createReel(face: HTMLAnchorElement, onOpen: (at: Rect) => void) {
  const box = h('div', { class: `${face.className} reel` })
  face.className = 'reel-face'
  box.append(face)

  let closed: Rect = { x: 0, y: 0, w: 0, h: 0 }
  let open: Rect | null = null
  let video: HTMLVideoElement | null = null
  let armed = false

  const put = (r: Rect) => Object.assign(box.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` })

  function close() {
    if (!video) return
    video.remove()
    video = null
    open = null
    armed = false
    box.classList.remove('open')
    put(closed)
  }

  face.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return
    e.preventDefault()
    if (video) return
    // Nothing is fetched but the poster until play is pressed.
    video = h('video', { controls: true, playsinline: true, preload: 'none', poster: REEL.poster }, h('source', { src: REEL.src, type: 'video/mp4' }))
    box.append(video)
    box.classList.add('open')
    const w = closed.w * GROW
    open = { x: closed.x - (w - closed.w) / 2, y: closed.y - (w / ASPECT - closed.h) / 2, w, h: w / ASPECT }
    put(open)
    onOpen(open)
  })
  // A drag that starts on the player is for its scrubber, not for the map.
  box.addEventListener('pointerdown', (e) => video && e.stopPropagation())

  return {
    el: box,
    close,
    /** Folds the reel once `view` has mostly left it (called after every move) */
    check(v: Rect) {
      if (!open) return
      const ix = Math.max(0, Math.min(open.x + open.w, v.x + v.w) - Math.max(open.x, v.x))
      const iy = Math.max(0, Math.min(open.y + open.h, v.y + v.h) - Math.max(open.y, v.y))
      const shown = (ix * iy) / Math.min(open.w * open.h, v.w * v.h)
      // Armed once the map has arrived on it; not while still flying there.
      if (shown > 0.9) armed = true
      else if (armed && shown < KEEP) close()
    },
    /** Where the closed tile sits; a new layout closes it */
    place(at: Rect) {
      close()
      closed = at
      put(at)
    },
  }
}
