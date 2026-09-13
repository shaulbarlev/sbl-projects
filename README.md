# skin

A dynamic redirect for one QR code. `sbl.cx` is a printed, permanent
address; where it *points* is changed in a couple of taps from an iPhone Action
Button.

Runs as a single Cloudflare Worker. State lives in a Durable Object, uploads in
R2.

## The model

| layer | lifetime | wins? |
| --- | --- | --- |
| **sequence** | until spent, or its deadline | intercepts while it has steps left |
| **temp** | until its deadline | served whenever it is live |
| **main** | until you change it | the default |
| fallback | — | only when main was never set |

The resolver is `src/resolve.ts` and it is the whole product:

```
sequence armed, unexpired, steps left  ->  next step, one per scanner
otherwise, temp set and not expired    ->  temp
otherwise, main is set                 ->  main
otherwise                              ->  FALLBACK_URL
```

A destination is one of four things: a **link**, an uploaded **file**, a
**message** — text rendered full-screen — or an **image set**, which serves a
different image on every scan. A message is a destination in its own right, not
a waypoint, so nothing on that page navigates anywhere. A **GIF** picked from
the Giphy search in the panel is copied into Files on selection, so it is just a
file: a scan never depends on Giphy's CDN, and it can go anywhere a file can.
A **GIF feed** is the other way to use a search: send the search itself, and
every scan gets the next result in order, paging through Giphy and wrapping
when it runs out. A feed is live by nature, so it is the one destination that
does lean on Giphy at scan time; if Giphy is down the scan falls back rather
than erroring.

Three things about this are deliberate:

- **Setting main while a temp is live does not cancel the temp.** It changes
  what the temp reverts *to*. If you want the temp gone, press **End now**.
- **Expiry is evaluated on read, every time.** The Durable Object alarm only
  wakes the object so an open panel updates promptly. If every alarm on the
  platform failed, the redirect would still be correct.
- **The fallback is never an error.** A QR that resolves to a 404 is worse than
  one that resolves somewhere boring.

## Sequence

Hand a different destination to each consecutive scanner. Four friends scan in
turn, each sees their own message, and when the list runs out scans go back to
whatever they were doing before.

Whether a step sticks to the phone that claimed it is a switch, **Each device
keeps its step**, off by default:

- **Off: every scan advances.** Reloading shows the next step. One person can
  walk through the whole list by refreshing, and no cookie is set.
- **On: a claimed step sticks to that device.** The scanner gets a cookie
  carrying the run id and their index, so reloading, locking the phone, or
  coming back later shows the same message. This is for holding four phones up
  at once: without it, friend #1 unlocking their phone would start showing
  friend #2's message and friend #4 would get nothing.

The counter is the easy part. What makes it usable is what does **not** consume
a step, in either mode:

- **Browser prefetch peeks without claiming.** iOS and Chrome speculatively
  fetch links and announce it via `Sec-Purpose: prefetch` and friends. Left
  unhandled, a prefetch eats the step meant for the person in front of you.
- **`HEAD` requests and link unfurlers never claim.**
- **A forged or stale cookie falls through** to normal resolution rather than
  grabbing a fresh step, so tampering cannot drain the queue. With the switch
  off, cookies are ignored altogether.

Claims are handed out inside the Durable Object, which is single-threaded, so
four people scanning at the same instant get four different steps rather than
racing for the same one.

An armed sequence carries a deadline (default 1 hour, same clamps as temp)
because one left armed by accident would ambush a stranger scanning the code
next week. Disarming — or running out of steps — keeps the steps so the same
sequence can be re-armed for the next group without retyping it. Re-arming
mints a new run id, which voids every claim from the previous run.

Editing steps mid-run leaves already-claimed positions alone, so you can fix a
typo in step 4 while steps 1 and 2 are out in the world.

## Image sets

Upload a pile of images, point the code at the set, and every scan serves a
different one. Create the set in **Library**, then *Add images* — the picker
takes several at once and uploads them one after another, because a dozen phone
photos fired off in parallel over a phone connection is a good way to have
several of them fail.

Images are drawn from a **shuffled bag**, not picked at random: every image in
the set comes up once before any repeats, and a reshuffle cannot put the same
image on both sides of the seam. Pure random selection would show a three-image
set the same picture twice running about a third of the time, which reads as a
bug rather than as randomness.

The draw happens inside the Durable Object and counts the scan in the same
round trip, so a set costs no more latency than any other destination and
concurrent scanners advance one shared bag instead of racing it.

A set is just a fourth kind of destination, so it works anywhere one does —
including as a sequence step, which gives each person in the queue their own
random image.

Two things a set must never do, both enforced:

- **An empty set is skipped**, not served. A temp pointing at an empty set
  falls through to main rather than dead-ending; main pointing at one falls
  through to the fallback.
- **Deleting a file removes it from every set that held it**, so a set can
  never hand out the key of an object that is gone.

Sets reference files in the Library rather than owning them, so deleting a set
leaves its images alone, and removing an image from a set does not delete it.

## Behaviour worth knowing

- **302, never 301.** A permanent redirect is cached near-indefinitely by every
  device that ever scanned the code, and cannot be taken back.
- **Unknown paths resolve too.** `sbl.cx/anything` goes where `/` goes, so
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

## The panel

Four tabs, at the bottom of the screen because this is used one-handed on a
large phone and the top is out of thumb reach. Above them, a status bar that is
present on every tab — you open this app to *check* as often as to change, and
the answer should never be more than a glance away.

**Tabs hold nouns; there is one verb.** Every destination — typed, bookmarked,
uploaded, or a whole image set — is committed through a single **Send** sheet
that rises above the tab bar. That is the only place a slot is chosen, so
"where does this go" is asked once instead of every list growing its own pair
of slot buttons and every slot growing its own composer.

| tab | what lives there |
| --- | --- |
| **Now** | live state, End now / +15m, and recents |
| **Destinations** | the composer, GIF search and feed, bookmarks, image sets, uploaded files |
| **Sequence** | the queue: live progress, per-device switch, arm deadline, arm and disarm, step order |
| **Settings** | splash toggle, the QR itself, scan count, export, sign out |

The sheet offers temporary (with the duration chips, so the duration lives with
the act it belongs to), main, and *add to sequence*. Which means a step can now
be anything a destination can be — a file or an image set, not just a link or a
message. All three land on one route, `POST /_/api/send`, and differ only by
`slot`; the API has as many ways to point the code somewhere as the sheet does,
which is one.

The order is by how often you reach for something. The tab is kept in the URL
hash, so reload and the back button both behave.

The look is neobrutalist — hard edges, offset shadows with no blur, square
corners, heavy type. Two rules keep the style from fighting the product:

- **State is a filled tag, never coloured text.** Small bold uppercase in a
  mid-tone green or amber is exactly where coloured type fails contrast. Black
  on a bright fill passes in both schemes and is louder anyway. In dark mode
  the hard edge inverts to near-white, or every border and shadow would vanish
  into the background.
- **Helvetica, and no web fonts.** This loads on the critical path of a phone
  in a hurry and the app is built to cost zero extra round trips; Helvetica is
  already on every Apple device this is opened from. It ships Regular, Medium
  and Bold and nothing between — 600, 700, 800 and 900 all render as the same
  Bold face — so the weight ladder is 500/700 and hierarchy is carried by
  size, tracking and case instead.

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

A scan of an image set redirects to `/f/<key>/<name>` like any other file, so
sets add no new public route.

State is keyed by slug internally, defaulting to `""`, so a second independent
QR is a new key rather than a schema migration. There is no UI for that yet.

## Setup

```sh
npm install
cp .dev.vars.example .dev.vars     # local password + session secret
npm run dev
```

First deploy:

```sh
npx wrangler r2 bucket create skin-files
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET   # any long random string
npx wrangler secret put GIPHY_API_KEY    # optional; enables the GIF search
npm run deploy
```

The GIF search proxies Giphy through the Worker so the key never reaches the
browser. Without the secret the panel says so instead of failing quietly.

`FALLBACK_URL` lives in `wrangler.toml`; the `custom_domain` route there
creates the DNS record, so there is nothing to click in the dashboard.

After that, **pushing to `main` deploys**. `.github/workflows/deploy.yml` runs
the typecheck and the suite first and stops on a failure — a bad deploy here is
not a page you roll back before anyone notices, it is a printed card in
someone's pocket pointing at the wrong place. It needs two repository secrets,
`CLOUDFLARE_API_TOKEN` (Workers Scripts + Workers R2 + Workers Routes on the
one zone) and `CLOUDFLARE_ACCOUNT_ID`.

### Action Button

Shortcuts → new shortcut → *Open URL* → `https://sbl.cx/_/` → assign to
the Action Button. The session cookie lasts 30 days, so it opens straight into
the panel. Use `/_/?reset=1` instead for a shortcut that kills a live temp on
sight.

## API

Everything the panel does goes through `/_/api/`, and a script can do the same
with `Authorization: Bearer <API_TOKEN>` in place of the session cookie. The
one write that matters is `POST /_/api/send`:

```sh
curl https://sbl.cx/_/api/send -H "Authorization: Bearer $API_TOKEN" \
  -H 'content-type: application/json' -d '{"text": "back in 10"}'
```

`slot` is `temp` (default), `main` or `sequence`. A target is either a nested
`target` object, or one of the flat fields `text`, `url` or `query` (a GIF
feed). For a temp, `minutes` (default 60) or `durationMs`. Every response is
the same JSON the panel renders from, so a script can read back what a scan
will get from `resolution`.

`scripts/make-shortcut.py` builds and signs an iOS Shortcut that asks for a
line of text and sends it as a one-hour message. Set the token first:

```sh
npx wrangler secret put API_TOKEN            # any long random string
scripts/make-shortcut.py sbl.cx "$API_TOKEN" ~/Desktop/sbl.cx\ text.shortcut
```

Open the file on the Mac to import it into Shortcuts; it syncs to the phone,
where it can be assigned to the Action Button. The signed file carries the
token, so do not commit it.

## Auth

A single password, held in a Wrangler secret, or the bearer token above. Compared in constant time, never
stored in the cookie — the cookie is an HMAC-signed expiry. Repeated failures,
of either the password or the token, lock the admin surface for 15 minutes.
Writes require a custom header, so a cross-origin form post cannot repoint your
QR.

This is the interim answer. Cloudflare Access on `/_/*` is the intended
replacement.

## Tests

```sh
npm test          # 114 tests: resolver truth table, sequence claiming, image-set draws, gif feeds, validation, auth, files
npm run typecheck
```

`scripts/ui-check.mjs` drives the panel in a real browser — the inlined client
JS is the part the suite cannot reach. It needs a running `npm run dev`:

```sh
node scripts/ui-check.mjs http://127.0.0.1:8787 <your-dev-password>
```

Note that under `wrangler dev` the configured `custom_domain` route makes the
Worker see its production hostname, so locally-resolved file targets point at
`https://sbl.cx/f/...`. That is correct in production and only an
inconvenience in local testing.

## Not built yet

Cloudflare Access, multiple slugs, per-template configuration, and any splash
template you would actually want a stranger to see.

With the per-device switch on, a scanner with cookies blocked will claim a new
step on every reload.
