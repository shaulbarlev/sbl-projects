/**
 * Scatters the tiles over the world. Deterministic: the same project list
 * always gives the same map, so adding a project never needs layout work.
 */

export type Rect = { x: number; y: number; w: number; h: number }
export type Tile = Rect & { id: string }
export type World = { w: number; h: number; home: Rect; tiles: Tile[] }

const SIZES = [300, 220, 260, 200, 280, 240]
const ASPECT = 1.35
const HOME = { w: 460, h: 300 }
/** Room under each tile for its title */
const LABEL = 56
const GAP = 100
const MARGIN = 300

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

export function scatter(ids: string[], seed = 11): World {
  const rand = mulberry32(seed)
  // Placed around home at the origin; the world is fitted to the result below.
  const home: Rect = { x: -HOME.w / 2, y: -HOME.h / 2, ...HOME }
  const taken: Rect[] = [home]

  const tiles = ids.map((id, i): Tile => {
    const size = SIZES[i % SIZES.length]
    // Golden-angle steps spread the tiles around home; the ring widens with
    // every project (by sqrt, so density stays even) and every failed try, so
    // list order is roughly distance order.
    let angle = i * 2.39996 + rand() * 0.9
    for (let attempt = 0; ; attempt++) {
      const r = 250 + Math.sqrt(i) * 190 + attempt * 3
      const rect: Rect = {
        x: Math.round(Math.cos(angle) * r * ASPECT - size / 2),
        y: Math.round(Math.sin(angle) * r - size / 2),
        w: size,
        h: size + LABEL,
      }
      if (!taken.some((t) => overlaps(rect, t, GAP))) {
        taken.push(rect)
        return { id, x: rect.x, y: rect.y, w: size, h: size }
      }
      angle = rand() * Math.PI * 2
    }
  })

  const left = Math.min(...taken.map((t) => t.x)) - MARGIN
  const top = Math.min(...taken.map((t) => t.y)) - MARGIN
  const right = Math.max(...taken.map((t) => t.x + t.w)) + MARGIN
  const bottom = Math.max(...taken.map((t) => t.y + t.h)) + MARGIN
  const shift = <T extends Rect>(r: T): T => ({ ...r, x: r.x - left, y: r.y - top })

  return { w: right - left, h: bottom - top, home: shift(home), tiles: tiles.map(shift) }
}
