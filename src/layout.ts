/**
 * Scatters the tiles over the world. Deterministic: the same project list
 * always gives the same map, so adding a project never needs layout work.
 */

export type Rect = { x: number; y: number; w: number; h: number }
export type Tile = Rect & { id: string }
/**
 * `links` are the small tiles that hug home, `categories` the column under it,
 * `children` each category's grid (all laid out at once, shown one at a time),
 * `islands` the passive pictures out past everything. `tiles` is what the map's
 * minimap and edge markers point at right now: the categories, or the open grid.
 * `origin` is the middle of the wordmark and its column: what the camera calls home.
 */
export type World = {
  w: number
  h: number
  home: Rect
  origin: { x: number; y: number }
  links: Tile[]
  categories: Tile[]
  children: Record<string, Tile[]>
  tiles: Tile[]
  islands: Tile[]
}
/** A passive picture and its size on a wide screen */
export type Island = { id: string; w: number; h: number }

/** Sizes and spacing: phones get smaller tiles, two to a row. */
export type Profile = {
  /** A category: a title-only tile, the gap between them in the column, and (`top`) the same gap under the wordmark */
  category: { w: number; h: number; gap: number; /** below the wordmark block */ top: number }
  /** A category's children: one size, `cols` across, starting `top` below the column */
  grid: { size: number; cols: number; gap: number; top: number }
  /** The wordmark block: its size, and how far its box sits below the logo's centre */
  home: { w: number; h: number; drop: number }
  /** Room under each tile for its title, up to three lines */
  label: number
  /** Empty border around everything */
  margin: number
  /** Horizontal stretch of the directions links and islands are pushed along */
  aspect: number
  /** Islands: how far past the outermost project they start, their clearance, and their size relative to a wide screen's */
  island: { beyond: number; gap: number; scale: number }
  /** The contact tiles: a small row centred above the wordmark, `above` its block */
  link: { size: number; gap: number; above: number }
}

export const WIDE: Profile = {
  // as wide as the wordmark's block above them
  category: { w: 286, h: 52, gap: 11, top: 11 },
  grid: { size: 240, cols: 4, gap: 36, top: 90 },
  home: { w: 286, h: 174, drop: 0 },
  label: 72,
  margin: 300,
  aspect: 1.35,
  island: { beyond: 240, gap: 160, scale: 1 },
  link: { size: 48, gap: 20, above: 16 },
}

export const NARROW: Profile = {
  category: { w: 207, h: 46, gap: 7, top: 7 },
  grid: { size: 160, cols: 2, gap: 16, top: 60 },
  home: { w: 207, h: 126, drop: 0 },
  label: 64,
  margin: 120,
  aspect: 0.8,
  island: { beyond: 130, gap: 70, scale: 0.72 },
  link: { size: 40, gap: 16, above: 12 },
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

/**
 * Lays the map out. Root: the wordmark, the categories stacked under it, the
 * contact tiles around it, and the islands far out. Every category's grid sits
 * below the column, centred on it, so a grid never hides the other categories;
 * the grids overlap each other, which is fine as only one is ever open. The
 * world is sized for the largest of them from the start, so opening one moves
 * nothing.
 */
/**
 * `peek`: an island placed so that only its left edge shows at the right of the
 * home view, a hint that there is more; `view` is the viewport's width (world px at
 * the home zoom of 1), `px` how much of it shows.
 */
export function scatter(
  categories: { id: string; children: string[]; wide?: boolean }[],
  linkIds: string[],
  islandList: Island[],
  profile: Profile,
  peek?: { id: string; view: number; px: number },
  seed = 11,
): World {
  const { label, margin, aspect, link, island, category, grid } = profile
  const rand = mulberry32(seed)
  // Placed around home at the origin; the world is fitted to the result below.
  const { w: hw, h: hh, drop } = profile.home
  const home: Rect = { x: -hw / 2, y: -hh / 2 + drop, w: hw, h: hh }
  const taken: Rect[] = [home]

  const cats = categories.map(({ id }, i): Tile => {
    const rect = { id, x: -category.w / 2, y: home.y + home.h + category.top + i * (category.h + category.gap), w: category.w, h: category.h }
    taken.push(rect)
    return rect
  })
  const columnEnd = Math.max(home.y + home.h, ...cats.map((t) => t.y + t.h))

  // The contact tiles: one row, centred over the wordmark.
  const rowW = linkIds.length * (link.size + link.gap) - link.gap
  const links = linkIds.map((id, i): Tile => {
    const rect = { id, x: Math.round(-rowW / 2 + i * (link.size + link.gap)), y: Math.round(home.y - link.above - link.size), w: link.size, h: link.size }
    taken.push(rect)
    return rect
  })

  // Rows of `cols`, the last row centred; the label sits under each picture.
  const children: Record<string, Tile[]> = {}
  const gridRects: Rect[] = []
  for (const { id, children: ids, wide } of categories) {
    // A wide category's tiles are 16:9 and two columns across, one to a row.
    const w = wide ? grid.size * 2 + grid.gap : grid.size
    const h = wide ? Math.round((w * 9) / 16) : grid.size
    const cols = wide ? 1 : grid.cols
    children[id] = ids.map((child, i) => {
      const row = Math.floor(i / cols)
      const inRow = Math.min(cols, ids.length - row * cols)
      const x = -(inRow * (w + grid.gap) - grid.gap) / 2 + (i % cols) * (w + grid.gap)
      return { id: child, x: Math.round(x), y: Math.round(columnEnd + grid.top + row * (h + label + grid.gap)), w, h }
    })
    gridRects.push(...children[id].map((t) => ({ ...t, h: t.h + label })))
  }

  // The outskirts: each island starts beyond everything else, in a direction of its own, and is pushed out until clear.
  const all = [...taken, ...gridRects]
  const reach = Math.max(0, ...all.map((t) => Math.hypot(t.x + t.w / 2, t.y + t.h / 2) + Math.max(t.w, t.h) / 2))
  // Home's middle, as the camera will centre it (the origin below, before the shift).
  const homeY = (Math.min(home.y, ...links.map((t) => t.y)) + columnEnd) / 2
  const islands = islandList.map(({ id, w, h }): Tile => {
    const angle = rand() * Math.PI * 2
    const size = { w: Math.round(w * island.scale), h: Math.round(h * island.scale) }
    if (peek?.id === id) {
      // its left edge `px` in from the right of the home view, level with home
      const rect: Rect = { x: Math.round(peek.view / 2 - peek.px), y: Math.round(homeY - size.h / 2), ...size }
      taken.push(rect)
      return { id, ...rect }
    }
    for (let r = reach + island.beyond; ; r += 6) {
      const rect: Rect = { x: Math.round(Math.cos(angle) * r * aspect - size.w / 2), y: Math.round(Math.sin(angle) * r - size.h / 2), ...size }
      if (![...all, ...taken].some((t) => overlaps(rect, t, island.gap))) {
        taken.push(rect)
        return { id, ...rect }
      }
    }
  })

  const every = [...taken, ...gridRects]
  // Even either side of home: a view wider than the world centres the world, and home must be in that centre.
  const half = Math.max(-Math.min(...every.map((t) => t.x)), Math.max(...every.map((t) => t.x + t.w))) + margin
  const left = -half
  const top = Math.min(...every.map((t) => t.y)) - margin
  const right = half
  const bottom = Math.max(...every.map((t) => t.y + t.h)) + margin
  const shift = <T extends Rect>(r: T): T => ({ ...r, x: r.x - left, y: r.y - top })
  const shifted = shift(home)
  const categoriesShifted = cats.map(shift)

  return {
    w: right - left,
    h: bottom - top,
    home: shifted,
    // Home is the link row, the wordmark and its column: all in view, centred together.
    origin: { x: -left, y: homeY - top },
    links: links.map(shift),
    categories: categoriesShifted,
    children: Object.fromEntries(Object.entries(children).map(([id, list]) => [id, list.map(shift)])),
    tiles: categoriesShifted,
    islands: islands.map(shift),
  }
}
