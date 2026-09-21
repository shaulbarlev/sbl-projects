import { h } from './dom'
import { openLightbox } from './lightbox'
import type { Project, ProjectMediaItem } from './projects'
// simple-icons (CC0)
import whatsappIcon from './icons/whatsapp.svg?raw'

const HEBREW = /[\u0590-\u05FF]/

/** Splits a description into its Hebrew and non-Hebrew lines, blank lines kept in both. */
function splitByScript(text: string) {
  const he: string[] = []
  const en: string[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) {
      he.push('')
      en.push('')
    } else (HEBREW.test(line) ? he : en).push(line)
  }
  return { he: he.join('\n').trim(), en: en.join('\n').trim() }
}

/** Blank-line separated paragraphs; a line starting with `## ` is a heading. */
function prose(text: string): HTMLElement[] {
  const out: HTMLElement[] = []
  let para: string[] = []
  const flush = () => {
    const body = para.join('\n').trim()
    if (body) out.push(h('p', {}, body))
    para = []
  }
  for (const line of text.split('\n')) {
    if (line.startsWith('## ')) {
      flush()
      out.push(h('h3', {}, line.slice(3).trim()))
    } else if (!line.trim()) flush()
    else para.push(line)
  }
  flush()
  return out
}

function mediaGrid(project: Project, media: ProjectMediaItem[]) {
  const images = media.filter((m) => m.type === 'image')
  const slides = images.map((m) => ({ src: m.src, alt: m.alt }))
  const firstVideo = media.find((m) => m.type === 'video')

  const cells = media.map((item, i) => {
    // A single item, or the last of an odd count, gets the full row.
    const lone = media.length === 1 || (media.length % 2 === 1 && i === media.length - 1)

    if (item.type === 'image') {
      const n = images.indexOf(item)
      const img = h('img', { src: item.src, alt: item.alt, loading: 'lazy' })
      const btn = h(
        'button',
        { type: 'button', 'aria-label': `View image ${n + 1} of ${images.length} full size` },
        img,
      )
      btn.addEventListener('click', () => openLightbox(slides, n))
      return h('figure', { class: `cell image${lone ? ' lone' : ''}${item.objectFit === 'contain' ? ' contain' : ''}` }, btn)
    }

    const cls = `cell video ${item.orientation === 'horizontal' ? 'horizontal' : 'vertical'}${lone ? ' lone' : ''}`
    if (item.kind === 'embed') {
      return h(
        'div',
        { class: cls },
        h('iframe', {
          src: item.src,
          title: item.title ?? `${project.title} video`,
          allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share',
          referrerpolicy: 'strict-origin-when-cross-origin',
          allowfullscreen: true,
        }),
      )
    }
    const video = h(
      'video',
      // With a poster to show, nothing is fetched until play: this is mostly read on phones.
      { controls: true, preload: item === firstVideo || !item.thumbnail ? 'metadata' : 'none', playsinline: true, poster: item.thumbnail },
      h('source', { src: item.src, type: 'video/mp4' }),
    )
    // Set as properties: the muted attribute is ignored on script-created videos.
    video.muted = item === firstVideo || project.muteAll === true
    video.autoplay = item === firstVideo
    return h('div', { class: cls }, video)
  })

  return h('div', { class: 'media' }, ...cells)
}

/** The project view: a modal over the map on wide screens, a page of its own on narrow ones. */
export function renderProject(
  project: Project,
  around: { prev: Project; next: Project },
  onClose: () => void,
  onNavigate: (to: Project) => void,
): HTMLElement {
  const { he, en } = splitByScript(project.description ?? '')

  const back = h('a', { class: 'pv-back', href: '/' }, '← map')
  const close = h('button', { class: 'pv-close', type: 'button', 'aria-label': 'Close' }, h('i', { class: 'hn hn-times', 'aria-hidden': 'true' }))
  const backdrop = h('div', { class: 'pv-backdrop' })
  for (const el of [back, close, backdrop]) {
    el.addEventListener('click', (e) => {
      e.preventDefault()
      onClose()
    })
  }

  let cta: HTMLElement | null = null
  if (project.cta) {
    const link = h('a', { class: 'cta', href: project.cta.href, target: '_blank', rel: 'noreferrer' })
    link.innerHTML = whatsappIcon
    link.append(h('span', {}, project.cta.label))
    cta = h('div', { class: 'box sans', dir: project.cta.rtl ? 'rtl' : undefined }, h('p', { class: 'cta-lead' }, project.cta.lead), link)
  }

  const text = h(
    'aside',
    { class: 'pv-text' },
    project.asideImage && h('div', { class: 'box' }, h('img', { src: project.asideImage.src, alt: project.asideImage.alt, loading: 'lazy' })),
    cta,
    he && h('div', { class: 'box sans prose', dir: 'rtl' }, ...prose(he)),
    en && h('div', { class: 'box prose' }, ...prose(en)),
  )

  const step = (to: Project, cls: string, text: string) => {
    const a = h('a', { class: cls, href: `/${to.id}/` }, h('small', {}, text), h('span', {}, to.title))
    a.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey) return
      e.preventDefault()
      onNavigate(to)
    })
    return a
  }
  const more = h(
    'nav',
    { class: 'pv-more', 'aria-label': 'More projects' },
    step(around.prev, 'pv-prev', '← previous'),
    step(around.next, 'pv-next', 'next →'),
  )

  return h(
    'div',
    { class: 'pv', role: 'dialog', 'aria-modal': 'true', 'aria-label': `${project.title} details` },
    backdrop,
    h(
      'article',
      { class: 'pv-panel', tabindex: -1 },
      h(
        'header',
        { class: 'pv-head' },
        back,
        h('div', { class: 'pv-title' }, h('h2', {}, project.title), project.subtitle && h('p', {}, project.subtitle)),
        close,
      ),
      h(
        'div',
        { class: `pv-body${project.textFirst ? ' text-first' : ''}` },
        project.media?.length ? mediaGrid(project, project.media) : null,
        text,
        more,
      ),
    ),
  )
}
