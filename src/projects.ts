export type Project = {
  id: string
  title: string
  subtitle?: string
  year?: string
  tags?: string[]
  /** Thumbnail image shown in the grid */
  thumbnail: { src: string; alt: string }
  /**
   * Video URL for the detail view.
   * - Prefer YouTube/Vimeo embed URLs.
   * - Or a local mp4 under /public (e.g. "/videos/demo.mp4").
   */
  video?: { kind: 'embed' | 'file'; src: string; title?: string }
  /** Additional images for the detail view */
  images?: Array<{ src: string; alt: string }>
  /** Long-form description (supports simple line breaks) */
  description?: string
  links?: Array<{ label: string; href: string }>
}

export const PROJECTS: Project[] = [
  {
    id: 'project-1',
    title: 'Project One',
    subtitle: 'Short one-liner about what it is',
    year: '2026',
    tags: ['react', 'vite', 'tailwind'],
    thumbnail: {
      src: 'https://images.unsplash.com/photo-1515879218367-8466d910aaa4?auto=format&fit=crop&w=800&q=80',
      alt: 'Code on a screen',
    },
    video: {
      kind: 'embed',
      // Example: YouTube embed URL
      src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
      title: 'Project One demo',
    },
    images: [
      {
        src: 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?auto=format&fit=crop&w=1200&q=80',
        alt: 'Laptop with code',
      },
      {
        src: 'https://images.unsplash.com/photo-1526378722484-bd91ca387e72?auto=format&fit=crop&w=1200&q=80',
        alt: 'Terminal screen',
      },
    ],
    description:
      'A longer description goes here.\n\nAdd a couple paragraphs describing what you built, what you learned, and what you’d like to do next.',
    links: [
      { label: 'GitHub', href: 'https://github.com/' },
      { label: 'Live', href: 'https://example.com' },
    ],
  },
  {
    id: 'project-2',
    title: 'Project Two',
    subtitle: 'Another short blurb',
    year: '2025',
    tags: ['video', 'web'],
    thumbnail: {
      src: 'https://images.unsplash.com/photo-1527427337751-fdca2f128ce5?auto=format&fit=crop&w=800&q=80',
      alt: 'Dark desk setup',
    },
    video: {
      kind: 'file',
      // Put a file at /public/videos/project-two.mp4 to use this
      src: '/videos/project-two.mp4',
      title: 'Project Two video',
    },
    images: [
      {
        src: 'https://images.unsplash.com/photo-1522252234503-e356532cafd5?auto=format&fit=crop&w=1200&q=80',
        alt: 'Developer workspace',
      },
    ],
    description:
      'This project shows the “video file” path option.\n\nIf you don’t have a video yet, delete the `video` field.',
  },
]

