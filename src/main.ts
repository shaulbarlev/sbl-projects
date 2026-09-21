import '@hackernoon/pixel-icon-library/fonts/iconfont.css'
import './style.css'
import { diveIn, diveOut } from './dive'
import { h } from './dom'
import { NARROW, WIDE, scatter } from './layout'
import { closeLightbox, lightboxOpen } from './lightbox'
import { animateLogo } from './logo'
import { createMap } from './map'
import { renderProject } from './project'
import { PROJECTS, findProject, thumbUrl } from './projects'

const SITE_TITLE = document.title
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

// --- the map: phones get their own, denser layout
const narrow = matchMedia('(max-width: 699px)')
const layout = () => scatter(PROJECTS.map((p) => p.id), narrow.matches ? NARROW : WIDE)
let world = layout()

const plane = $('plane')
const homeEl = $('home')
const homeButton = $('home-button')
const tiles = new Map<string, HTMLAnchorElement>()

function place() {
  plane.style.width = `${world.w}px`
  plane.style.height = `${world.h}px`
  homeEl.style.left = `${world.home.x}px`
  homeEl.style.top = `${world.home.y}px`
  homeEl.style.width = `${world.home.w}px`
  for (const t of world.tiles) {
    const a = tiles.get(t.id)
    if (a) Object.assign(a.style, { left: `${t.x}px`, top: `${t.y}px`, width: `${t.w}px` })
  }
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
})

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
    h('span', {}, project.title),
  )
  a.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return
    e.preventDefault()
    opener = a
    history.pushState({ fromMap: true }, '', a.href)
    diveIn(picture(project.id), sync)
  })
  // Tabbing to a tile that is off screen brings it into view.
  a.addEventListener('focus', () => {
    const tile = world.tiles.find((t) => t.id === project.id)
    if (tabbing && tile) map.focus(tile)
  })
  tiles.set(project.id, a)
  plane.append(a)
}
place()

homeButton.addEventListener('click', () => map.goHome())
animateLogo($('logo'))

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

// --- routing: "/" is the map, "/<project>/" shows a project over (or instead of) it
const projectRoot = $('project')
let current: string | null = null
const slugNow = () => location.pathname.split('/').filter(Boolean)[0]?.replace(/\.html$/, '') ?? ''

function sync() {
  const project = findProject(slugNow())
  closeLightbox()
  projectRoot.replaceChildren()
  document.body.classList.toggle('has-project', project !== undefined)
  document.title = project ? `${project.title} — shaul bar-lev` : SITE_TITLE
  if (project) {
    const i = PROJECTS.indexOf(project)
    const around = {
      prev: PROJECTS[(i - 1 + PROJECTS.length) % PROJECTS.length],
      next: PROJECTS[(i + 1) % PROJECTS.length],
    }
    const view = renderProject(project, around, closeProject, (to) => {
      // Moving between projects replaces the entry, so back still returns to the map.
      history.replaceState(history.state, '', `/${to.id}/`)
      opener = null
      sync()
    })
    projectRoot.append(view)
    window.scrollTo(0, 0)
    view.querySelector<HTMLElement>('.pv-panel')?.focus()
    markSeen(project.id)
    // Bring the map to this project, so that closing it lands where it lives. On a
    // phone the page hides the map, so that is a free cut; on a wide screen the map
    // shows behind the modal, so a tile that was just clicked is left where it is.
    const tile = world.tiles.find((t) => t.id === project.id)
    if (tile && narrow.matches) map.focus(tile, 0)
    else if (tile && opener !== tiles.get(project.id)) map.focus(tile)
  } else {
    opener?.focus({ preventScroll: true })
    opener = null
  }
  current = project?.id ?? null
}

const picture = (id: string | null) => (id ? tiles.get(id)?.querySelector('img') ?? undefined : undefined)

/** Back to the map from whatever project is showing, its picture shrinking back into its tile. */
function leave() {
  const from = current
  diveOut(sync, () => {
    // On a phone the map was hidden behind the page: have it measure itself before the tile is located.
    map.refresh()
    return current === null ? picture(from) : undefined
  })
}

function closeProject() {
  if (history.state?.fromMap) history.back()
  else {
    // Arrived by direct link: there is no map entry to go back to.
    history.replaceState(null, '', '/')
    leave()
  }
}

window.addEventListener('popstate', (e) => {
  // A back swipe on iOS is animated by the browser already; and only leaving a project is a dive.
  if (e.hasUAVisualTransition || current === null) sync()
  else leave()
})

window.addEventListener('keydown', (e) => {
  // The image viewer has its own keys, and Esc there must not close the project too.
  if (lightboxOpen() || e.metaKey || e.ctrlKey || e.altKey) return
  if (document.body.classList.contains('has-project')) {
    if (e.key === 'Escape') closeProject()
    return
  }
  const step = 180
  const keys: Record<string, () => void> = {
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
  world.tiles.forEach((t, i) => {
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
