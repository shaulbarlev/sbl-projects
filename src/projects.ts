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
      src: '/bulb/IMG_8898.jpg',
      alt: 'Levitating bulb project',
    },
    video: {
      kind: 'file',
      src: '/bulb/3BAAFDA7-5638-4767-AB94-CEA05092F11D.mp4',
      title: 'Levitating bulb smart WiFi gadget',
    },
    images: [
      { src: '/bulb/IMG_8898.jpg', alt: 'Levitating bulb' },
      { src: '/bulb/IMG_6163.jpg', alt: 'Bulb base and wiring' },
      { src: '/bulb/IMG_6164.jpg', alt: 'Bulb detail' },
      { src: '/bulb/IMG_6165.jpg', alt: 'Bulb and base' },
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
    id: 'comfy',
    title: 'Comfy',
    subtitle: 'Short blurb — edit in src/projects.ts',
    year: '2025',
    tags: [],
    thumbnail: {
      src: '/comfy/IMG_6170.jpg',
      alt: 'Comfy',
    },
    video: {
      kind: 'file',
      src: '/comfy/IMG_9080.MOV',
      title: 'Comfy',
    },
    images: [{ src: '/comfy/IMG_6170.jpg', alt: 'Comfy' }],
    description: 'Add a write-up for this project in src/projects.ts.',
  },
]

