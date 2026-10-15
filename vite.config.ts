import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import { CATEGORIES, PROJECTS } from './src/projects'

const SITE = 'https://shaulb.com'

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/**
 * Writes dist/<project>/index.html for every project, and dist/<category>/index.html
 * for every category: the same app, with its own title, description and share image. Project URLs then work on
 * any static host without rewrite rules, and link previews show the project.
 */
function projectPages(): Plugin {
  let outDir = 'dist'
  return {
    name: 'project-pages',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    async closeBundle() {
      const template = await readFile(resolve(outDir, 'index.html'), 'utf8')
      const categories = CATEGORIES.map((c) => ({ id: c.id, title: `${c.title} — shaul bar-lev`, subtitle: 'Design, film, electronics', image: `${SITE}/og-image.jpg`, w: '1200', h: '630', card: 'summary_large_image' }))
      const projects = PROJECTS.map((p) => ({ id: p.id, title: p.title, subtitle: p.subtitle ?? p.title, image: `${SITE}/thumbs/${p.id}.jpg`, w: '640', h: '640', card: 'summary' }))
      for (const p of [...projects, ...categories]) {
        const meta: Record<string, string> = {
          description: p.subtitle,
          'og:title': p.title,
          'og:description': p.subtitle,
          'og:image': p.image,
          'og:url': `${SITE}/${p.id}/`,
          'og:image:width': p.w,
          'og:image:height': p.h,
          'twitter:card': p.card,
          'twitter:title': p.title,
          'twitter:description': p.subtitle,
          'twitter:image': p.image,
        }
        const title = p.title.includes('shaul bar-lev') ? p.title : `${p.title} — shaul bar-lev`
        let html = template.replace(/<title>[^<]*<\/title>/, `<title>${escapeAttr(title)}</title>`)
        for (const [name, content] of Object.entries(meta)) {
          const tag = new RegExp(`(<meta\\s+(?:name|property)="${name}"\\s+content=")[^"]*(")`)
          if (!tag.test(html)) throw new Error(`project-pages: no <meta ${name}> in index.html`)
          html = html.replace(tag, (_, open, close) => open + escapeAttr(content) + close)
        }
        await mkdir(resolve(outDir, p.id), { recursive: true })
        await writeFile(resolve(outDir, p.id, 'index.html'), html)
      }
    },
  }
}

// Deployed by Cloudflare Workers Builds (see wrangler.jsonc); served at https://shaulb.com (sbl.cx is the QR; it sends visitors here)
export default defineConfig({
  base: '/',
  plugins: [projectPages()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        // shaulb.com/pikud: the Pikud HaoLED project with its own Hebrew share card
        pikud: resolve(__dirname, 'pikud.html'),
      },
    },
  },
})
