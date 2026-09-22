# sbl-projects

Source of [shaulb.com](https://shaulb.com): projects as square tiles scattered
over a 2D plane you explore like a map.

- **Map**: drag, swipe or scroll to pan; pinch or ctrl+scroll to zoom; arrow
  keys, `+`/`-` and `0` (home) on a keyboard. The minimap in the bottom-left corner shows
  the whole space and the region in view; press or drag on it to move there.
- **Contact links** (Instagram, LinkedIn, email, and "CV" in a pixel font) and the link to the film &
  art site (three stacked rows of text) are scattered elements too:
  bare icons, no frame or label, in the ring nearest the wordmark. They are plain links in
  `index.html`; `main.ts` lifts them onto the map.
- **The reel**: the "film & art projects" tile opens where it stands into a 16:9
  player, four times as wide, and the map fits it on screen; panning away folds
  it (`src/reel.ts`). The
  video streams from shaulbarlev.com: at 70 MB it is over this host's 25 MiB
  per-file limit.
- **Islands**: things out past the projects, there to be found, listed in
  `ISLANDS` in `src/projects.ts`. A picture (a tap only brings it into view), or
  a live page from elsewhere in a frame: the traffic light at home is the very
  page sbl.cx/traffic serves, its bare copy (`?bare`, no background), so the
  lamps, socket, name field, party button and master switch are that page's own.
- **Finding your way**: red marks what has not been opened yet, on the tiles, on
  the minimap and on the small markers at the edge of the screen that point at
  tiles out of view (tap one to fly there). Dragging past the edge of the world
  rubber-bands. The first visit of a session opens on the whole field while the
  tiles scatter out from the logo.
- **Projects** live in the map. Tapping a tile grows it, where it stands, into a
  page-shaped card with the tile's picture as its header (`src/card.ts`). On a
  wide screen the card fills most of the view and scrolls inside; on a phone it
  is as tall as its page and is read by panning the map, its top in view first.
  While a card is open a drag moves only up and down; a hard sideways pull, or
  panning until most of the card has left the view, folds it back into the
  tile. Every project has its own URL, `/<id>/`, which opens its card; `/pikud`
  is an extra entry for Pikud HaoLED.

## Adding a project

1. Put the media in `public/<folder>/`. `./scripts/mp4-thumbnails.sh` makes poster frames for videos.
2. Add an entry to `src/projects.ts`, and its id to `ORDER` there (earlier = closer to the centre of the map).
3. `npm run thumbs` to generate the square map tile (`public/thumbs/`) and the
   display-size pictures the project page loads (`public/m/`), and commit them.

The map lays itself out (`src/layout.ts`): same project list, same map. There are two
scatters, a loose one for wide screens and a dense one for phones, where the
tiles are packed close enough that several fill the screen.

## Layout of the code

| | |
|---|---|
| `src/projects.ts` | all content |
| `src/layout.ts` | scatters the tiles, sizes the world |
| `src/map.ts` | camera, drag / pinch / wheel input, inertia, rubber-band edges, minimap, edge markers |
| `src/project.ts` | project view (modal or page), `src/lightbox.ts` image viewer |
| `src/dive.ts` | the zoom between a tile and its project: a transform on the tile's picture, an opacity on the project |
| `src/main.ts` | wiring, routing, the opening sequence, seen state |
| `src/reel.ts` | the film & art tile opening into the reel |
| `vite.config.ts` | also writes `dist/<id>/index.html` per project, so project URLs work on any static host and share with their own title and image |
