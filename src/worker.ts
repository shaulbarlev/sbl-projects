/**
 * The site's Worker: static assets, plus the old addresses sent on to the one
 * address. sbl.cx itself reaches these assets through a service binding from
 * the QR's Worker (repo skin), which owns that domain.
 */
const HOME = 'https://sbl.cx'
const OLD = new Set(['shaulb.com', 'www.shaulb.com', 'shaulbarlev.com', 'www.shaulbarlev.com'])

export default {
  fetch(request: Request, env: { ASSETS: { fetch(request: Request): Promise<Response> } }): Promise<Response> | Response {
    const url = new URL(request.url)
    // 301: these are moves for good, and nothing dynamic ever lived at them.
    if (OLD.has(url.hostname)) return Response.redirect(HOME + url.pathname + url.search, 301)
    return env.ASSETS.fetch(request)
  },
}
