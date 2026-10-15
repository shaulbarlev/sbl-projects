import '@hackernoon/pixel-icon-library/fonts/iconfont.css'
import './style.css'
import { openCard, type Card } from './card'
import { h } from './dom'
import { NARROW, WIDE, scatter, type Rect, type Tile } from './layout'
import { closeLightbox, lightboxOpen } from './lightbox'
import { animateLogo } from './logo'
import { createMap } from './map'
import { renderProject } from './project'
import { CATEGORIES, ISLANDS, PROJECTS, REEL, categoryOf, categoryPath, displayPictures, edgesUrl, findProject, thumbUrl, type Project } from './projects'
import { createReel } from './reel'
import { host as embedHost } from '../shared/embed.js'

const SITE_TITLE = document.title
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

// --- the map: phones get their own, denser layout
const narrow = matchMedia('(max-width: 699px)')
const plane = $('plane')
const homeEl = $('home')
const homeButton = $('home-button')
const backButton = $('back-node')
const tiles = new Map<string, HTMLElement>()

// Two layers on the one plane, panned together. The root (wordmark, categories,
// contact links, islands) sinks back and dims while a category is open; the open
// category's children, and the threads that tie them to it, are in front.
const rootLayer = h('div', { class: 'layer root-layer' })
const dim = h('div', { class: 'dim' })
// Children are made folded, and with no transitions until the first frame has drawn: made
// visible and folded after, they played their fold on load (the reel's tile flew off screen).
const frontLayer = h('div', { class: 'layer front-layer snap' })
requestAnimationFrame(() => requestAnimationFrame(() => frontLayer.classList.remove('snap')))
const SVG = 'http://www.w3.org/2000/svg'
const threads = document.createElementNS(SVG, 'svg')
threads.setAttribute('class', 'threads')
threads.setAttribute('aria-hidden', 'true')
frontLayer.append(h('div', { class: 'card-dim' }))
rootLayer.append(homeEl, dim)
// The threads go under everything: behind the categories (and the dim over them) and behind the children.
plane.append(threads, rootLayer, frontLayer)
/** Notes that sit beside an island, keyed by the island; and where the island's content sits inside it */
const notes = new Map<string, HTMLElement>()
const boxes = new Map<string, { x: number; y: number; w: number; h: number }>()
/** The project card open on the map, if any */
let card: Card | null = null
/** Islands taken off the map for now (the light's master switch is off), with their place kept */
const shelved = new Map<string, Tile>()

// The contact links are written in the page under the wordmark, and become the
// small tiles nearest to it.
const links = [...document.querySelectorAll<HTMLAnchorElement>('.links a')]
for (const a of links) {
  a.classList.add('tile', 'link')
  tiles.set(a.dataset.id!, a)
  rootLayer.append(a)
}
document.querySelector('.links')?.remove()

// The categories: title-only tiles in a column under the wordmark. Each is a link to
// its own address, so it can be opened in a new tab, shared, and stepped back from.
for (const c of CATEGORIES) {
  // Liquid glass: a warped, blurred backdrop, a tint and a shine under the title (style.css).
  const a = h(
    'a',
    { class: 'tile category glass', href: categoryPath(c) },
    h('i', { class: 'glass-effect' }),
    h('i', { class: 'glass-tint' }),
    h('i', { class: 'glass-shine' }),
    h('span', {}, h('b', {}, c.title)),
  )
  a.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return
    e.preventDefault()
    goCategory(c.id)
  })
  tiles.set(c.id, a)
  rootLayer.append(a)
}

// The vfx category's one child opens into the reel where it stands. The category itself
// lives at /reel/; opening the player does not change the address.
const REEL_SLUG = 'reel'
// Its picture is the reel's own first seconds, looping; two lines of words under the title.
const reelLoop = h(
  'video',
  // Not autoplay: it loads and plays only when its category opens (unfold), as it is the whole reel.
  { class: 'loop', src: REEL.loop, poster: '/reel/start.jpg', loop: true, playsinline: true, preload: 'none', 'aria-hidden': 'true' },
)
reelLoop.muted = true // as a property: the attribute is ignored on script-made videos, and only silent ones play by themselves
const reelFace = h(
  'a',
  { class: 'tile child folded', href: REEL.src, target: '_blank', rel: 'noreferrer' },
  reelLoop,
  h('span', {}, h('b', {}, REEL.title)),
  h('p', { class: 'reel-note' }, REEL.note),
)
const reel = createReel(
  reelFace,
  (at) => {
    reelLoop.pause()
    map.fit(at)
  },
  (panned) => {
    void reelLoop.play().catch(() => {})
    // Shut on purpose, the map goes back to the category; panned away, it stays where it was taken.
    if (!panned && openCat) frameChildren(openCat)
  },
  () => narrow.matches,
)
tiles.set(REEL_SLUG, reel.el)
frontLayer.append(reel.el)

// Passive islands, out past the projects: a tap only brings one into view.
for (const island of ISLANDS) {
  let el: HTMLElement
  if (island.kind === 'frame') {
    // Loaded only once scrolled near: each open copy is a live socket to the light.
    const frame = h('iframe', { src: island.src, title: island.title, loading: 'lazy' })
    // Unseen until the page has drawn: a loading frame paints opaque for a moment.
    frame.addEventListener('load', () => frame.classList.add('drawn'))
    // The cover over the frame (shared/embed.js): a drag on it pans the map, a tap
    // reaches the page, and the page's reported height sizes the island.
    const cover = h('div', { class: 'cover' })
    el = h('div', { class: 'tile island frame' }, frame, cover)
    // Beside it, once the visitor has played for a few seconds: a word about what they are driving.
    const photo = island.note && h('img', { alt: '', loading: 'lazy' })
    const note = island.note && photo && h('aside', { class: 'note' }, h('p', {}, island.note.text), h('span', { class: 'photo' }, photo))
    // The photo of the light as it is right now: named by the lamps that are lit, in page order.
    const showState = (lamps: { on: boolean }[]) => {
      if (!island.note || !photo) return
      const lit = lamps.map((l) => l.on)
      const state = lit[0] && lit[1] ? 'both' : lit[0] ? 'green' : lit[1] ? 'orange' : 'off'
      const p = island.note.photos[state]
      if (p && photo.getAttribute('src') !== p.src) {
        photo.src = p.src
        photo.alt = p.alt
      }
    }
    if (note) {
      notes.set(island.id, note)
      rootLayer.append(note)
      showState([])
    }
    // The note appears three seconds after the first tap on the light.
    let tapped = false
    embedHost(
      frame,
      cover,
      ({ height, box, lamps, off }) => {
        // Switched off at home, the light is not there, minimap and all; back on, it returns.
        if (off !== undefined && off !== shelved.has(island.id)) {
          off ? shelve(island.id) : unshelve(island.id)
          map.redraw()
        }
        if (lamps) {
          map.setLamps(island.id, lamps)
          showState(lamps)
        }
        if (box) boxes.set(island.id, box)
        const at = world.islands.find((t) => t.id === island.id)
        if (!at) return
        // The peeking island is placed by what is drawn in it, not by its frame, which is wider:
        // the light's own left edge is what shows at the right of the home view. Once per
        // layout, from the first report: the page widens when its name field appears, and
        // the light must not move then.
        if (box && island.id === PEEK_ID && peeked !== at) {
          peeked = at
          const p = peek()
          at.x = Math.round(world.origin.x + p.view / 2 - p.px - box.x)
          el.style.left = `${at.x}px`
          map.redraw()
        }
        // The page reports on every lamp change; only a new size moves anything.
        if (Math.abs(at.h - height) > 2) {
          at.h = height
          el.style.height = `${height}px`
          map.redraw()
        }
        placeNote(at)
      },
      () => {
        if (tapped) return
        tapped = true
        setTimeout(() => note?.classList.add('shown'), 3000)
      },
    )
  } else {
    el = h(
      'button',
      { class: 'tile island', type: 'button', 'aria-label': island.alt },
      h('img', { src: island.src, alt: '', width: island.w, height: island.h, draggable: 'false', decoding: 'async', loading: 'lazy' }),
    )
    el.addEventListener('click', () => {
      const at = world.islands.find((t) => t.id === island.id)
      if (at) map.focus(at)
    })
  }
  tiles.set(island.id, el)
  rootLayer.append(el)
}

/** Takes an island off the map, its place kept; the element stays, hidden, so its page can still report */
function shelve(id: string) {
  const i = world.islands.findIndex((t) => t.id === id)
  if (i !== -1) shelved.set(id, world.islands[i])
  world.islands.splice(i, i === -1 ? 0 : 1)
  tiles.get(id)?.setAttribute('hidden', '')
  notes.get(id)?.setAttribute('hidden', '')
}
function unshelve(id: string) {
  const t = shelved.get(id)
  if (!t) return
  shelved.delete(id)
  world.islands.push(t)
  tiles.get(id)?.removeAttribute('hidden')
  notes.get(id)?.removeAttribute('hidden')
}

// The traffic light peeks in at the right of the landing view: its left edge, placed for
// the window's width at load (and again when the layout changes).
const PEEK_ID = 'traffic'
/** The layout's tile for it once placed by its content, so that it is placed only once per layout */
let peeked: Tile | null = null
const peek = () => ({ id: PEEK_ID, view: $('map').clientWidth || innerWidth, px: narrow.matches ? 44 : 72 })
const layout = () =>
  scatter(
    CATEGORIES,
    links.map((a) => a.dataset.id!),
    ISLANDS,
    narrow.matches ? NARROW : WIDE,
    peek(),
  )
let world = layout()
/** What is always on the map, and what only comes out with its category */
const placed = () => [...world.links, ...world.categories, ...world.islands]
const children = () => Object.values(world.children).flat()
const childRect = (id: string) => children().find((t) => t.id === id)

/** A note sits just right of what is drawn in its island, its middle on that content's middle */
function placeNote(t: Rect & { id: string }) {
  const note = notes.get(t.id)
  const box = boxes.get(t.id) ?? { x: 0, y: 0, w: t.w, h: t.h }
  if (note) Object.assign(note.style, { left: `${t.x + box.x + box.w + 10}px`, top: `${t.y + box.y + Math.round(box.h / 2)}px` })
}

/** Lays the world out: every tile to its place (an open card keeps its own) */
function place() {
  plane.style.width = `${world.w}px`
  plane.style.height = `${world.h}px`
  homeEl.style.left = `${world.home.x}px`
  homeEl.style.setProperty('--hx', `${world.home.x}px`)
  homeEl.style.setProperty('--hy', `${world.home.y}px`)
  homeEl.style.top = `${world.home.y}px`
  homeEl.style.width = `${world.home.w}px`
  threads.setAttribute('width', String(world.w))
  threads.setAttribute('height', String(world.h))
  for (const t of [...placed(), ...children()]) {
    const a = tiles.get(t.id)
    if (t.id === REEL_SLUG) continue
    if (a && !a.classList.contains('card')) Object.assign(a.style, { left: `${t.x}px`, top: `${t.y}px`, width: `${t.w}px`, height: t.w === t.h ? '' : `${t.h}px` })
    placeNote(t)
  }
  return reel.place(childRect(REEL_SLUG)!)
}

const map = createMap({
  viewport: $('map'),
  plane,
  minimap: $('minimap'),
  readout: $('readout'),
  markers: $('markers'),
  world,
  label: (id) => findProject(id)?.title ?? CATEGORIES.find((c) => c.id === id)?.title ?? (id === REEL_SLUG ? REEL.title : id),
  onHomeVisible: (visible) => (homeButton.hidden = visible),
  // The minimap stays out of the way until there is somewhere to have been.
  onExplore: () => document.body.classList.add('explored'),
  onView: (view) => {
    card?.check(view)
    reel.check(view)
  },
  onBreak: () => card?.close(),
  gridFollower: $('logo'),
})

// A light's lamps show on the minimap dim until its page reports them lit or not.
for (const island of ISLANDS) {
  if (island.kind === 'frame' && island.lamps) map.setLamps(island.id, island.lamps.map((color) => ({ color, on: false })))
}

narrow.addEventListener('change', () => {
  // A card open across the change (a phone turned sideways) is reopened on the new layout.
  const open = card
  card = null
  open?.close(true)
  world = layout()
  for (const id of [...shelved.keys()]) shelve(id)
  const player = place()
  map.setWorld(world)
  // A category open across it stays open, its grid and threads where the new layout puts them,
  // and the camera goes back to the grid (setWorld left it at home), the root sinking about it.
  if (openCat) {
    sinkAt = frameChildren(openCat)
    rootLayer.style.transformOrigin = `${sinkAt.x}px ${sinkAt.y}px`
    tie(openCat, false)
    map.setTiles(world.children[openCat])
  }
  sync()
  // The reel stays open across it, playing, so the map goes back to it.
  if (player) map.fit(player)
})

// True while focus is moving by Tab, as opposed to a click or a restored focus.
let tabbing = false
window.addEventListener('keydown', (e) => (tabbing = e.key === 'Tab'), true)
window.addEventListener('pointerdown', () => (tabbing = false), true)

/** A tile's picture as a silent loop, its still the poster until it plays */
function tileLoop(project: Project) {
  // Not autoplay: it loads and plays only when its category opens (unfold); the still shows until then.
  const v = h('video', { class: 'face', src: project.tileVideo, poster: thumbUrl(project), loop: true, playsinline: true, preload: 'none', 'aria-label': project.thumbnail.alt })
  v.muted = true // as a property: the attribute is ignored on script-made videos, and only silent ones play by themselves
  return v
}

let opener: HTMLElement | null = null
for (const project of PROJECTS) {
  const a = h(
    'a',
    { class: 'tile child folded', href: `/${project.id}/`, inert: true },
    project.tileVideo ? tileLoop(project) : h('img', { src: thumbUrl(project), alt: project.thumbnail.alt, width: 640, height: 640, draggable: 'false', decoding: 'async' }),
    // The edge drawing lies over the photo and shows through while the card is open.
    h('img', { class: 'edges', src: edgesUrl(project), alt: '', width: 640, height: 640, draggable: 'false', decoding: 'async', loading: 'lazy' }),
    h('span', {}, h('b', {}, project.title)),
  )
  a.addEventListener('click', (e) => {
    // Once open, the card's own links (previous / next, a call to action) and buttons are
    // theirs: the close button's click has already folded the card by the time it gets here.
    // A button inside the card is still inside this link, though, and a click on it would
    // follow the link (a reload: the view and the route start over), so that is stopped here.
    const inner = (e.target as Element).closest('a, button')
    if (inner !== a) {
      if (inner?.tagName === 'BUTTON') e.preventDefault()
      return
    }
    if (e.metaKey || e.ctrlKey || e.shiftKey) return
    e.preventDefault()
    if (card?.id === project.id) return
    opener = a
    // Cards come and go by panning, so they leave no history entries behind.
    history.replaceState(history.state, '', a.href)
    sync()
  })
  // The map must not pan under a finger on a video's control bar (the bottom strip, where
  // the scrubber lives) or in the card's own scroller; a finger on the picture itself may.
  a.addEventListener('pointerdown', (e) => {
    if (!a.classList.contains('card')) return
    const target = e.target as Element
    const video = target.closest('video')
    if (target.closest('.scrolls') || (video && e.clientY > video.getBoundingClientRect().bottom - 56)) e.stopPropagation()
  })
  tiles.set(project.id, a)
  frontLayer.append(a)
}
for (const t of children()) fold1(tiles.get(t.id)!)
// --- warming up: a project's pictures are fetched before it is opened, so the
// page arrives with them. The first screenful when its tile scrolls into view,
// the rest the moment a finger lands on the tile.
const warmed = new Set<string>()
function warm(project: Project, count: number) {
  for (const src of displayPictures(project).slice(0, count)) {
    if (warmed.has(src)) continue
    warmed.add(src)
    new Image().src = src
  }
}
const onScreen = new IntersectionObserver((entries) => {
  for (const e of entries) {
    const project = e.isIntersecting && findProject((e.target as HTMLElement).dataset.project ?? '')
    if (project) warm(project, 3)
  }
})
for (const project of PROJECTS) {
  const a = tiles.get(project.id)!
  a.dataset.project = project.id
  a.addEventListener('pointerdown', () => warm(project, Infinity))
}
// Not during the opening, whose wide shot has every tile on screen at once.
setTimeout(() => tiles.forEach((a) => a.dataset.project && onScreen.observe(a)), 2500)

// Tabbing to a tile that is off screen brings it into view.
tiles.forEach((a, id) =>
  a.addEventListener('focusin', () => {
    const tile = [...placed(), ...children()].find((t) => t.id === id)
    if (tabbing && tile) map.focus(tile)
  }),
)
place()

/** Home is the root: an open category closes on the way there. */
function goHome() {
  if (openCat) closeCategory()
  else map.goHome()
}
homeButton.addEventListener('click', goHome)
const replayLogo = animateLogo($('logo'))
// A tap on the wordmark centres the map on it again (and replays its flicker).
$('logo').addEventListener('click', goHome)

// --- categories: one open at a time. Opening one sinks the root and shoots the
// children out of the category; they fold back into it when it closes.
let openCat: string | null = null
/** How far back the root sinks (its scale), about the point at the centre of the view when it did */
const SINK = 0.9
let sinkAt = { x: 0, y: 0 }
/** How long the children take to land: a card opened by link waits for them */
const UNFOLD_MS = 950

/**
 * How fast everything moves: 1 normally, 0.5 while a deep link arrives, so the
 * opening, the unfold and the card that a link plays through take half as long.
 * Scales the CSS (--pace), the map's flights and every timer here and in card.ts.
 */
let pace = 1
function setPace(p: number) {
  pace = p
  map.setPace(p)
  document.documentElement.style.setProperty('--pace', String(p))
}
let unfoldingTimer = 0
/** A category's tile as it looks with the root sunk: the middle of its foot, where its children come out of */
function mouth(id: string) {
  const t = world.categories.find((c) => c.id === id)!
  return { x: sinkAt.x + (t.x + t.w / 2 - sinkAt.x) * SINK, y: sinkAt.y + (t.y + t.h - sinkAt.y) * SINK }
}

/** A child put away at once, without animation: hidden, untabbable */
function fold1(el: HTMLElement) {
  el.classList.add('folded')
  el.inert = true
}

/** Each child's way back into (or out of) the category's mouth, and its place in the cascade */
function aim(id: string, reverse: boolean) {
  const from = mouth(id)
  const kids = world.children[id]
  kids.forEach((t, i) => {
    const el = tiles.get(t.id)!
    el.style.setProperty('--dx', `${from.x - (t.x + t.w / 2)}px`)
    el.style.setProperty('--dy', `${from.y - (t.y + t.h / 2)}px`)
    el.style.setProperty('--k', String(reverse ? kids.length - 1 - i : i))
  })
  return kids
}

/** The threads from the category to each child, drawn out with the cascade (or at once) */
function tie(id: string, animate: boolean) {
  const from = mouth(id)
  const paths = world.children[id].map((t, i) => {
    const p = document.createElementNS(SVG, 'path')
    p.setAttribute('d', `M${from.x} ${from.y}L${t.x + t.w / 2} ${t.y}`)
    p.setAttribute('pathLength', '1')
    p.style.setProperty('--k', String(i))
    return p
  })
  threads.replaceChildren(...paths)
  if (animate) void threads.getBoundingClientRect()
  paths.forEach((p) => p.classList.add('on'))
}
function untie() {
  const paths = [...threads.children] as SVGPathElement[]
  paths.forEach((p, i) => {
    p.style.setProperty('--k', String(paths.length - 1 - i))
    p.classList.remove('on')
  })
}

function unfold(id: string) {
  if (!openCat) {
    sinkAt = map.camera()
    rootLayer.style.transformOrigin = `${sinkAt.x}px ${sinkAt.y}px`
  }
  openCat = id
  rootLayer.classList.add('sunk')
  tiles.get(id)?.classList.add('current')
  const kids = aim(id, false)
  // Tile loops start over each time their category opens.
  for (const t of kids)
    for (const v of tiles.get(t.id)!.querySelectorAll<HTMLVideoElement>('video.face, video.loop')) {
      v.currentTime = 0
      void v.play().catch(() => {})
    }
  // Start from the mouth with no transition, then let go: the cascade runs from there.
  frontLayer.classList.add('snap')
  for (const t of kids) tiles.get(t.id)!.classList.add('folded')
  void frontLayer.offsetWidth
  frontLayer.classList.remove('snap')
  frontLayer.classList.add('unfolding')
  for (const t of kids) {
    const el = tiles.get(t.id)!
    el.classList.remove('folded')
    el.inert = false
  }
  clearTimeout(unfoldingTimer)
  unfoldingTimer = window.setTimeout(() => frontLayer.classList.remove('unfolding'), (UNFOLD_MS + 300) * pace)
  tie(id, true)
  map.setTiles(kids)
  frameChildren(id)
}

function fold(id: string) {
  // Cut short a cascade still running, so the fold uses its own timing, not the unfold's.
  clearTimeout(unfoldingTimer)
  frontLayer.classList.remove('unfolding')
  tiles.get(id)?.classList.remove('current')
  for (const t of aim(id, true)) {
    fold1(tiles.get(t.id)!)
    // Tile loops stop with their category; they start over when it opens again.
    tiles.get(t.id)!.querySelectorAll<HTMLVideoElement>('video.face, video.loop').forEach((v) => v.pause())
  }
  untie()
  openCat = null
}

/** The camera to the open grid: all of it if it fits, else its top, read by panning down. Returns where it flies to. */
function frameChildren(id: string) {
  const parent = world.categories.find((c) => c.id === id)!
  const label = (narrow.matches ? NARROW : WIDE).label
  // Room above the category for the back node, fixed at the top of the screen.
  const rects = [{ ...parent, y: parent.y - 56 }, ...world.children[id].map((t) => ({ ...t, h: t.h + label }))]
  const x = Math.min(...rects.map((r) => r.x))
  const y = Math.min(...rects.map((r) => r.y))
  const w = Math.max(...rects.map((r) => r.x + r.w)) - x
  const h = Math.max(...rects.map((r) => r.y + r.h)) - y
  const { w: vw, h: vh } = map.viewport()
  const m = 24
  const whole = Math.min(1, (vw - 2 * m) / w, (vh - 2 * m) / h)
  const z = whole >= 0.7 ? whole : Math.min(1, (vw - 2 * m) / w)
  const to = whole >= 0.7 ? { x: x + w / 2, y: y + h / 2 } : { x: x + w / 2, y: y + (vh / 2 - m) / z }
  map.go({ ...to, z }, 700)
  return to
}

/** Opening a category is a step in history, so the back gesture closes it; switching between two replaces it. */
const CAT_STATE = { category: true }
function goCategory(id: string) {
  if (openCat === id) return closeCategory()
  const path = categoryPath(CATEGORIES.find((c) => c.id === id)!)
  if (history.state?.category) history.replaceState(CAT_STATE, '', path)
  else history.pushState(CAT_STATE, '', path)
  sync()
}
function closeCategory() {
  if (history.state?.category) history.back()
  else {
    history.replaceState(null, '', '/')
    sync()
  }
}
backButton.addEventListener('click', closeCategory)
// A click outside an open card folds it, and does nothing else: not open the tile it landed on.
// A drag that ends in a click has already been marked by map.ts (defaultPrevented).
$('map').addEventListener(
  'click',
  (e) => {
    // (A card already folding, from a pan away, is left to finish: no flight back to the grid.)
    if (!card || card.folding || e.defaultPrevented || (e.target as Element).closest('.tile.card')) return
    e.preventDefault()
    e.stopPropagation()
    closeProject()
  },
  true,
)
// A tap on nothing in particular closes the open category (a drag that ends never gets here: map.ts swallows its click).
$('map').addEventListener('click', (e) => {
  if (!openCat || card) return
  if ((e.target as Element).closest('a, button, .tile, .note, .home, iframe')) return
  closeCategory()
})

// --- routing: "/" is the map, "/<category>/" opens a category, "/<project>/" opens
// its category and that project's card; visual effects is at "/reel/" ("/vfx/" is rewritten to it),
// and its player, opened by a tap, has no address of its own
let current: string | null = null
const slugNow = () => location.pathname.split('/').filter(Boolean)[0]?.replace(/\.html$/, '') ?? ''
const later = (ms: number, fn: () => void) => (ms ? window.setTimeout(fn, ms) : fn())

function sync() {
  const slug = slugNow()
  const project = findProject(slug)
  const cat = categoryOf(project?.id ?? slug) ?? null
  // A category reached by its id where it has an address of its own (/vfx/): the address it has.
  if (cat && !project && location.pathname !== categoryPath(cat)) history.replaceState(history.state, '', categoryPath(cat))
  closeLightbox()
  document.title = project ? `${project.title} — shaul bar-lev` : cat ? `${cat.title} — shaul bar-lev` : SITE_TITLE
  let wait = 0
  if ((cat?.id ?? null) !== openCat) {
    // Whatever was open inside the old category goes with it, at once.
    if (card) {
      const open = card
      card = null
      open.close(true)
    }
    if (reel.isOpen) reel.close()
    if (openCat) fold(openCat)
    if (cat) {
      unfold(cat.id)
      wait = UNFOLD_MS * pace
    } else {
      rootLayer.classList.remove('sunk')
      map.setTiles(world.categories)
      // Every way out of a category ends at home, as the landing showed it, the name flickering as it does there.
      map.goHome(600)
      replayLogo()
    }
  }
  backButton.hidden = cat === null
  later(wait, syncCard)
}

/** The project card follows the address; it waits for its category's children to land. */
function syncCard() {
  const project = findProject(slugNow())
  if (card && card.id !== project?.id) {
    card.close()
    card = null
  }
  const at = project && childRect(project.id)
  if (project && at && !card) {
    const siblings = (categoryOf(project.id)?.children ?? []).map((id) => findProject(id)).filter((p): p is Project => p !== undefined)
    const i = siblings.indexOf(project)
    const around = {
      prev: siblings[(i - 1 + siblings.length) % siblings.length],
      next: siblings[(i + 1) % siblings.length],
    }
    const opened = openCard({
      id: project.id,
      tile: tiles.get(project.id)!,
      at,
      map,
      narrow: narrow.matches,
      plane,
      world,
      // No tile to grow from (reached by history, forward onto a card's address): cut straight to it.
      // A deep link sets `opener` to its tile, so it grows.
      cut: current === null && opener === null,
      pace: () => pace,
      content: () =>
        renderProject(project, around, closeProject, (to) => {
          // Moving between projects replaces the entry, so back still returns to the map.
          history.replaceState(history.state, '', `/${to.id}/`)
          opener = tiles.get(to.id) ?? null
          sync()
        }),
      // Lock and chrome are released as the fold starts; sync() decides again at its end,
      // so previous / next (a close and an open in one pass) leaves them on.
      onFolding: () => {
        map.lock(false)
        document.body.classList.remove('has-project')
      },
      onClosed: () => {
        if (card !== opened) return
        card = null
        // Folded by panning away: the address follows, the camera stays where it was taken.
        // (Compared by project, so an alias like /pikud counts.)
        if (findProject(slugNow())?.id === project.id) closeProject(true)
      },
    })
    card = opened
  }
  if (!project) {
    opener?.focus({ preventScroll: true })
    opener = null
  }
  // The reading lock and the map's chrome follow whether a card is open.
  map.lock(card !== null)
  document.body.classList.toggle('has-project', card !== null)
  current = project?.id ?? null
}

/** Back to the category the project is in, not out of it, and (shut on purpose) to the view of it */
function closeProject(panned = false) {
  const open = CATEGORIES.find((c) => c.id === openCat)
  history.replaceState(history.state, '', open ? categoryPath(open) : '/')
  sync()
  if (!panned && openCat) frameChildren(openCat)
}

window.addEventListener('popstate', () => sync())

window.addEventListener('keydown', (e) => {
  // The image viewer has its own keys, and Esc there must not close the project too.
  if (lightboxOpen() || e.metaKey || e.ctrlKey || e.altKey) return
  if (card && !card.folding) {
    if (e.key === 'Escape') closeProject()
    return
  }
  const step = 180
  const keys: Record<string, () => void> = {
    Escape: () => (reel.isOpen ? reel.close() : openCat && closeCategory()),
    ArrowLeft: () => map.panBy(-step, 0),
    ArrowRight: () => map.panBy(step, 0),
    ArrowUp: () => map.panBy(0, -step),
    ArrowDown: () => map.panBy(0, step),
    '+': () => map.zoomBy(1.25),
    '=': () => map.zoomBy(1.25),
    '-': () => map.zoomBy(0.8),
    '0': goHome,
    Home: goHome,
  }
  const action = keys[e.key]
  // Escape with nothing open is the browser's.
  if (e.key === 'Escape' && !reel.isOpen && !openCat) return
  if (!action) return
  e.preventDefault()
  action()
})

// Links shared before the map existed look like /#doorlock.
window.addEventListener('hashchange', () => {
  const project = findProject(location.hash.slice(1))
  if (project) history.replaceState(null, '', `/${project.id}/`)
  sync()
})
const legacy = findProject(location.hash.slice(1))
if (legacy) history.replaceState(null, '', `/${legacy.id}/`)

/**
 * The opening: the whole field at a glance while the tiles scatter out from
 * home, then the camera pushes in, to the wordmark or, for a link to a project,
 * to that project's tile, whose card then grows. The visitor's first move wins
 * over the choreography and skips to the end.
 */
function opening(at: Rect | null, then: () => void) {
  // The children are folded away; only what is always there takes part.
  placed().forEach((t, i) => {
    const a = tiles.get(t.id)!
    a.style.setProperty('--dx', `${world.home.x + world.home.w / 2 - (t.x + t.w / 2)}px`)
    a.style.setProperty('--dy', `${world.home.y + world.home.h / 2 - (t.y + t.h / 2)}px`)
    a.style.setProperty('--i', String(i))
  })
  plane.classList.add('intro')
  map.overview()
  void plane.offsetWidth // commit the gathered state before it is released with a transition
  plane.classList.add('intro-run')
  plane.classList.remove('intro')
  // (the map paces its own flights; the waits here are paced by hand)
  const pushIn = setTimeout(() => (at ? map.go({ x: at.x + at.w / 2, y: at.y + at.h / 2, z: 1 }, 1100) : map.goHome(1100)), 700 * pace)
  // A linked project starts growing while the camera is still settling on it.
  const arrive = setTimeout(() => {
    stop()
    then()
  }, (at ? 1400 : 1900) * pace)
  setTimeout(() => plane.classList.remove('intro-run'), 1800 * pace)
  const inputs = ['pointerdown', 'wheel', 'keydown'] as const
  function stop() {
    clearTimeout(pushIn)
    clearTimeout(arrive)
    inputs.forEach((type) => window.removeEventListener(type, skip, true))
  }
  function skip(e: Event) {
    stop()
    // A key: after it, so that Escape does not also act on what `then` opens. A pointer or a wheel:
    // now, before the map handles the same event, so the flights `then` starts are cut by it and
    // the visitor's move wins.
    if (e.type === 'keydown') setTimeout(then, 0)
    else then()
  }
  inputs.forEach((type) => window.addEventListener(type, skip, { capture: true }))
}

/**
 * An island with a gate asks whether it exists right now (the traffic light's
 * master switch). Off, it is taken off the map, minimap and all.
 */
async function gated(): Promise<Set<string>> {
  const gone = new Set<string>()
  await Promise.all(
    ISLANDS.filter((i) => i.kind === 'frame' && i.gate).map(async (i) => {
      if (i.kind !== 'frame' || !i.gate) return
      try {
        const state = (await (await fetch(i.gate, { cache: 'no-store' })).json()) as { enabled?: boolean }
        if (state.enabled === false) gone.add(i.id)
      } catch {
        // Unknown: leave it on the map.
      }
    }),
  )
  // Off from the start, its page is never loaded: it is back on the next visit.
  for (const id of gone) {
    shelve(id)
    tiles.get(id)?.remove()
    notes.get(id)?.remove()
  }
  if (gone.size) map.redraw()
  return gone
}

const calm = matchMedia('(prefers-reduced-motion: reduce)').matches
const slug = slugNow()
const linked = findProject(slug)
const linkedCat = categoryOf(linked?.id ?? slug)
const anchored = ISLANDS.find((i) => i.kind === 'frame' && i.path === slug)
if (linkedCat) {
  // Arrived inside a category: the map goes under it in history, so back lands on the map, not off the site.
  const path = location.pathname
  history.replaceState(null, '', '/')
  history.pushState(CAT_STATE, '', path)
  void gated()
  const at = world.categories.find((t) => t.id === linkedCat.id)!
  const arrive = () => {
    opener = linked ? (tiles.get(linked.id) ?? null) : null
    sync()
    // Back to normal speed once the children have landed and the card, if any, has grown.
    if (pace !== 1) setTimeout(() => setPace(1), (UNFOLD_MS + 600) * pace)
  }
  // The field, the flight to its category, the children out of it, and then the card if the
  // link is to a project: at double speed, as the visitor came for what the link points at.
  if (!calm) {
    setPace(0.5)
    opening(at, arrive)
  }
  else {
    map.focus(at, 0)
    arrive()
  }
} else if (anchored) {
  // Arrived by a link to an island: the field, then the flight to it. Switched
  // off, the link is just the map.
  const gone = await gated()
  const at = world.islands.find((t) => t.id === anchored.id)
  if (at && !gone.has(anchored.id) && !calm) {
    setPace(0.5)
    // the flight to the island ends after the opening hands over; normal speed once it lands
    opening(at, () => setTimeout(() => setPace(1), 1100 * pace))
  }
  else if (at && !gone.has(anchored.id)) map.focus(at, 0)
  else map.goHome(0)
} else if (!calm) {
  // The opening plays on every visit.
  void gated()
  opening(null, () => {})
} else {
  void gated()
  map.goHome(0)
  sync()
}
