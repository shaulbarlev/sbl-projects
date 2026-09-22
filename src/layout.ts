/**
 * Scatters the tiles over the world. Deterministic: the same project list
 * always gives the same map, so adding a project never needs layout work.
 */

export type Rect = { x: number; y: number; w: number; h: number }
export type Tile = Rect & { id: string }
/** `links` are the small tiles that hug home, `tiles` the projects, `islands` the passive pictures out past them. */
/** `origin` is the wordmark's centre: what the camera calls home and the readout counts from. */
export type World = { w: number; h: number; home: Rect; origin: { x: number; y: number }; links: Tile[]; tiles: Tile[]; islands: Tile[] }
/** A passive picture and its size on a wide screen */
export type Island = { id: string; w: number; h: number }

/** How loosely to scatter: phones get small tiles packed close, so several fill the screen. */
export type Profile = {
  sizes: number[]
  /** The wordmark block: its size, and how far its box sits below the logo's centre (half the hint line under it) */
  home: { w: number; h: number; drop: number }
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
  /** Islands: how far past the outermost project they start, their clearance, and their size relative to a wide screen's */
  island: { beyond: number; gap: number; scale: number }
  /** The contact tiles: small, and let in closer to home and to each other than projects are */
  link: { size: number; label: number; gap: number; /** directions from home, in degrees, clockwise from east */ angles: number[] }
}

export const WIDE: Profile = {
  sizes: [300, 220, 260, 200, 280, 240],
  home: { w: 240, h: 184, drop: 21 },
  label: 56,
  gap: 100,
  margin: 300,
  ring: 250,
  spread: 190,
  aspect: 1.35,
  island: { beyond: 240, gap: 160, scale: 1 },
  link: { size: 96, label: 0, gap: 40, angles: [45, 135, 225, 315, 0] },
}

export const NARROW: Profile = {
  sizes: [240, 180, 210, 170, 230, 190],
  home: { w: 176, h: 137, drop: 17 },
  label: 44,
  gap: 24,
  margin: 120,
  ring: 170,
  spread: 150,
  aspect: 0.8,
  island: { beyond: 130, gap: 70, scale: 0.72 },
  // chosen so that all five fit across a phone with the wordmark: two above, and
  // below it two fanned out wide with the fifth between them, straight down
  link: { size: 72, label: 0, gap: 18, angles: [48, 132, 244, 296, 90] },
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

export function scatter(ids: string[], linkIds: string[], islandList: Island[], profile: Profile, seed = 11): World {
  const { sizes, label, gap, margin, ring, spread, aspect, link, island } = profile
  const rand = mulberry32(seed)
  // Placed around home at the origin; the world is fitted to the result below.
  const { w: hw, h: hh, drop } = profile.home
  const home: Rect = { x: -hw / 2, y: -hh / 2 + drop, w: hw, h: hh }
  const taken: Rect[] = [home]

  // The contact tiles go first and nearest: each is pushed out from home along
  // its own direction (a little off true, so they do not look ruled) until it
  // clears what is already there.
  const links = linkIds.map((id, i): Tile => {
    const angle = ((link.angles[i % link.angles.length] + (rand() - 0.5) * 14) * Math.PI) / 180
    for (let r = 0; ; r += 3) {
      const rect: Rect = {
        x: Math.round(Math.cos(angle) * r * aspect - link.size / 2),
        y: Math.round(Math.sin(angle) * r - link.size / 2),
        w: link.size,
        h: link.size + link.label,
      }
      if (!taken.some((t) => overlaps(rect, t, link.gap))) {
        taken.push(rect)
        return { id, x: rect.x, y: rect.y, w: link.size, h: link.size }
      }
    }
  })

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

  // The outskirts: each island starts beyond the outermost project, in a direction of its own, and is pushed out until clear.
  const reach = Math.max(0, ...tiles.map((t) => Math.hypot(t.x + t.w / 2, t.y + t.h / 2) + t.w / 2))
  const islands = islandList.map(({ id, w, h }): Tile => {
    const angle = rand() * Math.PI * 2
    const size = { w: Math.round(w * island.scale), h: Math.round(h * island.scale) }
    for (let r = reach + island.beyond; ; r += 6) {
      const rect: Rect = { x: Math.round(Math.cos(angle) * r * aspect - size.w / 2), y: Math.round(Math.sin(angle) * r - size.h / 2), ...size }
      if (!taken.some((t) => overlaps(rect, t, island.gap))) {
        taken.push(rect)
        return { id, ...rect }
      }
    }
  })

  const left = Math.min(...taken.map((t) => t.x)) - margin
  const top = Math.min(...taken.map((t) => t.y)) - margin
  const right = Math.max(...taken.map((t) => t.x + t.w)) + margin
  const bottom = Math.max(...taken.map((t) => t.y + t.h)) + margin
  const shift = <T extends Rect>(r: T): T => ({ ...r, x: r.x - left, y: r.y - top })

  return { w: right - left, h: bottom - top, home: shift(home), origin: { x: -left, y: -top }, links: links.map(shift), tiles: tiles.map(shift), islands: islands.map(shift) }
}
