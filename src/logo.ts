/**
 * The name flickers between thin and bold letter by letter, then settles into
 * slow red waves. Click to replay.
 */
export function animateLogo(el: HTMLElement) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return

  // One span per letter; the <br> stays where it is.
  const chars: HTMLElement[] = []
  for (const node of [...el.childNodes]) {
    if (node.nodeType !== Node.TEXT_NODE) continue
    const spans = [...(node.textContent ?? '').trim()].map((c) => {
      const s = document.createElement('span')
      s.textContent = c
      return s
    })
    chars.push(...spans)
    node.replaceWith(...spans)
  }
  el.setAttribute('aria-label', 'shaul bar-lev')

  const shuffled = () =>
    chars
      .map((c) => [Math.random(), c] as const)
      .sort((a, b) => a[0] - b[0])
      .map(([, c]) => c)

  let running: Animation[] = []
  const play = () => {
    running.forEach((a) => a.cancel())
    running = [
      ...shuffled().map((c, i) =>
        c.animate([{ fontWeight: 100 }, { fontWeight: 800 }], {
          duration: 50,
          delay: i * 70,
          // 1s of blinking more than the original 23, at the same speed; odd, so it ends bold
          iterations: 43,
          direction: 'alternate',
          fill: 'forwards',
        }),
      ),
      ...shuffled().map((c, i) =>
        c.animate(
          [
            { fontWeight: 800, color: '#fff' },
            { fontWeight: 100, color: '#c97979' },
          ],
          {
            duration: 2500,
            delay: 2900 + i * 600,
            iterations: 31,
            direction: 'alternate',
            // smooth, so the variable weight swells rather than ticks (the original's gsap default, power1.out)
            easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
            fill: 'forwards',
          },
        ),
      ),
    ]
  }

  el.addEventListener('click', play)
  play()
}
