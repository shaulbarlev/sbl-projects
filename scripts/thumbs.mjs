// Makes the pictures the site actually loads, from the originals under public/:
//   public/thumbs/<id>.jpg   640px square map tile, cropped from the project's thumbnail
//   public/thumbs/<id>-edges.jpg  the same as red edges on black, for the open card's header
//   public/m/<path>.jpg      every picture a project page shows, 1200px at most (the
//                            full-screen viewer still opens the original) Run after adding a project
// or changing a thumbnail: npm run thumbs
import { mkdir, readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transform } from 'esbuild'
import sharp from 'sharp'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { code } = await transform(await readFile(join(root, 'src/projects.ts'), 'utf8'), { loader: 'ts', format: 'esm' })
const { PROJECTS } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)

/** Sobel edge magnitude, thresholded at a share of the strongest edge, painted red on black. */
async function edges(src) {
  const RED = [239, 68, 68]
  const { data: g, info } = await sharp(src).rotate().resize(640, 640, { fit: 'cover' }).grayscale().blur(1.2).raw().toBuffer({ resolveWithObject: true })
  const { width: w, height: h } = info
  const m = new Float32Array(w * h)
  let max = 0
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const p = (dx, dy) => g[(y + dy) * w + x + dx]
      const gx = -p(-1, -1) - 2 * p(-1, 0) - p(-1, 1) + p(1, -1) + 2 * p(1, 0) + p(1, 1)
      const gy = -p(-1, -1) - 2 * p(0, -1) - p(1, -1) + p(-1, 1) + 2 * p(0, 1) + p(1, 1)
      const v = Math.hypot(gx, gy)
      m[y * w + x] = v
      if (v > max) max = v
    }
  const th = max * 0.18
  const out = Buffer.alloc(w * h * 3)
  for (let i = 0; i < w * h; i++) {
    const on = m[i] > th
    out[i * 3] = on ? RED[0] : 0
    out[i * 3 + 1] = on ? RED[1] : 0
    out[i * 3 + 2] = on ? RED[2] : 0
  }
  return sharp(out, { raw: { width: w, height: h, channels: 3 } })
}

await mkdir(join(root, 'public/thumbs'), { recursive: true })
for (const p of PROJECTS) {
  const src = join(root, 'public', decodeURI(p.thumbnail.src))
  const out = join(root, 'public/thumbs', `${p.id}.jpg`)
  const { size } = await sharp(src).rotate().resize(640, 640, { fit: 'cover' }).jpeg({ quality: 82, mozjpeg: true }).toFile(out)
  const lines = await (await edges(src)).jpeg({ quality: 80, mozjpeg: true }).toFile(join(root, 'public/thumbs', `${p.id}-edges.jpg`))
  console.log(`${p.id}  ${(size / 1024).toFixed(0)} KB, edges ${(lines.size / 1024).toFixed(0)} KB`)
}

const shown = new Set()
for (const p of PROJECTS) {
  for (const m of p.media ?? []) shown.add(m.type === 'image' ? m.src : m.thumbnail)
  shown.add(p.asideImage?.src)
}
shown.delete(undefined)
let before = 0
let after = 0
for (const src of shown) {
  const file = join(root, 'public', decodeURI(src))
  const out = join(root, 'public/m', `${decodeURI(src)}.jpg`)
  await mkdir(dirname(out), { recursive: true })
  const { size } = await sharp(file)
    .rotate()
    .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#000' })
    .jpeg({ quality: 80, mozjpeg: true })
    .toFile(out)
  before += (await stat(file)).size
  after += size
}
console.log(`${shown.size} display pictures: ${(before / 1e6).toFixed(1)} MB of originals -> ${(after / 1e6).toFixed(1)} MB`)
