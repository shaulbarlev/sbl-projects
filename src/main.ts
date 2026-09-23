import '@hackernoon/pixel-icon-library/fonts/iconfont.css'
import './style.css'
import { openCard, type Card } from './card'
import { h } from './dom'
import { NARROW, WIDE, scatter } from './layout'
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
/** Notes that sit beside an island, keyed by the island */
const notes = new Map<string, HTMLElement>()
/** The project card open on the map, if any */
let card: Card | null = null

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
      ({ height, lamps }) => {
        if (lamps) {
          map.setLamps(island.id, lamps)
          showState(lamps)
        }
        const at = world.islands.find((t) => t.id === island.id)
        if (!at || Math.abs(at.h - height) <= 2) return
        at.h = height
        el.style.height = `${height}px`
        place()
        map.redraw()
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

const layout = () =>
  scatter(
    PROJECTS.map((p) => p.id),
    links.map((a) => a.dataset.id!),
    ISLANDS,
    narrow.matches ? NARROW : WIDE,
  )
let world = layout()
const placed = () => [...world.links, ...world.tiles, ...world.islands]

function place() {
  plane.style.width = `${world.w}px`
  plane.style.height = `${world.h}px`
  homeEl.style.left = `${world.home.x}px`
  homeEl.style.top = `${world.home.y}px`
  homeEl.style.width = `${world.home.w}px`
  for (const t of placed()) {
    const a = tiles.get(t.id)
    if (a) Object.assign(a.style, { left: `${t.x}px`, top: `${t.y}px`, width: `${t.w}px`, height: t.w === t.h ? '' : `${t.h}px` })
    // A note sits just right of its island, its middle on the island's middle.
    const note = notes.get(t.id)
    if (note) Object.assign(note.style, { left: `${t.x + t.w + 12}px`, top: `${t.y + Math.round(t.h / 2)}px` })
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
  world = layout()
  place()
  map.setWorld(world)
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
  document.body.classList.toggle('has-project', project !== undefined)
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
      onFolding: () => document.body.classList.remove('has-project'),
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
  // Reading lock only while a card is open
  map.lock(card !== null)
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
  if (document.body.classList.contains('has-project')) {
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
function adoptLegacyHash() {
  const project = findProject(location.hash.slice(1))
  if (project) history.replaceState(null, '', `/${project.id}/`)
  sync()
}
window.addEventListener('hashchange', adoptLegacyHash)

adoptLegacyHash()

// --- opening: the whole field at a glance while the tiles scatter out from
// home, then the camera pushes in. Once a session, and never over a project.
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches
if (current === null && !calm && !sessionStorage.getItem('intro')) {
  sessionStorage.setItem('intro', '1')
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
  const pushIn = setTimeout(() => map.goHome(1100), 700)
  setTimeout(() => plane.classList.remove('intro-run'), 1800)
  // The visitor's first move wins over the choreography.
  for (const type of ['pointerdown', 'wheel', 'keydown'] as const) {
    window.addEventListener(type, () => clearTimeout(pushIn), { once: true, capture: true })
  }
} else if (current === null) {
  map.goHome(0)
}
