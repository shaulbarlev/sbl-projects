# sbl-projects

Source of [shaulb.com](https://shaulb.com): work in three categories, ux/ui, vfx
and electronics, on a 2D plane you explore like a map.

- **Categories**: the landing is the wordmark with three title-only tiles stacked
  under it. Opening one (`/ux/`, `/vfx/`, `/electronics/`, a history entry of its
  own) sinks the rest of the map back and dims it, and shoots the category's
  children out of it into an even grid below the column (four across, two on a
  phone), tied to it by threads. A tap on nothing, the open category, the back
  node at the top of the screen, Escape or browser back folds them in again; a
  tap on another category switches. Listed in `CATEGORIES` in `src/projects.ts`.

- **Map**: drag, swipe or scroll to pan; pinch or ctrl+scroll to zoom; arrow
  keys, `+`/`-` and `0` (home) on a keyboard. The minimap in the bottom-left corner shows
  the whole space and the region in view; press or drag on it to move there.
- **Contact links** (email, "CV" in a pixel font, LinkedIn, Instagram) are small
  bare icons in a row above the wordmark, no frame or label. They are plain links in
  `index.html`; `main.ts` lifts them onto the map.
- **The reel**: vfx's one tile, "watch my reel", opens where it stands into a 16:9
  player and the map fits it on screen; panning away folds it (`src/reel.ts`). The
  video is a file of the QR Worker's (R2, `/f/…`, served with range
  requests): at 70 MB it is over this host's 25 MiB per-file limit.
- **Islands**: things out past the projects, there to be found, listed in
  `ISLANDS` in `src/projects.ts`. A picture (a tap only brings it into view), or
  a live page from elsewhere in a frame: the traffic light at home is the very
  page sbl.cx/traffic serves, its bare copy (`?bare`, no background), so the
  lamps, socket, name field, party button and master switch are that page's own.
- **Finding your way**: red marks what has not been opened yet (a category, until
  everything in it has been), on the tiles, on
  the minimap and on the small markers at the edge of the screen that point at
  tiles out of view (tap one to fly there). Dragging past the edge of the world
  rubber-bands. Every visit opens on the whole field while the
  root's tiles scatter out from the logo.
- **Projects** live in the map. Tapping a tile grows it, where it stands, into a
  page-shaped card with the tile's picture as its header (`src/card.ts`). On a
  wide screen the card fills most of the view and scrolls inside; on a phone it
  is as tall as its page and is read by panning the map, its top in view first.
  While a card is open a drag moves only up and down; a hard sideways pull, or
  panning until most of the card has left the view, folds it back into the
  tile. Every project has its own URL, `/<id>/`: arriving by one plays the opening
  (the field drawn, the flight) to that project's tile and grows its card from
  it, after its category's children have landed; `/pikud` is an extra entry for
  Pikud HaoLED. A card's media can be rows of short silent loops (`type: 'row'`,
  `loop: true`).

## The QR Worker, in `qr/`

`sbl.cx` is also a printed QR code whose destination changes from a panel. That
Worker lives in `qr/` (it was its own repo, `skin`, until 2026-09-22) and is
what serves this site at sbl.cx, through a service binding. It has its own
`package.json`, tests and deploy: see `qr/README.md` and `qr/docs/`.

## Adding a project

1. Put the media in `public/<folder>/`. `./scripts/mp4-thumbnails.sh` makes poster frames for videos.
2. Add an entry to `src/projects.ts`, and its id to its category's `children` in `CATEGORIES` (electronics: `ORDER`), earlier = nearer the top-left of the grid.
3. `npm run thumbs` to generate the square map tile (`public/thumbs/`) and the
   display-size pictures the project page loads (`public/m/`), and commit them.

The map lays itself out (`src/layout.ts`): same lists, same map, one profile for
wide screens and one for phones. Every category's grid is laid out from the
start, so the world is the size of the largest and opening one moves nothing.

## Layout of the code

| | |
|---|---|
| `src/projects.ts` | all content |
| `src/layout.ts` | places home, the category column, the grids, the links and islands; sizes the world |
| `src/map.ts` | camera, drag / pinch / wheel input, inertia, rubber-band edges, minimap, edge markers |
| `src/project.ts` | project view (modal or page), `src/lightbox.ts` image viewer |
| `src/card.ts` | a tile growing into its page-shaped card in map space, and folding back |
| `src/main.ts` | wiring, categories (sink, cascade, threads), routing, the opening sequence, seen state |
| `src/reel.ts` | the vfx tile opening into the reel |
| `vite.config.ts` | also writes `dist/<id>/index.html` per project and per category, so their URLs work on any static host and share with their own title and image |
