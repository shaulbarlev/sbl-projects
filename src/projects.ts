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
    title: 'Turning a Levitating Bulb into a Smart WiFi Gadget',
    subtitle: 'Hacking the base with an ESP32 and ESP Home so the light turns off when the TV is on.',
    year: '2026',
    tags: ['esp32', 'esphome', 'home-assistant', 'diy'],
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
      `My roommate got this cool levitating bulb from AliExpress. It was a neat little showpiece for our living room. The only catch? We placed it somewhere that made its glow reflect on the TV whenever it was on, which was unacceptable for me.

## Problem and Idea

I wanted to fix that by making it smart—basically hooking it up to Wi-Fi and linking it with my Home Assistant setup. That way, the bulb would turn off automatically when the TV is playing something.

## Why Not Just a Smart Plug?

It makes sense to consider simply using a smart plug, but there was a catch: the bulb levitates using electromagnets. If you cut the power completely, the bulb drops, which we definitely didn't want. So I needed to find a way to control just the light part of it, not the whole magnetic base.

## The DIY Solution

I realized I could exploit the capacitive touch button on the base that toggles just the light on or off. My idea was to open up the base, find the wire that controls that light circuit, and then use an ESP32 microcontroller to do the switching. In other words, I basically hijacked the touch button's job and let the ESP32 do the work, all integrated with Home Assistant through ESP Home.
I knew that I can and maybe should use a dry switch and not route the voltage through the ESP. But instead of a big clicky switch that would take up a lot of space I decided to use a MOSFET for the first time. It worked beautifully.
Then something cool happened: when it all worked I realized I could use duty cycle to control dimming. It was unplanned but cool nonetheless!

## Power and casing

Finally after having the main function work, I added a small buck converter to have the ESP be powered by the bulb's power supply, thus making it one integrated device.
Designed a simple casing for it and printed it on my 3D printer.

## Future Thoughts

I'm thinking about making the capacitive touch button usable again by routing its signal through the ESP, so it'll still work manually but also update the home assistant status.`,
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

