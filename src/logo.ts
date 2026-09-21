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
          iterations: 23,
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
            delay: 1900 + i * 600,
            iterations: 31,
            direction: 'alternate',
            easing: 'steps(9, end)',
            fill: 'forwards',
          },
        ),
      ),
    ]
  }

  el.addEventListener('click', play)
  play()
}
