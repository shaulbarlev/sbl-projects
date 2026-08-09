# skin

A dynamic redirect for one QR code. `q.shaulb.com` is a printed, permanent
address; where it *points* is changed in a couple of taps from an iPhone Action
Button.

Runs as a single Cloudflare Worker. State lives in a Durable Object, uploads in
R2.

## The model

Two slots:

| slot | lifetime | wins? |
| --- | --- | --- |
| **main** | until you change it | served when no temp is live |
| **temp** | until its deadline | served whenever it is live |

The resolver is `src/resolve.ts` and it is the whole product:

```
temp is set and not expired  ->  temp
otherwise, main is set       ->  main
otherwise                    ->  FALLBACK_URL
```

Three things about this are deliberate:

- **Setting main while a temp is live does not cancel the temp.** It changes
  what the temp reverts *to*. If you want the temp gone, press **End now**.
- **Expiry is evaluated on read, every time.** The Durable Object alarm only
  wakes the object so an open panel updates promptly. If every alarm on the
  platform failed, the redirect would still be correct.
- **The fallback is never an error.** A QR that resolves to a 404 is worse than
  one that resolves somewhere boring.

## Behaviour worth knowing

- **302, never 301.** A permanent redirect is cached near-indefinitely by every
  device that ever scanned the code, and cannot be taken back.
- **Unknown paths resolve too.** `q.shaulb.com/anything` goes where `/` goes, so
  a stray character in a scan still lands.
- **Link unfurlers skip the splash** and get a plain 302, so pasting the URL
  into a chat previews the real destination.
- **The QR always encodes `https://`**, never the scheme of the request that
  generated it — this image gets printed.
- **Uploads are unrestricted in type and size, and served with
  `Content-Security-Policy: sandbox`.** They share an origin with the admin
  panel, so without that an uploaded `.html` or `.svg` could script against it
  and lift the session cookie. Files are never auto-deleted; remove them in the
  panel.
- **Only main asks for confirmation.** A temp expires on its own; main is the
  one that is still wrong three weeks later.

## Splash

Off by default; one global toggle. When on, scanners get an inlined HTML page
that redirects after the template's duration.

The current template is a placeholder — lowercase, ugly, two seconds — and
exists to prove the pipeline: registry, inlining, timing, reduced-motion bypass,
prefetch of the destination, `<meta refresh>` backstop for no-JS, skip link.

Add real ones in `src/splash/templates/` and register them in
`src/splash/index.ts`:

```ts
export interface SplashTemplate {
  id: string;
  label: string;
  render(ctx: SplashContext): {
    html: string;
    css: string;
    js?: string;
    durationMs: number;
  };
}
```

Everything is inlined into a single response. That is the point: zero extra
round trips on the cold cellular connection a QR scan usually happens on. The
shell caps duration at 5s, honours `prefers-reduced-motion` by skipping the
animation entirely, and performs the redirect itself — a template must not.

## Routes

| path | who | what |
| --- | --- | --- |
| `/*` | public | resolve and redirect (or splash) |
| `/f/<key>/<name>` | public | an uploaded file |
| `/_/` | you | the panel |
| `/_/?reset=1` | you | end any live temp, then show the panel |
| `/_/qr.svg` | you | the QR, always encoding https |
| `/_/export.json` | you | full state dump |

State is keyed by slug internally, defaulting to `""`, so a second independent
QR is a new key rather than a schema migration. There is no UI for that yet.

## Setup

```sh
npm install
cp .dev.vars.example .dev.vars     # local password + session secret
npm run dev
```

Deploying:

```sh
npx wrangler r2 bucket create skin-files
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET   # any long random string
npm run deploy
```

Then point `q.shaulb.com` at the Worker in the Cloudflare dashboard, and set
`FALLBACK_URL` in `wrangler.toml` to wherever an unconfigured scan should land.

### Action Button

Shortcuts → new shortcut → *Open URL* → `https://q.shaulb.com/_/` → assign to
the Action Button. The session cookie lasts 30 days, so it opens straight into
the panel. Use `/_/?reset=1` instead for a shortcut that kills a live temp on
sight.

## Auth

A single password, held in a Wrangler secret. Compared in constant time, never
stored in the cookie — the cookie is an HMAC-signed expiry. Repeated failures
lock the admin surface for 15 minutes. Writes require a custom header, so a
cross-origin form post cannot repoint your QR.

This is the interim answer. Cloudflare Access on `/_/*` is the intended
replacement.

## Tests

```sh
npm test          # 45 tests: resolver truth table, validation, auth, files
npm run typecheck
```

`scripts/ui-check.mjs` drives the panel in a real browser — the inlined client
JS is the part the suite cannot reach. It needs a running `npm run dev`:

```sh
node scripts/ui-check.mjs http://127.0.0.1:8787 <your-dev-password>
```

Note that under `wrangler dev` the configured `custom_domain` route makes the
Worker see its production hostname, so locally-resolved file targets point at
`https://q.shaulb.com/f/...`. That is correct in production and only an
inconvenience in local testing.

## Not built yet

Cloudflare Access, CI/CD, multiple slugs, per-template configuration, and any
splash template you would actually want a stranger to see.
