import { h } from './dom'

type Slide = { src: string; alt: string }

let closeCurrent: (() => void) | null = null

export const lightboxOpen = () => closeCurrent !== null

/** Full-screen image viewer: arrows or swipe to move, Esc or a click outside to close. */
export function openLightbox(slides: Slide[], start: number) {
  closeCurrent?.()
  let index = start

  const img = h('img', { draggable: 'false' })
  const count = h('span', { class: 'lb-count' })
  const prev = h('button', { type: 'button', class: 'lb-prev', 'aria-label': 'Previous image' }, '‹')
  const next = h('button', { type: 'button', class: 'lb-next', 'aria-label': 'Next image' }, '›')
  const close = h('button', { type: 'button', class: 'lb-close', 'aria-label': 'Close' }, h('i', { class: 'hn hn-times', 'aria-hidden': 'true' }))
  const many = slides.length > 1
  const root = h('div', { class: 'lb', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Image viewer' }, img, close, many && prev, many && next, many && count)

  const show = (i: number) => {
    index = (i + slides.length) % slides.length
    img.src = slides[index].src
    img.alt = slides[index].alt
    count.textContent = `${index + 1} / ${slides.length}`
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') done()
    else if (e.key === 'ArrowLeft') show(index - 1)
    else if (e.key === 'ArrowRight') show(index + 1)
  }

  function done() {
    window.removeEventListener('keydown', onKey)
    root.remove()
    closeCurrent = null
  }

  let downX: number | null = null
  root.addEventListener('pointerdown', (e) => (downX = e.clientX))
  root.addEventListener('pointerup', (e) => {
    const dx = downX === null ? 0 : e.clientX - downX
    downX = null
    if (many && Math.abs(dx) > 50) show(index + (dx < 0 ? 1 : -1))
    else if (e.target === root) done()
  })
  prev.addEventListener('click', () => show(index - 1))
  next.addEventListener('click', () => show(index + 1))
  close.addEventListener('click', done)
  window.addEventListener('keydown', onKey)

  show(start)
  document.body.append(root)
  close.focus()
  closeCurrent = done
}

export const closeLightbox = () => closeCurrent?.()
