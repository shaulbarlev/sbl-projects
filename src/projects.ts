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
   * - thumbnail: optional poster image (e.g. frame JPG alongside the video).
   * - orientation: 'vertical' (default) or 'horizontal' for aspect ratio.
   */
  videos?: Array<{ kind: 'embed' | 'file'; src: string; title?: string; thumbnail?: string; orientation?: 'vertical' | 'horizontal' }>
  /** Additional images for the detail view */
  images?: Array<{ src: string; alt: string }>
  /** Long-form description (supports simple line breaks) */
  description?: string
  links?: Array<{ label: string; href: string }>
}

export const PROJECTS: Project[] = [
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
    videos: [
      { kind: 'file', src: '/doorlock/IMG_4804-1.mp4', title: 'Smart door lock', thumbnail: '/doorlock/IMG_4804.jpg' },
      { kind: 'file', src: '/doorlock/IMG_6527-2.mp4', title: 'Smart door lock', thumbnail: '/doorlock/IMG_6527-2.jpg' },
      { kind: 'file', src: '/doorlock/doorlockcad.mp4', title: 'Door lock CAD', thumbnail: '/doorlock/doorlockcad.jpg' },
    ],
    images: [
      { src: '/doorlock/IMG_6527-0001.png', alt: 'Smart door lock' },
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
    videos: [
      { kind: 'file', src: '/bulb/3BAAFDA7-5638-4767-AB94-CEA05092F11D.mp4', title: 'Levitating bulb smart WiFi gadget', thumbnail: '/bulb/3BAAFDA7-5638-4767-AB94-CEA05092F11D.jpg' },
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
    id: 'pacman-controller',
    title: 'Pacman Controller',
    subtitle: 'Turning a Pac-Man joystick into a smart home controller with ESP and ESPHome—buttons trigger Sonos, lights, and more.',
    year: '2025',
    tags: ['esp', 'esphome', 'home-assistant', 'sonos', 'diy', 'smart-home'],
    thumbnail: {
      src: '/pacman/IMG_5093.jpg',
      alt: 'Pac-Man joystick controller',
    },
    videos: [
      { kind: 'file', src: '/pacman/IMG_0306.mp4', title: 'Pacman controller', thumbnail: '/pacman/IMG_0306.jpg' },
      { kind: 'file', src: '/pacman/IMG_0310.mp4', title: 'Pacman controller', thumbnail: '/pacman/IMG_0310.jpg' },
      { kind: 'file', src: '/pacman/IMG_0315.mp4', title: 'Pacman controller', thumbnail: '/pacman/IMG_0315.jpg' },
      { kind: 'file', src: '/pacman/IMG_4296.mp4', title: 'Pacman controller', thumbnail: '/pacman/IMG_4296.jpg' },
      { kind: 'file', src: '/pacman/IMG_4810.mp4', title: 'Pacman controller', thumbnail: '/pacman/IMG_4810.jpg' },
      { kind: 'file', src: '/pacman/6ba31dce-68ea-4598-8884-aafd5ce831b2.mp4', title: 'Pacman controller', thumbnail: '/pacman/6ba31dce-68ea-4598-8884-aafd5ce831b2.jpg' },
    ],
    images: [
      { src: '/pacman/IMG_5093.jpg', alt: 'Pac-Man joystick controller' },
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
    videos: [
      { kind: 'file', src: '/comfy/IMG_9080.mp4', title: 'Comfy keyboard smart home controller', thumbnail: '/comfy/IMG_9080.jpg' },
    ],
    images: [{ src: '/comfy/IMG_6170.jpg', alt: 'Comfy keyboard' }],
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
    videos: [
      { kind: 'file', src: '/bell/IMG_4696.mp4', title: 'ZigBee bell', thumbnail: '/bell/IMG_4696.jpg' },
    ],
    images: [
      { src: '/bell/Screenshot%202026-03-08%20at%200.53.02.jpg', alt: 'ZigBee bell' },
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
    videos: [
      { kind: 'file', src: '/electric%20shades/AE817EB0-346B-44F5-B551-508E4ABA1E91.mp4', title: 'WiFi shades', thumbnail: '/electric%20shades/AE817EB0-346B-44F5-B551-508E4ABA1E91.jpg' },
      { kind: 'file', src: '/electric%20shades/83D9716A-F87E-4EA0-83F0-4CA489240DEA.mp4', title: 'WiFi shades', thumbnail: '/electric%20shades/83D9716A-F87E-4EA0-83F0-4CA489240DEA.jpg' },
    ],
    images: [
      { src: '/electric%20shades/IMG_0097.jpg', alt: 'WiFi shades' },
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
    videos: [
      { kind: 'file', src: '/midi-controller/IMG_9666-1.mp4', title: 'MIDI controller', thumbnail: '/midi-controller/IMG_9666.jpg' },
    ],
    images: [
      { src: '/midi-controller/IMG_9666.jpg', alt: 'MIDI controller' },
      { src: '/midi-controller/IMG_9670-0001.png', alt: 'MIDI controller' },
    ],
    description:
      `A musician friend needed a simple MIDI peripheral custom-fitted to his needs, with just one knob and three programmable buttons.

I used an Arduino Leonardo knockoff from AliExpress and the Arduino IDE to set it up. The Leonardo is capable of sending MIDI over USB, so I programmed the buttons to act as MIDI channels. That way, my friend could easily assign each channel to whatever function he wanted in his DAW of choice, which was Ableton Live. For the buttons, I used mechanical keyboard switches and printed custom keycaps.`,
  },
]

