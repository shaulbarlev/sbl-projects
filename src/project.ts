import { h } from './dom'
import { openLightbox } from './lightbox'
import { displayUrl, thumbUrl, type Project, type ProjectMediaImage, type ProjectMediaItem, type ProjectMediaVideo } from './projects'
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
  const flat = media.flatMap((m) => (m.type === 'row' ? m.items : [m]))
  const images = flat.filter((m) => m.type === 'image')
  const slides = images.map((m) => ({ src: m.src, alt: m.alt }))
  const firstVideo = flat.find((m) => m.type === 'video' && !m.loop)
  const loose = media.filter((m) => m.type !== 'row')

  const cell = (item: ProjectMediaVideo | ProjectMediaImage, lone: boolean) => {
    if (item.type === 'image') {
      const n = images.indexOf(item)
      const img = h('img', { src: displayUrl(item.src), alt: item.alt, loading: 'lazy', decoding: 'async' })
      const btn = h(
        'button',
        { type: 'button', 'aria-label': `View image ${n + 1} of ${images.length} full size` },
        img,
      )
      btn.addEventListener('click', () => openLightbox(slides, n))
      return h('figure', { class: `cell image${lone ? ' lone' : ''}${item.objectFit === 'contain' ? ' contain' : ''}` }, btn)
    }

    const cls = `cell video ${item.orientation ?? 'vertical'}${lone ? ' lone' : ''}${item.loop ? ' loop' : ''}${item.size === 'medium' ? ' medium' : ''}${item.mockup ? ' mockup' : ''}`
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
    if (item.loop) {
      const video = h(
        'video',
        { autoplay: true, loop: true, playsinline: true, preload: 'auto', poster: item.thumbnail && displayUrl(item.thumbnail), 'aria-label': item.title ?? `${project.title} video` },
        h('source', { src: item.src, type: 'video/mp4' }),
      )
      // Set as a property: the muted attribute is ignored on script-created videos, and only silent ones may play by themselves.
      video.muted = true
      return h('div', { class: cls }, video)
    }
    const video = h(
      'video',
      // With a poster to show, nothing is fetched until play: this is mostly read on phones.
      { controls: true, preload: item === firstVideo || !item.thumbnail ? 'metadata' : 'none', playsinline: true, poster: item.thumbnail && displayUrl(item.thumbnail) },
      h('source', { src: item.src, type: 'video/mp4' }),
    )
    // The first video is the one main.ts starts by itself, so it has to be silent.
    video.muted = item === firstVideo || project.muteAll === true
    return h('div', { class: cls }, video)
  }

  const cells = media.map((item) => {
    if (item.type === 'row') {
      const row = h('div', { class: 'row' }, ...item.items.map((m) => cell(m, false)))
      row.style.setProperty('--n', String(item.cols?.wide ?? item.items.length))
      row.style.setProperty('--n-narrow', String(item.cols?.narrow ?? item.items.length))
      return row
    }
    // A single item, or the last of an odd count, gets the full row; so does a medium one, centred in it.
    const i = loose.indexOf(item)
    const medium = item.type === 'video' && item.size === 'medium'
    return cell(item, !medium && (loose.length === 1 || (loose.length % 2 === 1 && i === loose.length - 1)))
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

  const back = h('a', { class: 'pv-back', href: '/', 'aria-label': 'Back to the map' }, '←')
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
    if (project.cta.icon === 'whatsapp') link.innerHTML = whatsappIcon
    link.append(h('span', {}, project.cta.label))
    cta = h('div', { class: 'box sans', dir: project.cta.rtl ? 'rtl' : undefined }, project.cta.lead && h('p', { class: 'cta-lead' }, project.cta.lead), link)
  }

  const text = h(
    'aside',
    { class: 'pv-text' },
    project.asideImage && h('div', { class: 'box' }, h('img', { src: displayUrl(project.asideImage.src), alt: project.asideImage.alt, loading: 'lazy', decoding: 'async' })),
    cta,
    he && h('div', { class: 'box sans prose', dir: 'rtl' }, ...prose(he)),
    en && h('div', { class: 'box prose' }, ...prose(en)),
  )

  const step = (to: Project, cls: string, text: string) => {
    const a = h(
      'a',
      { class: cls, href: `/${to.id}/` },
      h('img', { src: thumbUrl(to), alt: '', width: 640, height: 640, loading: 'lazy', decoding: 'async' }),
      h('span', { class: 'pv-step' }, h('small', {}, text), h('b', {}, to.title)),
    )
    a.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey) return
      e.preventDefault()
      onNavigate(to)
    })
    return a
  }
  // The foot of the page: the next projects either way, and the way back to the map.
  const backAgain = h('a', { class: 'pv-back-foot', href: '/', 'aria-label': 'Back to the map' }, '←')
  backAgain.addEventListener('click', (e) => {
    e.preventDefault()
    onClose()
  })
  const more = h(
    'nav',
    { class: 'pv-more', 'aria-label': 'More projects' },
    step(around.prev, 'pv-prev', '← previous'),
    step(around.next, 'pv-next', 'next →'),
    backAgain,
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
