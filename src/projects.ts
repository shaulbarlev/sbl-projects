/**
 * Ordered media for the project detail grid (videos and images interleaved in one list).
 * - Video: embed URL or file under /public; optional poster and orientation.
 * - Image: static image with alt text.
 */
export type ProjectMediaVideo = {
  type: 'video'
  kind: 'embed' | 'file'
  src: string
  title?: string
  thumbnail?: string
  orientation?: 'vertical' | 'horizontal' | 'square'
  /** Plays by itself, silent and without controls, over and over: a short study rather than a film */
  loop?: boolean
  /** A row of its own at a middling width, centred: the lead piece above smaller ones */
  size?: 'medium'
  /** Already drawn in a device frame: shown bare, without the card's own frame */
  mockup?: boolean
}

export type ProjectMediaImage = {
  type: 'image'
  src: string
  alt: string
  /** How the image fills its cell; default is cover (cropped). Use contain to show the full image letterboxed. */
  objectFit?: 'cover' | 'contain'
}

/**
 * Items side by side across the full width of the grid: as many columns as there
 * are items, or `cols` across (wrapping) on a wide screen and a phone.
 */
export type ProjectMediaRow = {
  type: 'row'
  items: (ProjectMediaVideo | ProjectMediaImage)[]
  cols?: { wide: number; narrow: number }
  /** No gap between the items: one strip */
  tight?: boolean
}

export type ProjectMediaItem = ProjectMediaVideo | ProjectMediaImage | ProjectMediaRow

export type Project = {
  id: string
  title: string
  subtitle?: string
  year?: string
  tags?: string[]
  /**
   * Source image for the map tile. `npm run thumbs` crops it to a square at
   * public/thumbs/<id>.jpg, which is what the map actually loads.
   */
  thumbnail: { src: string; alt: string }
  /** Detail view: videos and images in display order */
  media?: ProjectMediaItem[]
  /** Long-form description. `## ` starts a heading; Hebrew lines are split out and set RTL. */
  description?: string
  /** Image shown at the top of the text column */
  asideImage?: { src: string; alt: string }
  /** Call-to-action box at the top of the text column */
  cta?: { lead?: string; label: string; href: string; rtl?: boolean; icon?: 'whatsapp' }
  /** On narrow screens, put the text column above the media */
  textFirst?: boolean
  /** On narrow screens, put the text after this many media items (rows count as one) */
  textAfter?: number
  /** Mute every video, not only the autoplaying first one */
  muteAll?: boolean
}

/** Extra URL paths that open a project, e.g. sbl.cx/pikud */
export const ALIASES: Record<string, string> = {
  pikud: 'pikud-haoled',
}

/** Electronics, in grid order: the first is top-left, the strongest. */
const ORDER = [
  'doorlock',
  'pikud-haoled',
  'pacman-controller',
  'levitating-bulb',
  'comfy-keyboard',
  'zigbee-bell',
  'wifi-shades',
  'midi-controller',
]

const ALL: Project[] = [
  {
    id: 'doorlock',
    title: 'The Smartest Lock',
    subtitle: 'A custom door lock add-on with ESP32 and ESPHome—key still works when power is off.',
    year: '2025',
    tags: ['esp32', 'esphome', 'home-assistant', 'diy', '3d-printing'],
    thumbnail: {
      src: '/doorlock/IMG_6527-0001.png',
      alt: 'Smart door lock',
    },
    media: [
      { type: 'video', kind: 'file', src: '/doorlock/IMG_4804-1.mp4', title: 'Smart door lock', thumbnail: '/doorlock/IMG_4804.jpg' },
      { type: 'video', kind: 'file', src: '/doorlock/IMG_6527-2.mp4', title: 'Smart door lock', thumbnail: '/doorlock/IMG_6527-2.jpg' },
      { type: 'video', kind: 'file', src: '/doorlock/doorlockcad.mp4', title: 'Door lock CAD', thumbnail: '/doorlock/doorlockcad.jpg' },
      { type: 'image', src: '/doorlock/IMG_6527-0001.png', alt: 'Smart door lock' },
    ],
    description:
      `I wanted to be able to leave the house without carrying a key. Sure, there are off-the-shelf products like Nuki that do this, but I thought it would be a cool project to build my own door lock add-on from scratch.

## Designing the Mechanics

The key challenge was to design mechanics that would lock and unlock the door, but also allow the door to be operated completely powerlessly with a regular physical key. So my goal was to make sure that even if the electronics failed or power was off, you could still use the key as usual.

## How I Did It

I realized I needed to detect the state of the lock—basically to know whether it was locked or unlocked. I looked into how the existing Nuki product works: they use a small DC motor, some complex mechanics, and an encoder to track the lock state. Instead of going that route, I found a servo motor that had a built-in potentiometer. This way, I could always know the motor's position and thus the lock's state.

When the motor is unpowered, it's loose enough that the key can turn it freely. That means you can still lock or unlock the door with the key, and the potentiometer lets me update the lock state electronically.

## Electronics and Control

On the electronics side, the heart of the system is the ESP32 running ESPHome. I added an OLED screen to show the lock state and a button mounted on a 3D-printed case that lets you toggle the lock from inside the house.`,
  },
  {
    id: 'levitating-bulb',
    title: 'Adding WiFi to a magnetically levitating bulb',
    subtitle: 'Hacking the base with an ESP32 and ESP Home so the light turns off when the TV is on.',
    year: '2026',
    tags: ['esp32', 'esphome', 'home-assistant', 'diy'],
    thumbnail: {
      src: '/bulb/IMG_6165.jpg',
      alt: 'Levitating bulb project',
    },
    media: [
      { type: 'video', kind: 'file', src: '/bulb/3BAAFDA7-5638-4767-AB94-CEA05092F11D.mp4', title: 'Levitating bulb smart WiFi gadget', thumbnail: '/bulb/3BAAFDA7-5638-4767-AB94-CEA05092F11D.jpg' },
      { type: 'image', src: '/bulb/IMG_8898.jpg', alt: 'Levitating bulb' },
      { type: 'image', src: '/bulb/IMG_6163.jpg', alt: 'Bulb base and wiring' },
      { type: 'image', src: '/bulb/IMG_6164.jpg', alt: 'Bulb detail' },
      { type: 'image', src: '/bulb/IMG_6165.jpg', alt: 'Bulb and base' },
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
  },
  {
    id: 'pacman-controller',
    title: 'Pacman Controller',
    subtitle: 'Turning a Pac-Man joystick into a smart home controller with ESP and ESPHome—buttons trigger Sonos, lights, and more.',
    year: '2025',
    tags: ['esp', 'esphome', 'home-assistant', 'sonos', 'diy', 'smart-home'],
    thumbnail: {
      src: '/pacman/IMG_5093.jpg',
      alt: 'Pac-Man joystick controller',
    },
    media: [
      { type: 'video', kind: 'file', src: '/pacman/IMG_0306.mp4', title: 'Pacman controller', thumbnail: '/pacman/IMG_0306.jpg' },
      { type: 'video', kind: 'file', src: '/pacman/IMG_0310.mp4', title: 'Pacman controller', thumbnail: '/pacman/IMG_0310.jpg' },
      { type: 'video', kind: 'file', src: '/pacman/IMG_0315.mp4', title: 'Pacman controller', thumbnail: '/pacman/IMG_0315.jpg' },
      { type: 'video', kind: 'file', src: '/pacman/IMG_4296.mp4', title: 'Pacman controller', thumbnail: '/pacman/IMG_4296.jpg' },
      { type: 'video', kind: 'file', src: '/pacman/IMG_4810.mp4', title: 'Pacman controller', thumbnail: '/pacman/IMG_4810.jpg' },
      { type: 'video', kind: 'file', src: '/pacman/6ba31dce-68ea-4598-8884-aafd5ce831b2.mp4', title: 'Pacman controller', thumbnail: '/pacman/6ba31dce-68ea-4598-8884-aafd5ce831b2.jpg' },
      { type: 'image', src: '/pacman/IMG_5093.jpg', alt: 'Pac-Man joystick controller' },
    ],
    description:
      `This little project started with an old plug-and-play video game joystick I used to have. It was a Pac-Man-themed joystick that output RCA straight to the TV, something I played with when I was little. I thought it would be fun to turn it into something my nephew could enjoy.

## The Plan: Board Replacement and Smart Sound Triggers

The idea was to trigger sounds with the buttons. To do this, I replaced the original board with an ESP board and exposed it to Home Assistant using ESPHome. From there, I could manage triggering sounds on a Sonos speaker through Home Assistant whenever he pressed a button.

It worked beautifully—my nephew loved it!

## Expanding the Fun

What started as a simple joystick hack turned into something bigger. We ended up connecting it to even more devices, including a traffic light and a levitating lamp I mentioned in another project, as well as all the RGB lights in the living room. So this little nostalgic piece ended up becoming a central part of a much bigger smart home setup.`,
  },
  {
    id: 'comfy-keyboard',
    title: 'Comfy keyboard for the smart home',
    subtitle: 'Hooking up a Comfy kids keyboard to Home Assistant via Raspberry Pi and MQTT.',
    year: '2025',
    tags: ['raspberry-pi', 'mqtt', 'home-assistant', 'python', 'diy'],
    thumbnail: {
      src: '/comfy/comfythumb.jpg',
      alt: 'Comfy keyboard',
    },
    media: [
      { type: 'video', kind: 'file', src: '/comfy/IMG_9080.mp4', title: 'Comfy keyboard smart home controller', thumbnail: '/comfy/IMG_9080.jpg' },
      { type: 'image', src: '/comfy/IMG_6170.jpg', alt: 'Comfy keyboard' },
    ],
    description:
      `## The Idea

As a kid I had this children keyboard for the PC. It was named Comfy, and I loved it. It was colorful, it had great buttons. I recently thought how cool would it be to have that connected to anything on my smart home and make it into a smart home controller.

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
    media: [
      { type: 'video', kind: 'file', src: '/bell/IMG_4696.mp4', title: 'ZigBee bell', thumbnail: '/bell/IMG_4696.jpg' },
      { type: 'image', src: '/bell/Screenshot%202026-03-08%20at%200.53.02.jpg', alt: 'ZigBee bell' },
    ],
    description:
      `We had a bell, and I wanted to make it trigger some smart home things.

So I cracked open an IKEA ZigBee button and made it so when the bell dings, it shorts the ZigBee button contacts where the physical button used to live.

And it was pretty simple.

Because the bell is made from brass, it is conductive enough, and it just worked with some gaffer tape.

## //TODO

I have a problem where the bell becomes a sort of antenna and is way too sensitive, just waving my hands around it triggered the button too, which was a problem that I still need to address using a pull-down resistor, probably.`,
  },
  {
    id: 'wifi-shades',
    title: 'WiFi Shades',
    subtitle: 'Motorizing lever shades with a linear actuator and ESP8266 so they open with my alarm.',
    year: '2023',
    tags: ['esp8266', 'home-automation', 'diy', '3d-printing'],
    thumbnail: {
      src: '/electric%20shades/IMG_0097.jpg',
      alt: 'WiFi motorized shades',
    },
    media: [
      { type: 'video', kind: 'file', src: '/electric%20shades/AE817EB0-346B-44F5-B551-508E4ABA1E91.mp4', title: 'WiFi shades', thumbnail: '/electric%20shades/AE817EB0-346B-44F5-B551-508E4ABA1E91.jpg' },
      { type: 'video', kind: 'file', src: '/electric%20shades/83D9716A-F87E-4EA0-83F0-4CA489240DEA.mp4', title: 'WiFi shades', thumbnail: '/electric%20shades/83D9716A-F87E-4EA0-83F0-4CA489240DEA.jpg' },
      { type: 'image', src: '/electric%20shades/IMG_0097.jpg', alt: 'WiFi shades' },
      { type: 'image', src: '/electric%20shades/IMG_7392.jpg', alt: 'WiFi shades' },
      { type: 'image', src: '/electric%20shades/IMG_9192.jpg', alt: 'Shades detail' },
    ],
    description:
      `I used to live in a room which had lever shades, and I wanted them to open automatically with my alarm. The first step was to find a way to motorize them. I found a small linear actuator that had enough range and was small enough to fit inside the aluminum casing of the window.

## Hardware

With a bit of help from my dad, we drilled a hole into the lever of the shade. I also 3D-printed a small part to help fit the lever into the tip of the linear actuator.

## Electronics

In terms of electronics, it was pretty straightforward: I used a buck converter, an H-bridge to control the actuator's direction, and an ESP8266 for Wi-Fi connectivity and control.`,
  },
  {
    id: 'midi-controller',
    title: 'Custom MIDI Controller',
    subtitle: 'One knob and three programmable buttons on an Arduino Leonardo, sending MIDI over USB for Ableton Live.',
    year: '2025',
    tags: ['arduino', 'midi', 'usb', 'diy', 'ableton'],
    thumbnail: {
      src: '/midi-controller/IMG_9666.jpg',
      alt: 'Custom MIDI controller with knob and three buttons',
    },
    media: [
      { type: 'video', kind: 'file', src: '/midi-controller/IMG_9666-1.mp4', title: 'MIDI controller', thumbnail: '/midi-controller/IMG_9666.jpg' },
      { type: 'image', src: '/midi-controller/IMG_9666.jpg', alt: 'MIDI controller' },
      { type: 'image', src: '/midi-controller/IMG_9670-0001.png', alt: 'MIDI controller' },
    ],
    description:
      `A musician friend needed a simple MIDI peripheral custom-fitted to his needs, with just one knob and three programmable buttons.

I used an Arduino Leonardo knockoff from AliExpress and the Arduino IDE to set it up. The Leonardo is capable of sending MIDI over USB, so I programmed the buttons to act as MIDI channels. That way, my friend could easily assign each channel to whatever function he wanted in his DAW of choice, which was Ableton Live. For the buttons, I used mechanical keyboard switches and printed custom keycaps.`,
  },
  {
    id: 'pikud-haoled',
    title: 'Pikud HaoLED',
    subtitle: 'A dead simple IoT light pre-connected to the official Pikud Haoref API for visual alert indication.',
    year: '2026',
    tags: ['iot', 'esp', 'led', 'alerting'],
    thumbnail: {
      src: '/pikudhaoled/led-end.jpg',
      alt: 'Pikud HaoLED alert light',
    },
    media: [
      {
        type: 'image',
        src: '/pikudhaoled/news.jpg',
        alt: 'Reshet 13 news segment with Shaul Bar Lev on Pikud Haoref-related tech (smart shelter headline)',
        objectFit: 'contain',
      },
      {
        type: 'video',
        kind: 'file',
        src: '/pikudhaoled/led-end.mp4',
        title: 'Pikud HaoLED in action',
        thumbnail: '/pikudhaoled/led-end.jpg',
        orientation: 'vertical',
      },
      { type: 'image', src: '/pikudhaoled/IMG_6254.jpg', alt: 'Pikud HaoLED light' },
      { type: 'image', src: '/pikudhaoled/IMG_6255.jpg', alt: 'Pikud HaoLED light close-up' },
    ],
    description:
      `A dead simple IOT light, pre connected to official Pikud Haoref API for visual indication of alerts.

What started as a complex project involving a Raspberry Pi, VPN, Home Assistant and Oref Alert HACS addon, is becoming its own self contained project based on ESP32 architecture.
Simply connect to WiFi during initial setup, and forget about it.

Allows configuring Pre Alert, Alert, End (safe) indicators.

I’d love to share more as it develops. If this sounds interesting, join our newsletter group to follow along and get updates!

סטריפ לדים חכם המחובר ישירות לפיקוד העורף, לחיווי ויזאולי של התרעות חירום.

מה שהתחיל כפרויקט מורכב רק עבורי ועבור שכניי לבניין, הופך להיות מוצר קל לתפעול, מוכל ופשוט לחיבור.
לאחר החיבור הראשוני לרשת, אפשר לשכוח ממנו.

ניתן להגדיר שהאור יפעל בעת הודעה מקדימה, בעת אזעקה ובעת זמן יציאה מהמרחב המוגן.

אשמח לשתף עוד ככל שהפרויקט מתקדם. אם זה נשמע מעניין מוזמנים להצטרף לקבוצת הניוזלטר שלנו בווצאפ!`,
    asideImage: { src: '/pikudhaoled/pikudhaoled-0.jpg', alt: 'Pikud HaoLED sign' },
    cta: {
      lead: 'אנחנו מפתחים ערכת תאורה פשוטה שמגיבה ונדלקת בהתאם להתראות פיקוד העורף.',
      label: 'הצטרפו לקבוצת העדכונים',
      href: 'https://chat.whatsapp.com/BhLWAVLMEVcLHHAkfKGeqp?mode=hq1tcli',
      rtl: true,
      icon: 'whatsapp',
    },
    textFirst: true,
    muteAll: true,
  },
  {
    id: 'knock',
    title: 'knock.cards',
    subtitle: 'Digital business cards, designed in 3D and built as React components.',
    tags: ['3d', 'blender', 'after-effects', 'react', 'web'],
    thumbnail: { src: '/knock/tile.jpg', alt: 'A knock.cards business card in purple glass' },
    media: [
      // The demo first: making a card in the editor.
      { type: 'video', kind: 'file', src: '/knock/editor.mp4', thumbnail: '/knock/editor.jpg', title: 'Making a card in the knock.cards editor', orientation: 'horizontal' },
      // The four materials, each playing forward and back, as one strip.
      {
        type: 'row',
        tight: true,
        items: [
          { type: 'video', kind: 'file', src: '/knock/glass.mp4', thumbnail: '/knock/glass.jpg', title: 'Purple glass', loop: true },
          { type: 'video', kind: 'file', src: '/knock/black-matte.mp4', thumbnail: '/knock/black-matte.jpg', title: 'Black matte', loop: true },
          { type: 'video', kind: 'file', src: '/knock/grey-paper.mp4', thumbnail: '/knock/grey-paper.jpg', title: 'Grey paper', loop: true },
          { type: 'video', kind: 'file', src: '/knock/white-matte.mp4', thumbnail: '/knock/white-matte.jpg', title: 'White matte', loop: true },
        ],
      },
      // Loaders, small: five across, four on a phone.
      {
        type: 'row',
        cols: { wide: 5, narrow: 4 },
        items: [
          { type: 'video', kind: 'file', src: '/knock/loaders/v1-rope-3.mp4', thumbnail: '/knock/loaders/v1-rope-3.jpg', title: 'Loader', orientation: 'square', loop: true },
          { type: 'video', kind: 'file', src: '/knock/loaders/batch2-golf.mp4', thumbnail: '/knock/loaders/batch2-golf.jpg', title: 'Loader', orientation: 'square', loop: true },
          { type: 'video', kind: 'file', src: '/knock/loaders/v1-conductor-1.mp4', thumbnail: '/knock/loaders/v1-conductor-1.jpg', title: 'Loader', orientation: 'square', loop: true },
          { type: 'video', kind: 'file', src: '/knock/loaders/batch2-dizzy1.mp4', thumbnail: '/knock/loaders/batch2-dizzy1.jpg', title: 'Loader', orientation: 'square', loop: true },
          { type: 'video', kind: 'file', src: '/knock/loaders/batch2-magic-1.mp4', thumbnail: '/knock/loaders/batch2-magic-1.jpg', title: 'Loader', orientation: 'square', loop: true },
          { type: 'video', kind: 'file', src: '/knock/loaders/v1-timberwalk-1.mp4', thumbnail: '/knock/loaders/v1-timberwalk-1.jpg', title: 'Loader', orientation: 'square', loop: true },
          { type: 'video', kind: 'file', src: '/knock/loaders/batch2-thumbs.mp4', thumbnail: '/knock/loaders/batch2-thumbs.jpg', title: 'Loader', orientation: 'square', loop: true },
          { type: 'video', kind: 'file', src: '/knock/loaders/v1-cudedance-loop-2.mp4', thumbnail: '/knock/loaders/v1-cudedance-loop-2.jpg', title: 'Loader', orientation: 'square', loop: true },
          { type: 'video', kind: 'file', src: '/knock/loaders/v1-walkcycle-1.mp4', thumbnail: '/knock/loaders/v1-walkcycle-1.jpg', title: 'Loader', orientation: 'square', loop: true },
          { type: 'video', kind: 'file', src: '/knock/loaders/batch2-flipping.mp4', thumbnail: '/knock/loaders/batch2-flipping.jpg', title: 'Loader', orientation: 'square', loop: true },
        ],
      },
      {
        type: 'row',
        items: [
          { type: 'video', kind: 'file', src: '/knock/v1-mockup.mp4', thumbnail: '/knock/v1-mockup.jpg', title: 'The first card, in a phone', loop: true },
          { type: 'video', kind: 'file', src: '/knock/v1.mp4', thumbnail: '/knock/v1.jpg', title: 'The first card', loop: true },
          { type: 'video', kind: 'file', src: '/knock/v2.mp4', thumbnail: '/knock/v2.jpg', title: 'A one-button card', loop: true },
        ],
      },
      {
        type: 'row',
        items: [
          { type: 'video', kind: 'file', src: '/knock/card-b.mp4', thumbnail: '/knock/card-b.jpg', title: 'Card arrival study', loop: true },
          { type: 'video', kind: 'file', src: '/knock/card-f.mp4', thumbnail: '/knock/card-f.jpg', title: 'Card arrival study', loop: true },
          { type: 'video', kind: 'file', src: '/knock/live.mp4', thumbnail: '/knock/live.jpg', title: 'A card live in the browser', loop: true },
        ],
      },
    ],
    description: `## Knock Card

I designed and implemented Knock Cards: a personal virtual business card. Customizable and luxurious. I used Blender to design and render it in 3D, for that fine glassy feeling.

## Loaders for Knock AI

These loaders were created using a mix of traditional and AI techniques. The character was designed entirely with AI, animated using AI tools, and fine-tuned in After Effects for precise looping.`,
    cta: { label: 'Create your Knock Card', href: 'https://knock.cards' },
    // on a phone: the demo, then the words, then the materials, the loaders and the rest
    textAfter: 1,
  },
  {
    id: 'remy',
    title: 'Remy',
    subtitle: 'A social media app for close friends. Product lead, design and iOS.',
    tags: ['product', 'design', 'ios', 'swiftui'],
    thumbnail: { src: '/remy/tile.jpg', alt: 'The Remy invite card on an iPhone' },
    // ponytail: the small loops are interim, from the shipped app; swap in mockups when they arrive.
    media: [
      { type: 'video', kind: 'file', src: '/remy/onboarding-mock.mp4', thumbnail: '/remy/onboarding-mock.jpg', title: 'Gamified onboarding', loop: true, size: 'medium', mockup: true },
      { type: 'video', kind: 'file', src: '/remy/landing.mp4', thumbnail: '/remy/landing.jpg', title: 'The landing page', orientation: 'horizontal', loop: true },
      {
        type: 'row',
        items: [
          { type: 'video', kind: 'file', src: '/remy/scroll.mp4', thumbnail: '/remy/scroll.jpg', title: 'The feed', loop: true },
          { type: 'video', kind: 'file', src: '/remy/scroll-dark.mp4', thumbnail: '/remy/scroll-dark.jpg', title: 'The feed, dark', loop: true },
          { type: 'video', kind: 'file', src: '/remy/pause.mp4', thumbnail: '/remy/pause.jpg', title: 'Pause mode', loop: true },
          { type: 'video', kind: 'file', src: '/remy/first-post.mp4', thumbnail: '/remy/first-post.jpg', title: 'The first post', loop: true },
        ],
      },
    ],
    description: `Remy is a social media app for close friends.

As product engineering lead on Remy, I focused on making Remy feel safe, easy to use, fun, and intuitive.`,
    // Remy - Real Moments, AMY AI, Inc. (no country in the link: it opens in the visitor's own store)
    cta: { label: 'Get Remy', href: 'https://apps.apple.com/app/id6768362016' },
  },
]

/**
 * The map's three doors. The landing shows only these, stacked under the
 * wordmark; opening one shoots its children out below the column.
 * `children` are project ids in map order (earlier = nearer the top), and
 * `reel` stands for the reel's own tile.
 */
export const CATEGORIES = [
  { id: 'ux', title: 'ux/ui', children: ['knock', 'remy'] },
  // the reel's tile is a film frame: 16:9, two columns wide
  { id: 'vfx', title: 'visual effects & 3d', children: ['reel'], wide: true },
  { id: 'electronics', title: 'electronics', children: ORDER },
]
export type Category = (typeof CATEGORIES)[number]

/** The category a project, the reel or a category itself belongs to */
export const categoryOf = (id: string): Category | undefined => CATEGORIES.find((c) => c.id === id || c.children.includes(id))

const rank = (p: Project) => {
  const i = ORDER.indexOf(p.id)
  return i === -1 ? ORDER.length : i
}

export const PROJECTS: Project[] = [...ALL].sort((a, b) => rank(a) - rank(b))

export function findProject(slug: string): Project | undefined {
  const id = ALIASES[slug] ?? slug
  return PROJECTS.find((p) => p.id === id)
}

export const thumbUrl = (p: Project) => `/thumbs/${p.id}.jpg`
/** The same picture as red edges on black: what the open card wears */
export const edgesUrl = (p: Project) => `/thumbs/${p.id}-edges.jpg`

/**
 * The display-size copy of a picture under /public (`npm run thumbs` makes them,
 * 1200px at most). The originals are camera files of up to 24 megapixels: fine
 * for the full-screen viewer, far too heavy for a grid cell on a phone.
 */
export const displayUrl = (src: string) => `/m${src}.jpg`

/** The pictures a project page shows, in page order: what is worth fetching before it opens. */
export function displayPictures(p: Project): string[] {
  const shown = (p.media ?? []).flatMap((m) => (m.type === 'row' ? m.items : [m])).map((m) => (m.type === 'image' ? m.src : m.thumbnail))
  const all = p.textFirst ? [p.asideImage?.src, ...shown] : [...shown, p.asideImage?.src]
  return all.filter((src): src is string => src !== undefined).map(displayUrl)
}

/**
 * Passive islands: pictures out on the edge of the map, there to be found.
 * Tapping one only brings it into view. `w`/`h` are its size on a wide screen.
 */
export type Island =
  | { id: string; kind: 'picture'; src: string; alt: string; w: number; h: number }
  /**
   * A live page from elsewhere, shown as it is; `lamps` are its lights' colours,
   * for the minimap before it has loaded. `note` appears beside it once the
   * visitor has played with it for a few seconds, with one photo under it: the
   * one for the light's state right now, keyed by which lamps are lit ("off",
   * "green", "orange", "both" for two lamps in page order). `gate` is a JSON
   * URL whose `enabled` says whether the island exists at all right now, and
   * `path` a URL path of this site that arrives focused on it.
   */
  | {
      id: string
      kind: 'frame'
      src: string
      title: string
      w: number
      h: number
      lamps?: string[]
      note?: { text: string; photos: Record<string, { src: string; alt: string }> }
      gate?: string
      path?: string
    }

export const ISLANDS: Island[] = [
  { id: 'me', kind: 'picture', src: '/islands/me.jpg', alt: 'Shaul', w: 230, h: 230 },
  // The traffic light at home, the very page sbl.cx/traffic serves (its bare copy, no
  // background): lamps, socket, name field, party button and master switch are all its
  // own. The page reports its true height once loaded; `h` is the guess until then.
  {
    id: 'traffic',
    kind: 'frame',
    src: 'https://sbl.cx/traffic?bare',
    title: 'The traffic light at home. Tap a lamp.',
    w: 340,
    h: 400,
    lamps: ['#22c55e', '#f59e0b'],
    // The master switch in the QR's panel: off, the light is not on the map at all.
    gate: 'https://sbl.cx/traffic/state',
    path: 'traffic',
    note: {
      text: 'You are driving the real traffic light in my apartment.',
      // One photo per state of the light, uncropped; the note shows the current one.
      photos: {
        off: { src: '/islands/traffic-off.jpg', alt: 'The traffic light at home, both lamps off' },
        green: { src: '/islands/traffic-green.jpg', alt: 'The traffic light at home, green lit' },
        orange: { src: '/islands/traffic-orange.jpg', alt: 'The traffic light at home, orange lit' },
        both: { src: '/islands/traffic-both.jpg', alt: 'The traffic light at home, both lamps lit' },
      },
    },
  },
]

/** The vfx reel, and its tile's title. At 70 MB it is over this host's 25 MiB limit per file, so it is a file of the QR Worker's (R2, served with ranges). */
export const REEL = {
  src: 'https://sbl.cx/f/f420d75d7af66811d0381f1386d70448/reel.mp4',
  poster: '/reel/poster.jpg',
  title: 'watch my reel',
  /** The tile's picture: the reel's first seconds, 16:9, looping */
  loop: '/reel/start.mp4',
  /** Two lines under the tile */
  note: 'Compositing and design work, 2D and 3D, on commercials, music videos and short films.',
}
