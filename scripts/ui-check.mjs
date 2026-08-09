/**
 * Drives the admin panel in a real browser. Not part of the test suite — the
 * suite covers the Worker, this covers the inlined client JS, which is the part
 * a unit test cannot reach.
 *
 * Usage: node scripts/ui-check.mjs [baseUrl] [password]
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://127.0.0.1:8787';
const PASSWORD = process.argv[3] ?? 'devpassword';
const OUT = process.env.UI_CHECK_OUT ?? '/tmp/ui';

const EXECUTABLE = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ['--no-sandbox'] });
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
await setup('temp', undefined, 'DELETE');
await setup('splash', { on: false });
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

// --- set a temp via the custom field -------------------------------------
await page.click('[data-duration="15"]');
await page.fill('#custom-url', 'example.com/from-ui');
await page.click('#send-temp');
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
 await page.click('#bookmarks .item button:has-text("main")');
await page.waitForTimeout(900);
check('setting main asks for confirmation', dialogs.length > dialogsBeforeMain,
  dialogs.at(-1)?.split('\n')[0]);
check('main took effect',
  (await page.textContent('#live-url'))?.includes('shaulb.com/work'),
  await page.textContent('#live-url'));

// --- sequence, built and run entirely through the UI ----------------------
await page.click('#tab-sequence');
const MESSAGES = ['you are first', 'second!', 'third', 'last one'];
for (const message of MESSAGES) {
  await page.fill('#step-text', message);
  await page.click('#step-add');
  await page.waitForFunction(
    (n) => document.querySelectorAll('#steps .item').length === n,
    MESSAGES.indexOf(message) + 1,
    { timeout: 10000 },
  );
}
check('four steps added through the editor',
  (await page.locator('#steps .item').count()) === 4);
await page.screenshot({ path: `${OUT}/06-sequence-ready.png`, fullPage: true });

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
// https://q.shaulb.com/f/... and be unreachable from here. That origin
// derivation is correct in production; this sidesteps it so the check measures
// the splash handoff itself.
const destination = `${BASE}/f/${file.key}/${file.name}`;
await context.request.post(`${BASE}/_/api/main`, {
  headers: { cookie: cookieHeader, 'x-skin-request': '1', 'content-type': 'application/json' },
  data: { target: { kind: 'url', url: destination } },
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
