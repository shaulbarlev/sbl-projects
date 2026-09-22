import { h } from './dom'
import type { Rect } from './layout'
import { REEL } from './projects'

/** How many times wider the tile gets, and the shape it takes: the reel's */
const GROW = 4
const ASPECT = 16 / 9

/**
 * The film & art tile opens in place into the reel: it grows about its own
 * centre into a 16:9 player, poster up and controls ready, and the map is
 * brought to it at a zoom that shows the whole player. Its link to the film site stays as the closed face, for
 * opening in a new tab and for when there is no script.
 */
export function createReel(face: HTMLAnchorElement, onOpen: (at: Rect) => void) {
  const box = h('div', { class: `${face.className} reel` })
  face.className = 'reel-face'
  box.append(face)

  const closeButton = h('button', { class: 'reel-close', type: 'button', 'aria-label': 'Close the reel' }, h('i', { class: 'hn hn-times', 'aria-hidden': 'true' }))
  let closed: Rect = { x: 0, y: 0, w: 0, h: 0 }
  let video: HTMLVideoElement | null = null

  const put = (r: Rect) => Object.assign(box.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` })

  function close() {
    if (!video) return
    video.remove()
    video = null
    closeButton.remove()
    box.classList.remove('open')
    put(closed)
  }

  face.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return
    e.preventDefault()
    // Nothing is fetched but the poster until play is pressed.
    video = h('video', { controls: true, playsinline: true, preload: 'none', poster: REEL.poster }, h('source', { src: REEL.src, type: 'video/mp4' }))
    box.append(video, closeButton)
    box.classList.add('open')
    const w = closed.w * GROW
    const open = { x: closed.x - (w - closed.w) / 2, y: closed.y - (w / ASPECT - closed.h) / 2, w, h: w / ASPECT }
    put(open)
    onOpen(open)
  })
  closeButton.addEventListener('click', close)
  // A drag that starts on the player is for its scrubber, not for the map.
  box.addEventListener('pointerdown', (e) => video && e.stopPropagation())

  return {
    el: box,
    close,
    /** Where the closed tile sits; a new layout closes it */
    place(at: Rect) {
      close()
      closed = at
      put(at)
    },
  }
}
