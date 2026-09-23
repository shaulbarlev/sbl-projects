import '@hackernoon/pixel-icon-library/fonts/iconfont.css'
import './style.css'
import { openCard, type Card } from './card'
import { h } from './dom'
import { NARROW, WIDE, scatter, type Rect, type Tile } from './layout'
import { closeLightbox, lightboxOpen } from './lightbox'
import { animateLogo } from './logo'
import { createMap } from './map'
import { renderProject } from './project'
import { ISLANDS, PROJECTS, displayPictures, edgesUrl, findProject, thumbUrl, type Project } from './projects'
import { createReel } from './reel'
import { host as embedHost } from '../shared/embed.js'

const SITE_TITLE = document.title
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

// --- the map: phones get their own, denser layout
const narrow = matchMedia('(max-width: 699px)')
const plane = $('plane')
const homeEl = $('home')
const homeButton = $('home-button')
const tiles = new Map<string, HTMLElement>()
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
  plane.append(a)
}
document.querySelector('.links')?.remove()

// One of them is more than a link: the film & art tile opens into the reel where it stands.
const reel = createReel(tiles.get('film') as HTMLAnchorElement, (at) => map.fit(at))
tiles.set('film', reel.el)
plane.append(reel.el)

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
      plane.append(note)
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
  plane.append(el)
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

const layout = () =>
  scatter(
    PROJECTS.map((p) => p.id),
    links.map((a) => a.dataset.id!),
    ISLANDS,
    narrow.matches ? NARROW : WIDE,
  )
let world = layout()
const placed = () => [...world.links, ...world.tiles, ...world.islands]

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
  homeEl.style.top = `${world.home.y}px`
  homeEl.style.width = `${world.home.w}px`
  for (const t of placed()) {
    const a = tiles.get(t.id)
    if (a && !a.classList.contains('card')) Object.assign(a.style, { left: `${t.x}px`, top: `${t.y}px`, width: `${t.w}px`, height: t.w === t.h ? '' : `${t.h}px` })
    placeNote(t)
  }
  reel.place(world.links.find((t) => t.id === 'film')!)
}

const map = createMap({
  viewport: $('map'),
  plane,
  minimap: $('minimap'),
  readout: $('readout'),
  markers: $('markers'),
  world,
  label: (id) => findProject(id)?.title ?? id,
  onHomeVisible: (visible) => (homeButton.hidden = visible),
  // The minimap stays out of the way until there is somewhere to have been.
  onExplore: () => document.body.classList.add('explored'),
  onView: (view) => {
    card?.check(view)
    reel.check(view)
  },
  onBreak: () => card?.close(),
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
  place()
  map.setWorld(world)
  sync()
})

// True while focus is moving by Tab, as opposed to a click or a restored focus.
let tabbing = false
window.addEventListener('keydown', (e) => (tabbing = e.key === 'Tab'), true)
window.addEventListener('pointerdown', () => (tabbing = false), true)

let opener: HTMLElement | null = null
for (const project of PROJECTS) {
  const a = h(
    'a',
    { class: 'tile', href: `/${project.id}/` },
    h('img', { src: thumbUrl(project), alt: project.thumbnail.alt, width: 640, height: 640, draggable: 'false', decoding: 'async' }),
    // The edge drawing lies over the photo and shows through while the card is open.
    h('img', { class: 'edges', src: edgesUrl(project), alt: '', width: 640, height: 640, draggable: 'false', decoding: 'async', loading: 'lazy' }),
    h('span', {}, h('b', {}, project.title)),
  )
  a.addEventListener('click', (e) => {
    // Once open, the card's own links (previous / next, a call to action) are theirs.
    if ((e.target as Element).closest('a') !== a) return
    if (e.metaKey || e.ctrlKey || e.shiftKey) return
    e.preventDefault()
    if (card?.id === project.id) return
    opener = a
    // Cards come and go by panning, so they leave no history entries behind.
    history.replaceState(null, '', a.href)
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
  plane.append(a)
}
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
    const tile = placed().find((t) => t.id === id)
    if (tabbing && tile) map.focus(tile)
  }),
)
place()

homeButton.addEventListener('click', () => map.goHome())
animateLogo($('logo'))
// A tap on the wordmark centres the map on it again (and replays its flicker).
$('logo').addEventListener('click', () => map.goHome())

// --- what has been opened before: red marks the unexplored, on tiles, minimap and edge markers
const SEEN_KEY = 'seen'
const seen = new Set<string>(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]'))
function markSeen(id: string) {
  seen.add(id)
  localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]))
  tiles.get(id)?.classList.add('seen')
  map.markSeen(id)
}
seen.forEach(markSeen)

// --- routing: "/" is the map, "/<project>/" opens that project's card on it
let current: string | null = null
const slugNow = () => location.pathname.split('/').filter(Boolean)[0]?.replace(/\.html$/, '') ?? ''

function sync() {
  const project = findProject(slugNow())
  closeLightbox()
  document.title = project ? `${project.title} — shaul bar-lev` : SITE_TITLE
  if (card && card.id !== project?.id) {
    card.close()
    card = null
  }
  const at = project && world.tiles.find((t) => t.id === project.id)
  if (project && at && !card) {
    const i = PROJECTS.indexOf(project)
    const around = {
      prev: PROJECTS[(i - 1 + PROJECTS.length) % PROJECTS.length],
      next: PROJECTS[(i + 1) % PROJECTS.length],
    }
    const opened = openCard({
      id: project.id,
      tile: tiles.get(project.id)!,
      at,
      map,
      narrow: narrow.matches,
      plane,
      world,
      // Arrived by link: no growing from a tile the visitor has not seen.
      cut: current === null && opener === null,
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
        // Folded by panning away: the address follows.
        if (slugNow() === project.id) closeProject()
      },
    })
    card = opened
    markSeen(project.id)
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

function closeProject() {
  history.replaceState(null, '', '/')
  sync()
}

window.addEventListener('popstate', () => sync())

window.addEventListener('keydown', (e) => {
  // The image viewer has its own keys, and Esc there must not close the project too.
  if (lightboxOpen() || e.metaKey || e.ctrlKey || e.altKey) return
  if (card) {
    if (e.key === 'Escape') closeProject()
    return
  }
  const step = 180
  const keys: Record<string, () => void> = {
    Escape: () => reel.close(),
    ArrowLeft: () => map.panBy(-step, 0),
    ArrowRight: () => map.panBy(step, 0),
    ArrowUp: () => map.panBy(0, -step),
    ArrowDown: () => map.panBy(0, step),
    '+': () => map.zoomBy(1.25),
    '=': () => map.zoomBy(1.25),
    '-': () => map.zoomBy(0.8),
    '0': () => map.goHome(),
    Home: () => map.goHome(),
  }
  const action = keys[e.key]
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
  const pushIn = setTimeout(() => (at ? map.go({ x: at.x + at.w / 2, y: at.y + at.h / 2, z: 1 }, 1100) : map.goHome(1100)), 700)
  // A linked project starts growing while the camera is still settling on it.
  const arrive = setTimeout(() => {
    stop()
    then()
  }, at ? 1400 : 1900)
  setTimeout(() => plane.classList.remove('intro-run'), 1800)
  const inputs = ['pointerdown', 'wheel', 'keydown'] as const
  function stop() {
    clearTimeout(pushIn)
    clearTimeout(arrive)
    inputs.forEach((type) => window.removeEventListener(type, skip, true))
  }
  function skip() {
    stop()
    // After the event that skipped, so that a key (Escape) does not also act on what `then` opens.
    setTimeout(then, 0)
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
const linkedTile = linked && world.tiles.find((t) => t.id === linked.id)
const anchored = ISLANDS.find((i) => i.kind === 'frame' && i.path === slug)
if (linked && linkedTile && !calm) {
  // Arrived by a link to a project: the field, the flight to its tile, and the card growing from it.
  void gated()
  opening(linkedTile, () => {
    opener = tiles.get(linked.id) ?? null
    sync()
  })
} else if (anchored) {
  // Arrived by a link to an island: the field, then the flight to it. Switched
  // off, the link is just the map.
  const gone = await gated()
  const at = world.islands.find((t) => t.id === anchored.id)
  if (at && !gone.has(anchored.id) && !calm) opening(at, () => {})
  else if (at && !gone.has(anchored.id)) map.focus(at, 0)
  else map.goHome(0)
} else if (!calm && !sessionStorage.getItem('intro') && !linked) {
  sessionStorage.setItem('intro', '1')
  void gated()
  opening(null, () => {})
} else {
  void gated()
  if (!linked) map.goHome(0)
  sync()
}
