/**
 * Drives the admin panel in a real browser. Not part of the test suite — the
 * suite covers the Worker, this covers the inlined client JS, which is the part
 * a unit test cannot reach.
 *
 * Usage: node scripts/ui-check.mjs [baseUrl] [password]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://127.0.0.1:8787';
const PASSWORD = process.argv[3] ?? 'devpassword';
const OUT = process.env.UI_CHECK_OUT ?? '/tmp/ui';

// Playwright's own managed build by default — the previous hard-coded Linux
// path meant this script only ran on one machine. CHROMIUM_PATH still wins,
// for a CI image that ships its own browser.
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--no-sandbox'],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  ignoreHTTPSErrors: true,
});
const page = await context.newPage();

const errors = [];
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

// One persistent handler. Using `once` per interaction leaves a stale handler
// armed whenever an action correctly does *not* confirm, which then
// double-accepts the next real dialog.
const dialogs = [];
page.on('dialog', (dialog) => { dialogs.push(dialog.message()); dialog.accept(); });

function check(label, condition, detail = '') {
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) process.exitCode = 1;
}

// --- login ---------------------------------------------------------------
await page.goto(`${BASE}/_/`, { waitUntil: 'networkidle' });
check('anonymous visit lands on login', page.url().includes('/_/login'));
await page.fill('input[name=password]', PASSWORD);
await page.click('button[type=submit]');
await page.waitForURL('**/_/', { timeout: 10000 });
await page.waitForFunction(() => document.getElementById('live-url')?.textContent !== 'loading');
await page.screenshot({ path: `${OUT}/01-panel.png`, fullPage: true });
check('panel loads and hydrates', true);

// Start from a known slate. A check that only passes against a pristine dev
// database is a check you stop trusting. This is setup, not the thing under
// test, so it goes through the API rather than the UI.
const cookieHeader = (await context.cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
const setup = (path, data, method) => context.request.fetch(`${BASE}/_/api/${path}`, {
  method: method ?? (data ? 'POST' : 'GET'),
  headers: { cookie: cookieHeader, 'x-skin-request': '1', 'content-type': 'application/json' },
  data,
});
await setup('sequence/arm', undefined, 'DELETE');
await setup('sequence/steps', { steps: [] });
await setup('sequence/sticky', { on: false });
await setup('temp', undefined, 'DELETE');
await setup('splash', { on: false });
for (const pool of (await (await setup('state')).json()).pools ?? []) {
  await setup(`pools/${pool.id}`, undefined, 'DELETE');
}
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => document.getElementById('live-url')?.textContent !== 'loading');

// --- navigation -----------------------------------------------------------
for (const tab of ['library', 'sequence', 'settings', 'now']) {
  await page.click(`#tab-${tab}`);
  await page.waitForTimeout(120);
  const visible = await page.isVisible(`#panel-${tab}`);
  const selected = await page.getAttribute(`#tab-${tab}`, 'aria-selected');
  check(`tab "${tab}" opens and is marked current`, visible && selected === 'true');
}
check('tab is reflected in the URL so reload and back work',
  page.url().endsWith('#now'), page.url());
check('status bar is visible from every tab', await page.isVisible('#status'));

/**
 * Every destination is committed through the one send sheet, so the check
 * drives it the way a thumb would: Send on the row, then the slot.
 */
async function sendVia(openSelector, slot, minutes) {
  await page.click(openSelector);
  await page.waitForSelector('#sheet.open', { timeout: 10000 });
  if (minutes) await page.click(`#sheet [data-duration="${minutes}"]`);
  await page.click(`#sheet-${slot}`);
  await page.waitForSelector('#sheet', { state: 'hidden', timeout: 10000 });
}

// --- set a temp by typing one, then sending it ----------------------------
await page.click('#tab-library');
await page.fill('#custom-url', 'example.com/from-ui');
await sendVia('#custom-send', 'temp', 15);
check('the sheet closes after committing', !(await page.isVisible('#sheet')));
// Cleared on success, not on submit: a rejected URL must leave what you typed
// on screen rather than making you retype it.
await page.waitForFunction(() =>
  document.getElementById('custom-url')?.value === '', null, { timeout: 10000 });
check('the composer clears itself once the send succeeds', true);
await page.click('#tab-now');
await page.waitForFunction(() =>
  document.getElementById('live-url')?.textContent?.includes('from-ui'), null, { timeout: 10000 });
check('temp set from the custom field', true,
  await page.textContent('#live-url'));
check('live card flips to "temporary"',
  (await page.textContent('#live-src'))?.trim() === 'Temporary');

const meta = await page.textContent('#live-meta');
check('countdown is running', /\d+:\d\d/.test(meta ?? ''), meta?.trim());
check('End now is exposed while a temp is live',
  await page.isVisible('#live-actions button:has-text("End now")'));
check('status bar mirrors the live state',
  (await page.textContent('#status-now'))?.includes('from-ui'));
await page.screenshot({ path: `${OUT}/02-temp-live.png`, fullPage: true });

// --- the public side, while the temp is live ------------------------------
const scan = await context.request.get(`${BASE}/`, { maxRedirects: 0 });
check('public scan follows the temp', scan.headers()['location'] === 'https://example.com/from-ui',
  scan.headers()['location']);

// --- extend, then end -----------------------------------------------------
await page.click('#live-actions button:has-text("+15m")');
await page.waitForTimeout(600);
check('extend does not break the card',
  (await page.textContent('#live-src'))?.trim() === 'Temporary');

const dialogsBeforeEndNow = dialogs.length;
await page.click('#live-actions button:has-text("End now")');
await page.waitForFunction(() =>
  document.getElementById('live-src')?.textContent?.trim() !== 'Temporary', null, { timeout: 10000 });
check('End now reverts immediately', true, await page.textContent('#live-url'));
// Temp is self-healing, so it earns no friction. Main does — asserted below.
check('End now does NOT nag for confirmation', dialogs.length === dialogsBeforeEndNow);
// The live card exists to tell the truth at a glance. Offering "End now" when
// there is no temp to end is exactly the lie it is there to prevent.
check('temp controls disappear once no temp is live',
  !(await page.isVisible('#live-actions')));

// --- bookmarks ------------------------------------------------------------
await page.click('#tab-library');
await page.fill('#bm-label', 'Portfolio');
await page.fill('#bm-url', 'shaulb.com/work');
await page.click('#bm-add');
await page.waitForFunction(() =>
  document.querySelectorAll('#bookmarks .item').length > 0, null, { timeout: 10000 });
check('bookmark appears in the list', true);

// --- main requires a confirmation, temp does not --------------------------
const dialogsBeforeMain = dialogs.length;
await page.click('#tab-library');
await sendVia('#bookmarks .item button:has-text("Send")', 'main');
await page.waitForTimeout(900);
check('setting main asks for confirmation', dialogs.length > dialogsBeforeMain,
  dialogs.at(-1)?.split('\n')[0]);
check('main took effect',
  (await page.textContent('#live-url'))?.includes('shaulb.com/work'),
  await page.textContent('#live-url'));

// --- a search sent whole, as a feed, without picking anything -------------
await page.click('#tab-library');
await page.fill('#gif-q', 'thumbs up');
await page.click('#gif-feed');
await page.waitForSelector('#sheet.open', { timeout: 10000 });
check('a search opens the sheet as a GIF feed',
  (await page.textContent('#sheet-target'))?.includes('GIF feed: thumbs up'));
await page.click('#sheet-close');
await page.waitForSelector('#sheet', { state: 'hidden', timeout: 10000 });

// --- sequence, built and run entirely through the UI ----------------------
// Steps are composed on Destinations and pushed into the queue through the
// same sheet as everything else — there is no separate step editor any more.
const MESSAGES = ['you are first', 'second!', 'third', 'last one'];
await page.click('#tab-library');
await page.click('#mode-message');
for (const message of MESSAGES) {
  await page.fill('#custom-text', message);
  await sendVia('#custom-send', 'seq');
  await page.waitForTimeout(250);
}
await page.click('#tab-sequence');
await page.waitForFunction(() =>
  document.querySelectorAll('#steps .item').length === 4, null, { timeout: 10000 });
check('four message steps built from the Destinations tab',
  (await page.locator('#steps .item').count()) === 4);
await page.screenshot({ path: `${OUT}/06-sequence-ready.png`, fullPage: true });

// Per-device claims are a switch now, off by default. Flip it through the
// UI so the reload check below exercises the sticky path.
await page.click('#sticky-toggle');
await page.waitForFunction(() => document.getElementById('sticky-toggle')?.checked, null, { timeout: 10000 });
check('per-device switch turns on',
  (await (await setup('state')).json()).stickySteps === true);

await page.click('#seq-actions button:has-text("Arm")');
await page.waitForFunction(() =>
  document.getElementById('seq-state')?.textContent?.includes('Armed'), null, { timeout: 10000 });
check('arming flips the sequence live', true, await page.textContent('#seq-state'));
check('tab badge shows how many scans remain',
  (await page.textContent('#seq-badge'))?.trim() === '4');
await page.screenshot({ path: `${OUT}/07-sequence-armed.png`, fullPage: true });

// Four friends, four separate devices — a fresh browser context each, since
// the claim is per-device.
const seen = [];
for (let friend = 0; friend < 4; friend++) {
  const device = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const phone = await device.newPage();
  await phone.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  seen.push((await phone.textContent('body'))?.trim());

  if (friend === 0) {
    // The reason claims are sticky at all: this phone is being held up while
    // the other three get arranged.
    await phone.reload({ waitUntil: 'domcontentloaded' });
    check('a reload keeps that scanner on their own message',
      (await phone.textContent('body'))?.includes(MESSAGES[0]));
    await phone.screenshot({ path: `${OUT}/08-friend-1.png` });
  }
  await device.close();
}
check('each scanner got a different message in order',
  MESSAGES.every((message, i) => seen[i]?.includes(message)),
  seen.map((s) => `"${s}"`).join(' · '));

const fifth = await context.request.get(`${BASE}/`, {
  maxRedirects: 0,
  headers: { 'user-agent': 'Mozilla/5.0 (iPhone) Safari/605.1' },
});
check('the fifth scan falls back to normal resolution', fifth.status() === 302,
  `HTTP ${fifth.status()}`);

await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => document.getElementById('live-url')?.textContent !== 'loading');
await page.click('#tab-sequence');
check('a spent sequence keeps its steps for re-arming',
  (await page.locator('#steps .item').count()) === 4);
await page.click('#seq-actions button:has-text("Arm")');
await page.waitForFunction(() =>
  document.getElementById('seq-state')?.textContent?.includes('Armed'), null, { timeout: 10000 });
check('re-arming restarts the run', true, await page.textContent('#seq-state'));
await page.click('#seq-actions button:has-text("Disarm")');
await page.waitForFunction(() =>
  !document.getElementById('seq-state')?.textContent?.includes('Armed'), null, { timeout: 10000 });
check('disarm stops it without discarding the steps',
  (await page.locator('#steps .item').count()) === 4);

// And the default mode: switch back off, re-arm, and one phone refreshing
// walks through the steps on its own.
await page.click('#sticky-toggle');
await page.waitForFunction(() => !document.getElementById('sticky-toggle')?.checked, null, { timeout: 10000 });
await page.click('#seq-actions button:has-text("Arm")');
await page.waitForFunction(() =>
  document.getElementById('seq-state')?.textContent?.includes('Armed'), null, { timeout: 10000 });
const walker = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const walked = [];
await walker.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
walked.push((await walker.textContent('body'))?.trim());
await walker.reload({ waitUntil: 'domcontentloaded' });
walked.push((await walker.textContent('body'))?.trim());
check('with the switch off, a refresh shows the next step',
  walked[0]?.includes(MESSAGES[0]) && walked[1]?.includes(MESSAGES[1]),
  walked.map((s) => `"${s}"`).join(' · '));
await walker.context().close();
await setup('sequence/arm', undefined, 'DELETE');

// --- image sets -----------------------------------------------------------
// Four real 1x1 PNGs in distinguishable colours, written to disk so the file
// picker has something genuine to pick.
const SWATCHES = {
  'red.png': 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'green.png': 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhQGAWpvsMgAAAABJRU5ErkJggg==',
  'blue.png': 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'white.png': 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADklEQVR42mP8//9/PQAJewN+0zEEkwAAAABJRU5ErkJggg==',
};
const swatchDir = `${OUT}/swatches`;
mkdirSync(swatchDir, { recursive: true });
const swatchPaths = Object.entries(SWATCHES).map(([name, b64]) => {
  const path = `${swatchDir}/${name}`;
  writeFileSync(path, Buffer.from(b64, 'base64'));
  return path;
});

await page.click('#tab-library');
await page.fill('#pool-name', 'Party photos');
await page.click('#pool-add');
await page.waitForFunction(() =>
  document.querySelectorAll('#pools .pool').length > 0, null, { timeout: 10000 });
check('a set can be created', true);

// A set with nothing in it cannot serve a scan, so pointing the code at it
// would just break the QR.
check('an empty set cannot be set as a destination',
  await page.locator('#pools .pool button:has-text("Send")').first().isDisabled());

// Through the real button and the real file chooser: the handler needs to know
// which set it is uploading into, and setting the input directly would skip
// exactly that step.
const chooser = page.waitForEvent('filechooser');
await page.locator('#pools .pool button:has-text("Add images")').first().click();
await (await chooser).setFiles(swatchPaths);
await page.waitForFunction(() =>
  document.querySelectorAll('#pools .thumb').length === 4, null, { timeout: 30000 });
check('four images upload into the set in one go', true);
check('the set is now selectable',
  !(await page.locator('#pools .pool button:has-text("Send")').first().isDisabled()));
await page.screenshot({ path: `${OUT}/09-image-set.png`, fullPage: true });

// A set as a step shows its first image in the row, not just a name.
await sendVia('#pools .pool button:has-text("Send")', 'seq');
await page.click('#tab-sequence');
await page.waitForSelector('#steps .item img.preview', { timeout: 10000 });
check('an image step shows a preview in the sequence',
  await page.locator('#steps .item img.preview').first().evaluate((img) => img.naturalWidth > 0));
await page.screenshot({ path: `${OUT}/10-sequence-preview.png`, fullPage: true });
await page.click('#tab-library');

await sendVia('#pools .pool button:has-text("Send")', 'temp');
await page.waitForFunction(() =>
  document.getElementById('live-url')?.textContent?.includes('Party photos'), null,
  { timeout: 10000 });
check('the live card names the set and its size', true, await page.textContent('#live-url'));

// Eight scans over a four-image set: every image once per pass, and never the
// same image twice running.
const drawn = [];
for (let i = 0; i < 8; i++) {
  const response = await context.request.get(`${BASE}/`, {
    maxRedirects: 0,
    headers: { 'user-agent': 'Mozilla/5.0 (iPhone) Safari/605.1' },
  });
  drawn.push((response.headers()['location'] ?? '').match(/\/f\/([0-9a-f]+)\//)?.[1]);
}
check('scans serve images from the set', drawn.every(Boolean));
check('each pass shows all four images',
  new Set(drawn.slice(0, 4)).size === 4 && new Set(drawn.slice(4)).size === 4);
check('no image repeats back to back',
  drawn.every((key, i) => i === 0 || key !== drawn[i - 1]),
  drawn.map((k) => k?.slice(0, 4)).join(' '));

// And the image really renders, rather than merely being redirected to.
const viewer = await context.newPage();
await viewer.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
const rendered = await viewer.evaluate(() => {
  const img = document.querySelector('img');
  return img ? { w: img.naturalWidth, h: img.naturalHeight } : null;
});
check('the drawn image actually decodes in the browser',
  !!rendered && rendered.w > 0, JSON.stringify(rendered));
await viewer.close();

// Teardown, not an assertion — "End now" is exercised in the temp section
// above. Clicking it here races the live card's re-render for no benefit.
await setup('temp', undefined, 'DELETE');
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => document.getElementById('live-url')?.textContent !== 'loading');

// --- splash toggle --------------------------------------------------------
await page.click('#tab-settings');
await page.click('#splash-toggle');
await page.waitForTimeout(700);
const splashed = await context.request.get(`${BASE}/`, { maxRedirects: 0 });
check('splash toggle changes what a scanner gets', splashed.status() === 200,
  `HTTP ${splashed.status()}`);
check('splash body is the placeholder',
  (await splashed.text()).includes('thank you for scanning'));
await page.screenshot({ path: `${OUT}/03-after-main.png`, fullPage: true });

// --- dark mode ------------------------------------------------------------
const dark = await context.newPage();
await dark.emulateMedia({ colorScheme: 'dark' });
await dark.goto(`${BASE}/_/`, { waitUntil: 'networkidle' });
await dark.waitForFunction(() => document.getElementById('live-url')?.textContent !== 'loading');
await dark.screenshot({ path: `${OUT}/04-dark.png`, fullPage: true });
check('dark mode renders', true);

// --- the splash page itself, as a scanner sees it -------------------------
// Point main at a file we host, so the handoff is exercised against a target
// that is actually reachable from here. An external URL would only prove that
// this sandbox has no outbound network.
const uploaded = await context.request.post(`${BASE}/_/api/upload?name=landing.txt`, {
  headers: { cookie: cookieHeader, 'x-skin-request': '1', 'content-type': 'text/plain' },
  data: 'you have landed',
});
const { file } = await uploaded.json();
// Deliberately a `url` target pinned to BASE rather than a `file` target:
// under `wrangler dev` the configured custom_domain route makes the Worker see
// its production hostname, so a file target would resolve to
// https://sbl.cx/f/... and be unreachable from here. That origin
// derivation is correct in production; this sidesteps it so the check measures
// the splash handoff itself.
const destination = `${BASE}/f/${file.key}/${file.name}`;
await context.request.post(`${BASE}/_/api/send`, {
  headers: { cookie: cookieHeader, 'x-skin-request': '1', 'content-type': 'application/json' },
  data: { slot: 'main', target: { kind: 'url', url: destination } },
});

const scanner = await context.newPage();
const started = Date.now();
await scanner.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await scanner.screenshot({ path: `${OUT}/05-splash.png` });
await scanner.waitForURL(`**/f/${file.key}/**`, { timeout: 8000 }).then(
  () => {
    const elapsed = Date.now() - started;
    check('splash auto-advances to the destination', true, `${elapsed}ms`);
    // The spec is two seconds. Anything much under means the splash was skipped
    // entirely; much over means a scanner is left staring at it.
    check('advance lands near the 2s spec', elapsed > 1500 && elapsed < 4000, `${elapsed}ms`);
  },
  () => check('splash auto-advances to the destination', false, `stuck at ${scanner.url()}`),
);
check('destination actually rendered',
  (await scanner.textContent('body'))?.includes('you have landed'));

await page.click('#splash-toggle');
await page.waitForTimeout(500);

check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(process.exitCode ? '\nUI CHECK FAILED' : '\nUI CHECK PASSED');
