// Crops each project's thumbnail source to a 640px square at public/thumbs/<id>.jpg.
// The map loads these instead of the full-size photos. Run after adding a project
// or changing a thumbnail: npm run thumbs
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transform } from 'esbuild'
import sharp from 'sharp'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { code } = await transform(await readFile(join(root, 'src/projects.ts'), 'utf8'), { loader: 'ts', format: 'esm' })
const { PROJECTS } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)

await mkdir(join(root, 'public/thumbs'), { recursive: true })
for (const p of PROJECTS) {
  const src = join(root, 'public', decodeURI(p.thumbnail.src))
  const out = join(root, 'public/thumbs', `${p.id}.jpg`)
  const { size } = await sharp(src).rotate().resize(640, 640, { fit: 'cover' }).jpeg({ quality: 82, mozjpeg: true }).toFile(out)
  console.log(`${p.id}  ${(size / 1024).toFixed(0)} KB`)
}
