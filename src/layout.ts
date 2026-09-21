/**
 * Scatters the tiles over the world. Deterministic: the same project list
 * always gives the same map, so adding a project never needs layout work.
 */

export type Rect = { x: number; y: number; w: number; h: number }
export type Tile = Rect & { id: string }
export type World = { w: number; h: number; home: Rect; tiles: Tile[] }

/** How loosely to scatter: phones get small tiles packed close, so several fill the screen. */
export type Profile = {
  sizes: number[]
  home: { w: number; h: number }
  /** Room under each tile for its title */
  label: number
  gap: number
  /** Empty border around everything */
  margin: number
  /** Radius of the first ring, and how fast the rings widen */
  ring: number
  spread: number
  /** Horizontal stretch of the rings */
  aspect: number
}

export const WIDE: Profile = {
  sizes: [300, 220, 260, 200, 280, 240],
  home: { w: 460, h: 300 },
  label: 56,
  gap: 100,
  margin: 300,
  ring: 250,
  spread: 190,
  aspect: 1.35,
}

export const NARROW: Profile = {
  sizes: [240, 180, 210, 170, 230, 190],
  home: { w: 250, h: 240 },
  label: 44,
  gap: 24,
  margin: 120,
  ring: 170,
  spread: 150,
  aspect: 0.8,
}

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function overlaps(a: Rect, b: Rect, gap: number) {
  return (
    a.x < b.x + b.w + gap &&
    b.x < a.x + a.w + gap &&
    a.y < b.y + b.h + gap &&
    b.y < a.y + a.h + gap
  )
}

export function scatter(ids: string[], profile: Profile, seed = 11): World {
  const { sizes, label, gap, margin, ring, spread, aspect } = profile
  const rand = mulberry32(seed)
  // Placed around home at the origin; the world is fitted to the result below.
  const home: Rect = { x: -profile.home.w / 2, y: -profile.home.h / 2, ...profile.home }
  const taken: Rect[] = [home]

  const tiles = ids.map((id, i): Tile => {
    const size = sizes[i % sizes.length]
    // Golden-angle steps spread the tiles around home; the ring widens with
    // every project (by sqrt, so density stays even) and every failed try, so
    // list order is roughly distance order.
    let angle = i * 2.39996 + rand() * 0.9
    for (let attempt = 0; ; attempt++) {
      const r = ring + Math.sqrt(i) * spread + attempt * 3
      const rect: Rect = {
        x: Math.round(Math.cos(angle) * r * aspect - size / 2),
        y: Math.round(Math.sin(angle) * r - size / 2),
        w: size,
        h: size + label,
      }
      if (!taken.some((t) => overlaps(rect, t, gap))) {
        taken.push(rect)
        return { id, x: rect.x, y: rect.y, w: size, h: size }
      }
      angle = rand() * Math.PI * 2
    }
  })

  const left = Math.min(...taken.map((t) => t.x)) - margin
  const top = Math.min(...taken.map((t) => t.y)) - margin
  const right = Math.max(...taken.map((t) => t.x + t.w)) + margin
  const bottom = Math.max(...taken.map((t) => t.y + t.h)) + margin
  const shift = <T extends Rect>(r: T): T => ({ ...r, x: r.x - left, y: r.y - top })

  return { w: right - left, h: bottom - top, home: shift(home), tiles: tiles.map(shift) }
}
