import { h } from './dom'
import type { Rect } from './layout'
import { REEL } from './projects'

/** How many times wider the tile gets, and the shape it takes: the reel's */
const GROW = 4
const ASPECT = 16 / 9
/** How much of the open reel may leave the view before it folds */
const KEEP = 0.3

/**
 * The film & art tile opens in place into the reel: it grows into a 16:9
 * player — rightwards from its left edge on a wide screen, about its own centre
 * on a phone — poster up and controls ready, and the map is
 * brought to it at a zoom that shows the whole player. Panning away folds it.
 * Its link to the film site stays as the closed face, for opening in a new
 * tab and for when there is no script.
 *
 * `/reel/` is the address of the open player, so it can be linked and shared;
 * `onOpen` and `onClose` are how the caller keeps that address in step.
 */
export function createReel(
  face: HTMLAnchorElement,
  onOpen: (at: Rect) => void,
  onClose: () => void = () => {},
  narrow: () => boolean = () => false,
) {
  const box = h('div', { class: `${face.className} reel` })
  face.className = 'reel-face'
  // Above the player's top-right corner: the reel also folds by panning away or
  // Escape, but neither is obvious with a video under the pointer.
  const shut = h(
    'button',
    { class: 'reel-close', type: 'button', 'aria-label': 'Close the reel' },
    h('i', { class: 'hn hn-times', 'aria-hidden': 'true' }),
  )
  shut.addEventListener('pointerdown', (e) => e.stopPropagation())
  shut.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    close()
  })
  box.append(face, shut)

  let closed: Rect = { x: 0, y: 0, w: 0, h: 0 }
  let open: Rect | null = null
  let video: HTMLVideoElement | null = null
  let armed = false

  const put = (r: Rect) => Object.assign(box.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` })

  /** Where the open player goes for the closed tile at `closed` */
  function grown(): Rect {
    const w = closed.w * GROW
    // On a wide screen the tile sits due east of the wordmark, so a player that
    // grew about its centre reached back over the name: there it opens
    // rightwards from its left edge instead. The phone layout puts the tile
    // elsewhere and looked right as it was.
    const x = narrow() ? closed.x - (w - closed.w) / 2 : closed.x
    return { x, y: closed.y - (w / ASPECT - closed.h) / 2, w, h: w / ASPECT }
  }

  /**
   * True while the player is full screen. Turning the phone then resizes the
   * page behind it, which must neither fold the reel nor re-lay it out by
   * removing the video: removing it ends full screen and the film with it.
   * iPhone has only its own player (`webkitDisplayingFullscreen`); iPad and
   * desktops use the Fullscreen API, prefixed in older Safari.
   */
  const fullscreen = () => {
    if (!video) return false
    const doc = document as Document & { webkitFullscreenElement?: Element | null }
    const el = document.fullscreenElement ?? doc.webkitFullscreenElement ?? null
    return (video as HTMLVideoElement & { webkitDisplayingFullscreen?: boolean }).webkitDisplayingFullscreen === true || (el !== null && (el === video || el.contains(video)))
  }
  // Back from full screen the page may have been turned and laid out anew, so
  // the map is brought back to the player rather than left wherever it was.
  let wasFull = false
  function fullscreenChanged() {
    const now = fullscreen()
    if (wasFull && !now && open) {
      armed = false
      onOpen(open)
    }
    wasFull = now
  }
  document.addEventListener('fullscreenchange', fullscreenChanged)
  document.addEventListener('webkitfullscreenchange', fullscreenChanged)

  function close() {
    if (!video) return
    video.remove()
    video = null
    open = null
    armed = false
    box.classList.remove('open')
    put(closed)
    onClose()
  }

  /** @param fly whether the map travels to it; false for a visitor who arrived at /reel/ */
  function unfold(fly = true) {
    if (video) return
    // Nothing is fetched but the poster until play is pressed.
    video = h('video', { controls: true, playsinline: true, preload: 'none', poster: REEL.poster }, h('source', { src: REEL.src, type: 'video/mp4' }))
    // iPhone's own full-screen player fires these on the video, not the document.
    video.addEventListener('webkitbeginfullscreen', fullscreenChanged)
    video.addEventListener('webkitendfullscreen', fullscreenChanged)
    box.append(video)
    box.classList.add('open')
    open = grown()
    put(open)
    if (fly) onOpen(open)
    return open
  }

  face.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return
    e.preventDefault()
    unfold()
  })
  // A drag that starts on the player is for its scrubber, not for the map.
  box.addEventListener('pointerdown', (e) => video && e.stopPropagation())

  return {
    el: box,
    close,
    open: unfold,
    get isOpen() {
      return video !== null
    },
    /** Folds the reel once `view` has mostly left it (called after every move) */
    check(v: Rect) {
      if (!open || fullscreen()) return
      const ix = Math.max(0, Math.min(open.x + open.w, v.x + v.w) - Math.max(open.x, v.x))
      const iy = Math.max(0, Math.min(open.y + open.h, v.y + v.h) - Math.max(open.y, v.y))
      const shown = (ix * iy) / Math.min(open.w * open.h, v.w * v.h)
      // Armed once the map has arrived on it; not while still flying there.
      if (shown > 0.9) armed = true
      else if (armed && shown < KEEP) close()
    },
    /**
     * Where the closed tile sits. A new layout (a phone turned) moves an open
     * player along with its tile and keeps the video playing; the caller
     * brings the map to it with the returned rect.
     */
    place(at: Rect): Rect | null {
      closed = at
      if (!open) {
        put(at)
        return null
      }
      open = grown()
      armed = false
      put(open)
      return open
    },
  }
}
