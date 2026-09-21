# sbl-projects

Source of [shaulb.com](https://shaulb.com): projects as square tiles scattered
over a 2D plane you explore like a map.

- **Map**: drag, swipe or scroll to pan; pinch or ctrl+scroll to zoom; arrow
  keys, `+`/`-` and `0` (home) on a keyboard. The minimap in the corner shows
  the whole space and the region in view; press or drag on it to move there.
- **Projects**: every project has its own URL, `/<id>/`. On wide screens it
  opens as a modal over the map, on narrow ones it is a page of its own with a
  back link. `/pikud` is an extra entry for Pikud HaoLED with its own share card.
- Vite + TypeScript, no framework. Deployed by Cloudflare Workers Builds as static
  assets (`wrangler.jsonc`): `npm run build`, output `dist`.

## Adding a project

1. Put the media in `public/<folder>/`. `./scripts/mp4-thumbnails.sh` makes poster frames for videos.
2. Add an entry to `src/projects.ts`, and its id to `ORDER` there (earlier = closer to the centre of the map).
3. `npm run thumbs` to generate the square map tile in `public/thumbs/`, and commit it.

The map lays itself out (`src/layout.ts`): same project list, same map. There are two
scatters, a loose one for wide screens and a dense one for phones, where the
tiles are packed close enough that several fill the screen.

## Layout of the code

| | |
|---|---|
| `src/projects.ts` | all content |
| `src/layout.ts` | scatters the tiles, sizes the world |
| `src/map.ts` | camera, drag / pinch / wheel input, inertia, minimap |
| `src/project.ts` | project view (modal or page), `src/lightbox.ts` image viewer |
| `src/main.ts` | wiring and routing |
| `vite.config.ts` | also writes `dist/<id>/index.html` per project, so project URLs work on any static host and share with their own title and image |
