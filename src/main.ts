import '@hackernoon/pixel-icon-library/fonts/iconfont.css'
import './style.css'
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
  world,
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
    h('img', { src: thumbUrl(project), alt: project.thumbnail.alt, width: 640, height: 640, draggable: 'false' }),
    h('span', {}, project.title),
  )
  a.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return
    e.preventDefault()
    opener = a
    history.pushState({ fromMap: true }, '', a.href)
    sync()
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

// --- routing: "/" is the map, "/<project>/" shows a project over (or instead of) it
const projectRoot = $('project')

function sync() {
  const slug = location.pathname.split('/').filter(Boolean)[0]?.replace(/\.html$/, '') ?? ''
  const project = findProject(slug)
  closeLightbox()
  projectRoot.replaceChildren()
  document.body.classList.toggle('has-project', project !== undefined)
  document.title = project ? `${project.title} — shaul bar-lev` : SITE_TITLE
  if (project) {
    const view = renderProject(project, closeProject)
    projectRoot.append(view)
    window.scrollTo(0, 0)
    view.querySelector<HTMLElement>('.pv-panel')?.focus()
  } else {
    opener?.focus({ preventScroll: true })
    opener = null
  }
}

function closeProject() {
  if (history.state?.fromMap) history.back()
  else {
    // Arrived by direct link: there is no map entry to go back to.
    history.replaceState(null, '', '/')
    sync()
  }
}

window.addEventListener('popstate', sync)

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

map.goHome(0)
adoptLegacyHash()
