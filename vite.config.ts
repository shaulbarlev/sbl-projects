import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import { PROJECTS } from './src/projects'

const SITE = 'https://shaulb.com'

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/**
 * Writes dist/<project>/index.html for every project: the same app, with the
 * project's own title, description and share image. Project URLs then work on
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
      for (const p of PROJECTS) {
        const meta: Record<string, string> = {
          description: p.subtitle ?? p.title,
          'og:title': p.title,
          'og:description': p.subtitle ?? p.title,
          'og:image': `${SITE}/thumbs/${p.id}.jpg`,
          'og:url': `${SITE}/${p.id}/`,
          'og:image:width': '640',
          'og:image:height': '640',
          'twitter:card': 'summary',
          'twitter:title': p.title,
          'twitter:description': p.subtitle ?? p.title,
          'twitter:image': `${SITE}/thumbs/${p.id}.jpg`,
        }
        let html = template.replace(/<title>[^<]*<\/title>/, `<title>${escapeAttr(p.title)} — shaul bar-lev</title>`)
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

// Built for Cloudflare Pages at https://shaulb.com
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
