// @ts-check
/**
 * A page shown inside another, the traffic light inside the portfolio's map:
 * both sides of that in one file, so the map (which imports it) and the page
 * (which the QR Worker inlines it into, as a module script) can never drift.
 *
 * The problem: a frame swallows the pointer, so the page around it cannot
 * tell a drag from a tap. So the host lays a cover over the frame. A drag on
 * the cover is the host's (the map pans); a clean tap is relayed to the guest,
 * which taps whatever is under that point through its own handlers. The guest
 * reports its content height, so the frame can be no bigger than the page, and
 * where its text fields are, so the host cuts them out of the cover and a real
 * tap reaches them (a relayed one could not open the keyboard).
 *
 * The guest also reports its lamps (colour, lit or not, in page order), so the
 * host can draw the light small, on a minimap say.
 *
 * Messages:  guest → host  { type: 'skin:layout', height, box: {x,y,w,h}, fields: [{x,y,w,h}], lamps: [{color, on}], off }
 *                          (`box` is where the content sits inside the page, for placing things beside it;
 *                          `off` when the page has hidden itself, e.g. the light's master switch is off)
 *            host → guest  { type: 'skin:tap', x, y }   (guest CSS px)
 */

/** Which pages may relay a tap to the guest. Anyone can tap the public page anyway; this only keeps strangers' frames from driving it. */
const TRUSTED = /^https:\/\/([a-z0-9-]+\.)*(sbl\.cx|shaulb\.com|shaulbarlev\.com|workers\.dev)$/

/** A press that stays within this many px and this many ms is a tap, not a drag. */
const TAP_PX = 6
const TAP_MS = 500

/**
 * The host side: wire a cover over `frame`.
 * @param {HTMLIFrameElement} frame
 * @param {HTMLElement} cover  positioned over the frame, taking the pointer
 * @param {(layout: { height: number, box?: { x: number, y: number, w: number, h: number }, lamps?: { color: string, on: boolean }[], off?: boolean }) => void} onLayout  whenever the guest's layout or lamps change
 * @param {() => void} [onTap]  each tap relayed to the guest
 */
export function host(frame, cover, onLayout, onTap) {
  const origin = new URL(frame.src).origin
  /** @type {{ x: number, y: number, t: number } | null} */
  let down = null
  cover.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY, t: e.timeStamp }
  })
  cover.addEventListener('pointerup', (e) => {
    const was = down
    down = null
    if (!was || Math.hypot(e.clientX - was.x, e.clientY - was.y) > TAP_PX || e.timeStamp - was.t > TAP_MS) return
    // Screen px to the guest's own px: the frame may be scaled by the page around it.
    const r = frame.getBoundingClientRect()
    const scale = r.width / frame.offsetWidth
    frame.contentWindow?.postMessage({ type: 'skin:tap', x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale }, origin)
    onTap?.()
  })
  window.addEventListener('message', (e) => {
    if (e.source !== frame.contentWindow || e.origin !== origin || !e.data || e.data.type !== 'skin:layout') return
    onLayout({ height: Math.round(e.data.height), box: e.data.box, lamps: e.data.lamps, off: e.data.off })
    /** @type {{ x: number, y: number, w: number, h: number }[]} */
    const fields = e.data.fields
    // The cover, with a hole for each field (evenodd: the inner rings are cut out).
    const holes = fields.map((f) => `${f.x}px ${f.y}px, ${f.x + f.w}px ${f.y}px, ${f.x + f.w}px ${f.y + f.h}px, ${f.x}px ${f.y + f.h}px, ${f.x}px ${f.y}px`)
    cover.style.clipPath = holes.length ? `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${holes.join(', ')})` : ''
  })
}

/**
 * The guest side: call from the embedded page. Reports its layout to the
 * host as it changes, and takes relayed taps. Does nothing when not framed.
 */
export function guest() {
  if (window.parent === window) return
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let sending
  const tell = () => {
    clearTimeout(sending)
    sending = setTimeout(() => {
      const fields = [...document.querySelectorAll('input')]
        .filter((el) => el.offsetParent !== null)
        .map((el) => {
          const r = el.getBoundingClientRect()
          return { x: r.left, y: r.top, w: r.width, h: r.height }
        })
      const lamps = [...document.querySelectorAll('.lamp')]
        .filter((el) => el.offsetParent !== null)
        .map((el) => ({ color: getComputedStyle(el).getPropertyValue('--c').trim(), on: el.getAttribute('aria-pressed') === 'true' }))
      const main = document.querySelector('main')
      const b = main ? main.getBoundingClientRect() : null
      const box = b ? { x: b.left, y: b.top, w: b.width, h: b.height } : undefined
      // The body's own height, not the document's: a root's scrollHeight is never
      // less than the frame's, so the frame could then only ever grow.
      const height = Math.ceil(document.body.getBoundingClientRect().bottom)
      window.parent.postMessage({ type: 'skin:layout', height, box, fields, lamps, off: document.body.hidden }, '*')
    }, 50)
  }
  new ResizeObserver(tell).observe(document.body)
  new MutationObserver(tell).observe(document.body, { attributes: true, subtree: true, attributeFilter: ['hidden', 'style', 'aria-pressed'] })
  window.addEventListener('load', tell)
  window.addEventListener('message', (e) => {
    if (!TRUSTED.test(e.origin) || !e.data || e.data.type !== 'skin:tap') return
    const el = document.elementFromPoint(e.data.x, e.data.y)
    const lamp = el?.closest('.lamp')
    if (lamp) {
      lamp.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: e.data.x, clientY: e.data.y }))
      return
    }
    const press = el?.closest('button, input')
    if (press instanceof HTMLInputElement) press.focus()
    else if (press instanceof HTMLElement) press.click()
  })
  tell()
}
