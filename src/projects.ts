export type Project = {
  id: string
  title: string
  subtitle?: string
  year?: string
  tags?: string[]
  /** Thumbnail image shown in the grid */
  thumbnail: { src: string; alt: string }
  /**
   * Videos for the detail view (any number).
   * - Prefer YouTube/Vimeo embed URLs (kind: 'embed').
   * - Or local files under /public (kind: 'file', e.g. mp4).
   */
  videos?: Array<{ kind: 'embed' | 'file'; src: string; title?: string }>
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
    videos: [
      { kind: 'file', src: '/bulb/3BAAFDA7-5638-4767-AB94-CEA05092F11D.mp4', title: 'Levitating bulb smart WiFi gadget' },
    ],
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
    title: 'Turning My Childhood Keyboard into a Smart Home Controller',
    subtitle: 'Hooking up a vintage Comfy kids keyboard to Home Assistant via Raspberry Pi and MQTT.',
    year: '2025',
    tags: ['raspberry-pi', 'mqtt', 'home-assistant', 'python', 'diy'],
    thumbnail: {
      src: '/comfy/IMG_6170.jpg',
      alt: 'Comfy keyboard',
    },
    videos: [
      { kind: 'file', src: '/comfy/IMG_9080.MOV', title: 'Comfy keyboard smart home controller' },
    ],
    images: [{ src: '/comfy/IMG_6170.jpg', alt: 'Comfy keyboard' }],
    description:
      `## The Idea

The background story is that when I was young, like five, I had this children keyboard for the PC. It was named Comfy, and I loved it. It was colorful, it had great buttons. I recently thought how cool would it be to have that connected to anything on my smart home and make it into a smart home controller.

So that's exactly what me and my roommate decided to do.

We asked friends if they had an angle on getting one of those Comfy keyboards. Eventually, we found one.

Now I just had to figure out how to hook it up.

## Figuring Out How to Connect It

I imagined that it would probably use something proprietary for communications, but it was funny to find out that it is just a basic HID keyboard. The buttons just communicate letter key presses, that includes the scrolly thing!

I saw two ways forward:

## Option 1 — Replace the board with an ESP32

I could either do a board replacement and replace it with an ESP32. The pro of doing that is that it would be low power and cheap.

But then I realized that ESP32s have limited IOs, and I have many buttons that I need to support here. That means I would probably need to do something like a GPIO extender bus thing, which I didn't really like.

## Option 2 — Use a Raspberry Pi

Then I thought of another option: I could use a Raspberry Pi, interpret the key presses, and send them as commands over MQTT.

Then I could map them and catch them on the Home Assistant side.

I went with the latter.
I coded it up in Python and made a small proof of concept, and you can see it in the video triggering my light.`,
  },
  {
    id: 'zigbee-bell',
    title: 'ZigBee Bell',
    subtitle: 'Hacking an IKEA ZigBee button so a brass bell triggers smart home actions when it dings.',
    year: '2025',
    tags: ['zigbee', 'home-assistant', 'diy', 'ikea'],
    thumbnail: {
      src: '/bell/Screenshot%202026-03-08%20at%200.53.02.jpg',
      alt: 'ZigBee bell',
    },
    videos: [
      { kind: 'file', src: '/bell/IMG_4696.MOV', title: 'ZigBee bell' },
    ],
    images: [
      { src: '/bell/Screenshot%202026-03-08%20at%200.53.02.jpg', alt: 'ZigBee bell' },
    ],
    description:
      `We had a bell, and I wanted to make it trigger some smart home things.

So I cracked open an IKEA ZigBee button and made it so when the bell dings, it shorts the ZigBee button contacts where the physical button used to live.

And it was pretty simple.

Because the bell is made from brass, it is conductive enough, and it just worked with some gaffer tape.

## The problem

The only problem was that the bell became a sort of antenna and was way too sensitive, so just waving my hands around it triggered the button too, which was a problem that I still need to address using a pull-down resistor, probably.`,
  },
  {
    id: 'wifi-shades',
    title: 'WiFi Shades',
    subtitle: 'Motorizing lever shades with a linear actuator and ESP8266 so they open with my alarm.',
    year: '2023',
    tags: ['esp8266', 'home-automation', 'diy', '3d-printing'],
    thumbnail: {
      src: '/electric%20shades/IMG_7392.jpg',
      alt: 'WiFi motorized shades',
    },
    videos: [
      { kind: 'file', src: '/electric%20shades/AE817EB0-346B-44F5-B551-508E4ABA1E91.mp4', title: 'WiFi shades' },
      { kind: 'file', src: '/electric%20shades/IMG_7032.mp4', title: 'WiFi shades' },
    ],
    images: [
      { src: '/electric%20shades/IMG_7392.jpg', alt: 'WiFi shades' },
      { src: '/electric%20shades/IMG_9192.jpg', alt: 'Shades detail' },
    ],
    description:
      `I used to live in a room which had lever shades, and I wanted them to open automatically with my alarm. The first step was to find a way to motorize them. I found a small linear actuator that had enough range and was small enough to fit inside the aluminum casing of the window.

## Hardware

With a bit of help from my dad, we drilled a hole into the lever of the shade. I also 3D-printed a small part to help fit the lever into the tip of the linear actuator.

## Electronics

In terms of electronics, it was pretty straightforward: I used a buck converter, an H-bridge to control the actuator's direction, and an ESP8266 for Wi-Fi connectivity and control.`,
  },
]

