import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import { CATEGORIES, PROJECTS } from './src/projects'

const SITE = 'https://shaulb.com'

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/**
 * Writes dist/<project>/index.html for every project, dist/<category>/index.html
 * for every category, and dist/pikud.html: the same app, with its own title,
 * description and share image. Copies of index.html, so they never drift from it. Project URLs then work on
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
      // shaulb.com/pikud: Pikud HaoLED with its own Hebrew share card, written as dist/pikud.html
      const pikud = {
        id: 'pikud',
        file: 'pikud.html',
        url: `${SITE}/pikud`,
        title: 'Pikud HaoLED',
        subtitle: 'ערכת תאורה פשוטה שמגיבה ונדלקת בהתאם להתראות פיקוד העורף',
        image: `${SITE}/pikudhaoled/pikudhaoled-0.jpg`,
        w: '1200',
        h: '630',
        card: 'summary_large_image',
      }
      for (const p of [...projects, ...categories, pikud] as { id: string; file?: string; url?: string; title: string; subtitle: string; image: string; w: string; h: string; card: string }[]) {
        const meta: Record<string, string> = {
          description: p.subtitle,
          'og:title': p.title,
          'og:description': p.subtitle,
          'og:image': p.image,
          'og:url': p.url ?? `${SITE}/${p.id}/`,
          'og:image:width': p.w,
          'og:image:height': p.h,
          'twitter:card': p.card,
          'twitter:title': p.title,
          'twitter:description': p.subtitle,
          'twitter:image': p.image,
        }
        const title = p.title.includes('shaul bar-lev') || p.file ? p.title : `${p.title} — shaul bar-lev`
        let html = template.replace(/<title>[^<]*<\/title>/, `<title>${escapeAttr(title)}</title>`)
        for (const [name, content] of Object.entries(meta)) {
          const tag = new RegExp(`(<meta\\s+(?:name|property)="${name}"\\s+content=")[^"]*(")`)
          if (!tag.test(html)) throw new Error(`project-pages: no <meta ${name}> in index.html`)
          html = html.replace(tag, (_, open, close) => open + escapeAttr(content) + close)
        }
        if (p.file) await writeFile(resolve(outDir, p.file), html)
        else {
          await mkdir(resolve(outDir, p.id), { recursive: true })
          await writeFile(resolve(outDir, p.id, 'index.html'), html)
        }
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
      input: { main: resolve(__dirname, 'index.html') },
    },
  },
})
