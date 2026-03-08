import { useEffect, useMemo, useState } from 'react'
import Lightbox from 'yet-another-react-lightbox'
import Zoom from 'yet-another-react-lightbox/plugins/zoom'
import 'yet-another-react-lightbox/styles.css'
import { Logo } from './Logo'
import { PROJECTS, type Project } from './projects'

const SHOW_TAGS_AND_LINKS = false

/** Resolve project media path with the app base URL (e.g. /sblprojects/). */
function mediaUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  const base = import.meta.env.BASE_URL
  return path.startsWith('/') ? base + path.slice(1) : base + path
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

/** True when the item is the only one in the grid or the last item in an odd-sized list (lone in row). */
function isLoneInTwoColGrid(index: number, total: number): boolean {
  return total === 1 || (total % 2 === 1 && index === total - 1)
}

function ProjectDescription({ text }: { text: string }) {
  const lines = text.split('\n')

  const blocks: Array<{ type: 'heading' | 'paragraph'; content: string }> = []
  let currentParagraph: string[] = []

  const pushParagraph = () => {
    if (!currentParagraph.length) return
    blocks.push({ type: 'paragraph', content: currentParagraph.join('\n') })
    currentParagraph = []
  }

  for (const rawLine of lines) {
    const trimmed = rawLine.trimEnd()

    if (trimmed.startsWith('## ')) {
      pushParagraph()
      blocks.push({
        type: 'heading',
        content: trimmed.slice(3).trim(),
      })
      continue
    }

    currentParagraph.push(rawLine)
  }

  pushParagraph()

  if (!blocks.length) {
    return (
      <div className="whitespace-pre-wrap text-sm leading-relaxed text-white/75">
        {text}
      </div>
    )
  }

  return (
    <div className="space-y-3 text-sm leading-relaxed text-white/75">
      {blocks.map((block, idx) =>
        block.type === 'heading' ? (
          <div
            key={idx}
            className="pb-0 pt-4 text-sm font-semibold uppercase tracking-[0.18em] text-white"
          >
            {block.content}
          </div>
        ) : (
          <p key={idx} className="whitespace-pre-wrap">
            {block.content}
          </p>
        ),
      )}
    </div>
  )
}

function useEscapeToClose(onClose: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, active])
}

function useLockBodyScroll(locked: boolean) {
  useEffect(() => {
    if (!locked) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [locked])
}

const GALLERY_IMAGE_ASPECT = 'aspect-[3/4]' as const
function ProjectGallery({
  images,
  lightboxTitle,
}: {
  images: Array<{ src: string; alt: string }>
  lightboxTitle: string
}) {
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState(0)
  const slides = useMemo(
    () => images.map((img) => ({ src: mediaUrl(img.src), alt: img.alt })),
    [images],
  )

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        {images.map((img, idx) => {
          const lone = isLoneInTwoColGrid(idx, images.length)
          return (
            <figure
              key={img.src}
              className={cx(
                lone && 'col-span-2',
                !lone && GALLERY_IMAGE_ASPECT,
                'overflow-hidden rounded border border-red-500/30 bg-black/30',
              )}
            >
              <button
                type="button"
                onClick={() => {
                  setLightboxIndex(idx)
                  setLightboxOpen(true)
                }}
                className={lone ? 'block w-full text-left max-sm:pointer-events-none sm:cursor-zoom-in' : 'h-full w-full text-left max-sm:pointer-events-none sm:cursor-zoom-in'}
                aria-label={`View image ${idx + 1} of ${images.length} full size`}
              >
                <img
                  src={mediaUrl(img.src)}
                  alt={img.alt}
                  loading="lazy"
                  className={lone ? 'max-h-96 w-full object-cover' : 'h-full w-full object-cover'}
                />
              </button>
            </figure>
          )
        })}
      </div>
      <Lightbox
        open={lightboxOpen}
        close={() => setLightboxOpen(false)}
        index={lightboxIndex}
        slides={slides}
        plugins={[Zoom]}
        aria-label={`${lightboxTitle} image gallery`}
      />
    </>
  )
}

function ProjectVideoGrid({
  videos,
  projectTitle,
}: {
  videos: NonNullable<Project['videos']>
  projectTitle: string
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {videos.map((v, idx) => {
        const lone = isLoneInTwoColGrid(idx, videos.length)
        const isHorizontal = v.orientation === 'horizontal'
        const aspectClass = isHorizontal ? 'aspect-video' : 'aspect-[9/16]'
        return (
          <div
            key={v.src}
            className={cx(
              'min-w-0 overflow-hidden rounded border border-red-500/40 bg-black/40',
              lone && 'col-span-2',
            )}
          >
            {v.kind === 'embed' ? (
              <div className={`${aspectClass} w-full`}>
                <iframe
                  className="h-full w-full"
                  src={mediaUrl(v.src)}
                  title={v.title ?? `${projectTitle} video`}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allowFullScreen
                />
              </div>
            ) : (
              <video
                className={`${aspectClass} w-full`}
                controls
                preload="metadata"
                poster={v.thumbnail ? mediaUrl(v.thumbnail) : undefined}
              >
                <source src={mediaUrl(v.src)} />
              </video>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ProjectModal({
  project,
  onClose,
}: {
  project: Project
  onClose: () => void
}) {
  useEscapeToClose(onClose, true)
  useLockBodyScroll(true)

  return (
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label={`${project.title} details`}
    >
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-[1px]"
        onClick={onClose}
      />

      <div className="absolute inset-0 p-0 sm:p-6">
        <div
          className={cx(
            'relative h-full min-w-0 w-full overflow-hidden sm:mx-auto sm:max-w-7xl',
            'border-y sm:border border-red-500/60 bg-[#070707] text-white/90',
            'shadow-[0_0_0_1px_rgba(239,68,68,0.15),0_20px_60px_rgba(0,0,0,0.7)]',
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b border-red-500/40 bg-black/40 px-4 py-3 sm:px-5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h2 className="truncate text-base font-semibold tracking-wide text-white">
                  {project.title}
                </h2>
                {project.year ? (
                  <span className="text-xs text-white/60">[{project.year}]</span>
                ) : null}
              </div>
              {project.subtitle ? (
                <p className="mt-1 line-clamp-2 text-sm text-white/70">
                  {project.subtitle}
                </p>
              ) : null}
            </div>

            <button
              type="button"
              onClick={onClose}
              className={cx(
                'shrink-0 rounded border border-red-500/50 bg-black/60 px-3 py-1.5',
                'text-xs font-semibold tracking-wide text-white/90 hover:bg-black/80',
                'focus:outline-none focus:ring-2 focus:ring-red-500/70',
              )}
              aria-label="Close"
            >
              close
            </button>
          </div>

          <div className="h-[calc(100%-52px)] min-w-0 overflow-x-hidden overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
            <div className="grid min-w-0 gap-5 lg:grid-cols-[1.2fr_0.8fr]">
              <section className="min-w-0 space-y-4">
                {project.videos?.length ? (
                  <ProjectVideoGrid videos={project.videos} projectTitle={project.title} />
                ) : null}

                {project.images?.length ? (
                  <ProjectGallery
                    images={project.images}
                    lightboxTitle={project.title}
                  />
                ) : null}
              </section>

              <aside className="min-w-0 space-y-4">
                {SHOW_TAGS_AND_LINKS && project.tags && project.tags.length > 0 ? (
                  <div className="rounded border border-red-500/30 bg-black/30 p-3">
                    <div className="text-xs font-semibold tracking-wide text-white/80">
                      tags
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {project.tags.map((t) => (
                        <span
                          key={t}
                          className="rounded border border-white/15 bg-black/40 px-2 py-1 text-xs text-white/75"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                {project.description ? (
                  <div className="rounded border border-red-500/30 bg-black/30 p-3">
                    <div className="mt-2">
                      <ProjectDescription text={project.description} />
                    </div>
                  </div>
                ) : null}

                {SHOW_TAGS_AND_LINKS && project.links && project.links.length > 0 ? (
                  <div className="rounded border border-red-500/30 bg-black/30 p-3">
                    <div className="text-xs font-semibold tracking-wide text-white/80">
                      links
                    </div>
                    <div className="mt-2 flex flex-col gap-2">
                      {project.links.map((l) => (
                        <a
                          key={l.href}
                          href={l.href}
                          target="_blank"
                          rel="noreferrer"
                          className={cx(
                            'inline-flex min-w-0 items-center justify-between gap-3 rounded',
                            'border border-red-500/30 bg-black/40 px-3 py-2 text-sm',
                            'text-white/85 hover:bg-black/70 focus:outline-none focus:ring-2 focus:ring-red-500/70',
                          )}
                        >
                          <span className="shrink-0 font-semibold tracking-wide">
                            {l.label}
                          </span>
                          <span className="min-w-0 truncate text-xs text-white/60">
                            {l.href.replace(/^https?:\/\//, '')}
                          </span>
                        </a>
                      ))}
                    </div>
                  </div>
                ) : null}
              </aside>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function App() {
  const projects = useMemo(() => PROJECTS, [])
  const [activeId, setActiveId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    const raw = window.location.hash.replace('#', '')
    return projects.some((p) => p.id === raw) ? raw : null
  })

  useEffect(() => {
    const syncFromHash = () => {
      const raw = window.location.hash.replace('#', '')
      if (raw && projects.some((p) => p.id === raw)) {
        setActiveId(raw)
      } else {
        setActiveId(null)
      }
    }

    window.addEventListener('hashchange', syncFromHash)
    return () => window.removeEventListener('hashchange', syncFromHash)
  }, [projects])

  const handleOpen = (id: string) => {
    setActiveId(id)
    if (typeof window !== 'undefined') {
      window.location.assign(`#${id}`)
    }
  }

  const handleClose = () => {
    setActiveId(null)
    if (typeof window !== 'undefined') {
      const url = window.location.pathname + window.location.search
      window.history.replaceState(null, '', url)
    }
  }

  const active = activeId ? projects.find((p) => p.id === activeId) : null

  return (
    <div className="min-h-dvh overflow-x-hidden">
      <header className="border-b border-red-500/40 bg-black/40">
        <div className="mx-auto min-w-0 max-w-6xl px-4 py-6 sm:px-6">
          <div className="flex min-w-0 flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <div className="mt-2">
                <Logo />
              </div>
              <p className="mt-1 max-w-xl text-sm text-white/70">
                things i built
              </p>
            </div>

            {/* <div className="text-xs text-white/60">
              <span className="text-white/80">theme:</span> black / red / white
            </div> */}
          </div>
        </div>
      </header>

      <main className="mx-auto min-w-0 max-w-6xl px-4 py-6 sm:px-6">
        <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => handleOpen(p.id)}
              className={cx(
                'group flex flex-col overflow-hidden text-left',
                'rounded border border-red-500/30 bg-black/30',
                'hover:border-red-400/60 hover:bg-black/40',
                'focus:outline-none focus:ring-2 focus:ring-red-500/70',
              )}
            >
              <div className="aspect-[3/4] w-full shrink-0 overflow-hidden rounded-t">
                <img
                  src={mediaUrl(p.thumbnail.src)}
                  alt={p.thumbnail.alt}
                  loading="lazy"
                  className="block h-full w-full min-h-0 min-w-0 object-cover object-center grayscale-[20%] contrast-125 group-hover:grayscale-0"
                />
              </div>
              <div className="min-h-0 shrink-0 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 break-words text-sm font-semibold tracking-wide text-white/90">
                    {p.title}
                  </div>
                  {p.year ? (
                    <div className="shrink-0 text-xs text-white/60">
                      {p.year}
                    </div>
                  ) : null}
                </div>
                {p.subtitle ? (
                  <div className="mt-1 break-words text-xs text-white/65">
                    {p.subtitle}
                  </div>
                ) : (
                  <div className="mt-1 text-xs text-white/45">
                    click to open
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>

        {/* <footer className="mt-8 border-t border-red-500/20 pt-4 text-xs text-white/55">
          Edit projects in <code className="text-white/75">src/projects.ts</code>
          .
        </footer> */}
      </main>

      {active ? (
        <ProjectModal project={active} onClose={handleClose} />
      ) : null}
    </div>
  )
}

export default App
