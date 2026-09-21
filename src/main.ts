import '@hackernoon/pixel-icon-library/fonts/iconfont.css'
import './style.css'
import { diveIn, diveOut } from './dive'
import { h } from './dom'
import { NARROW, WIDE, scatter } from './layout'
import { closeLightbox, lightboxOpen } from './lightbox'
import { animateLogo } from './logo'
import { createMap } from './map'
import { renderProject } from './project'
import { PROJECTS, displayPictures, findProject, thumbUrl, type Project } from './projects'

const SITE_TITLE = document.title
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

// --- the map: phones get their own, denser layout
const narrow = matchMedia('(max-width: 699px)')
const plane = $('plane')
const homeEl = $('home')
const homeButton = $('home-button')
const tiles = new Map<string, HTMLAnchorElement>()

// The contact links are written in the page under the wordmark, and become the
// small tiles nearest to it.
const links = [...document.querySelectorAll<HTMLAnchorElement>('.links a')]
for (const a of links) {
  a.classList.add('tile', 'link')
  tiles.set(a.dataset.id!, a)
  plane.append(a)
}
document.querySelector('.links')?.remove()

const layout = () =>
  scatter(
    PROJECTS.map((p) => p.id),
    links.map((a) => a.dataset.id!),
    narrow.matches ? NARROW : WIDE,
  )
let world = layout()
const placed = () => [...world.links, ...world.tiles]

function place() {
  plane.style.width = `${world.w}px`
  plane.style.height = `${world.h}px`
  homeEl.style.left = `${world.home.x}px`
  homeEl.style.top = `${world.home.y}px`
  homeEl.style.width = `${world.home.w}px`
  for (const t of placed()) {
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
  // The minimap stays out of the way until there is somewhere to have been.
  onExplore: () => document.body.classList.add('explored'),
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
    diveIn(picture(project.id), () => sync(false), playFirst)
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
  a.addEventListener('focus', () => {
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

// --- routing: "/" is the map, "/<project>/" shows a project over (or instead of) it
const projectRoot = $('project')
let current: string | null = null
const slugNow = () => location.pathname.split('/').filter(Boolean)[0]?.replace(/\.html$/, '') ?? ''

// In place of autoplay, so that a dive can hold it back: a decoder starting up under the zoom costs it frames.
const playFirst = () => void projectRoot.querySelector('video')?.play().catch(() => {})

function sync(play = true) {
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
    view.querySelector<HTMLElement>('.pv-panel')?.focus()
    markSeen(project.id)
    if (play) playFirst()
    // A tapped tile leaves the map exactly as it was, so closing returns to the
    // same view. Only when the project was reached some other way (a direct link,
    // previous / next) is the map brought to it, so that closing lands where it
    // lives; behind a phone's project page that is a cut.
    const tile = world.tiles.find((t) => t.id === project.id)
    if (tile && opener !== tiles.get(project.id)) map.focus(tile, narrow.matches ? 0 : undefined)
  } else {
    opener?.focus({ preventScroll: true })
    opener = null
  }
  current = project?.id ?? null
}

const picture = (id: string | null) => (id ? tiles.get(id)?.querySelector('img') ?? undefined : undefined)

function closeProject() {
  if (history.state?.fromMap) history.back()
  else {
    // Arrived by direct link: there is no map entry to go back to.
    history.replaceState(null, '', '/')
    diveOut(picture(current), sync)
  }
}

window.addEventListener('popstate', (e) => {
  // A back swipe on iOS is animated by the browser already; and only leaving a project has a picture to follow.
  diveOut(e.hasUAVisualTransition ? undefined : picture(current), sync)
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
