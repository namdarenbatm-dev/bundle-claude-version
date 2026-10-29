'use strict';
/* Optional browser test (needs Playwright + Chromium). Usage: node tests/e2e.js <baseUrl> [screenshotDir]
 * Example: serve the project under a sub-path, e.g. http://localhost:8080/techno-bundle/ */
const { chromium } = require('playwright');
const path = require('path');

const base = process.argv[2];
const shotDir = process.argv[3];
if (!base) { console.error('usage: node tests/e2e.js <baseUrl> [screenshotDir]'); process.exit(2); }

let failures = 0;
const log = (ok, msg) => { if (!ok) failures++; console.log((ok ? '  ok   ' : '  FAIL ') + msg); };
const digits = (s) => s.replace(/[۰-۹]/g, (d) => d.charCodeAt(0) - 0x6f0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const consoleProblems = [];
  const failedRequests = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) consoleProblems.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => consoleProblems.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => failedRequests.push(r.url()));
  page.on('response', (r) => { if (r.status() >= 400) failedRequests.push(r.status() + ' ' + r.url()); });

  /* --- splash --- */
  const t0 = Date.now();
  await page.goto(base);
  const splashText = await page.locator('#splash').innerText();
  log(splashText.includes('سامانه طراحی مدل فروش محصولات کارتخوان توسن تکنو') && splashText.includes('مهدی نامدار · نسخه ۱۰'), 'splash shows title and credit');
  log(await page.locator('#splash img').evaluate((i) => i.complete && i.naturalWidth > 0), 'splash logo loaded');
  if (shotDir) await page.screenshot({ path: path.join(shotDir, 'splash.png') });
  await sleep(4200 - (Date.now() - t0));
  log(await page.locator('#splash').isVisible(), 'splash still visible at ~4.2s');
  await page.waitForSelector('#splash', { state: 'hidden', timeout: 3000 });
  const gone = Date.now() - t0;
  log(gone >= 4800 && gone <= 5900, 'splash gone after ' + gone + ' ms (target ~5000)');

  /* --- admin defaults --- */
  const rows = await page.locator('#bundleRows tr').count();
  log(rows === 35, 'default bundle count = 35 (got ' + rows + ')');
  const first = (await page.locator('#bundleRows tr').first().innerText()).replace(/\s+/g, ' ');
  log(digits(first).startsWith('1 10 4'), 'rank 1 is 10 POS + 4 driver (same floor price as 10+5, fewer drivers): ' + digits(first).slice(0, 60));
  const r52 = digits((await page.locator('tr[data-id="5x2"]').innerText()).replace(/\s+/g, ' '));
  log(r52.includes('15,000,000') && r52.includes('159,000,000'), 'row 5x2 has price 15,000,000 and total 159,000,000');
  log(digits(await page.locator('#derived').innerText()).includes('15,000,000'), 'derived driver contribution 15,000,000 shown');
  if (shotDir) await page.screenshot({ path: path.join(shotDir, 'admin.png'), fullPage: false });

  /* --- details modal --- */
  const tr = page.locator('tr[data-id="5x2"]');
  const sw = await tr.locator('.switch').boundingBox();
  const det = await tr.locator('[data-act="details"]').boundingBox();
  log(Math.abs(sw.y - det.y) < 12 && Math.abs((sw.x - det.x)) < 220, 'Details button sits next to publish status');
  await tr.locator('[data-act="details"]').click();
  await page.waitForSelector('#detailsDialog[open]');
  const dlg = digits(await page.locator('#detailsDialog').innerText());
  log(['25,000,000', '5,000,000', '15,000,000', '159,000,000'].every((x) => dlg.includes(x)), 'modal shows budget, reserve, price and total');
  log(await page.locator('#detailsDialog').evaluate((d) => d.matches(':modal')), 'details open as a true modal dialog');
  await sleep(400);
  if (shotDir) await page.screenshot({ path: path.join(shotDir, 'details.png') });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('detailsDialog').open);
  log((await page.locator('#bundleTable').locator('text=محاسبات').count()) === 0, 'details are not left under the table');

  /* --- validation --- */
  await page.fill('#f-posFloor', '25000000');
  log((await page.locator('#e-posFloor').innerText()).includes('کف قیمت'), 'floor > base shows an error');
  log((await page.locator('#bundleRows tr').count()) === 0, 'no bundles while settings invalid');
  await page.fill('#f-posFloor', '12.5');
  log((await page.locator('#e-posFloor').innerText()).includes('عدد صحیح'), 'decimal input rejected');
  await page.fill('#f-posFloor', '۱۵٬۰۰۰٬۰۰۰');
  await page.locator('#f-posFloor').blur();
  log((await page.locator('#bundleRows tr').count()) === 35, 'Persian digits accepted; bundles return');
  await page.fill('#f-marketing', '10000000');
  const underfundedRows = await page.locator('#bundleRows tr').count();
  log(underfundedRows < 35, 'large marketing budget removes underfunded bundles (' + underfundedRows + ' left)');
  await page.fill('#f-marketing', '1000000');

  /* --- ranking --- */
  const before = digits(await page.locator('#bundleRows tr').first().getAttribute('data-id'));
  await page.locator('#prioList button[data-i="3"][data-move="-1"]').click();
  await page.locator('#prioList button[data-i="2"][data-move="-1"]').click();
  await page.locator('#prioList button[data-i="1"][data-move="-1"]').click();
  const after = await page.locator('#bundleRows tr').first().getAttribute('data-id');
  log(before === '10x4' && after !== before, 'reordering priorities changes ranking (' + before + ' -> ' + after + ')');
  log((await page.locator('#prioList li').first().innerText()).includes('مبلغ کل'), 'total moved to first priority');
  await page.reload();
  await page.waitForSelector('#splash', { state: 'hidden', timeout: 8000 });
  log((await page.locator('#prioList li').first().innerText()).includes('مبلغ کل'), 'priority order persisted after reload');
  await page.locator('#resetBtn').click();
  await page.waitForSelector('#confirmDialog[open]');
  await page.locator('#confirmOk').click();
  await page.waitForFunction(() => document.querySelector('#prioList li').innerText.includes('تعداد کارتخوان'), null, { timeout: 3000 }).catch(() => {});
  log((await page.locator('#prioList li').first().innerText()).includes('تعداد کارتخوان'), 'reset defaults restores default ranking');

  /* --- publish + broker --- */
  await page.click('#tab-broker');
  log((await page.locator('#brokerResult').innerText()).includes('هنوز باندلی منتشر نشده'), 'broker sees nothing before publishing');
  await page.click('#tab-admin');
  for (const id of ['5x2', '6x2', '7x2', '8x3']) await page.locator(`tr[data-id="${id}"] .switch`).click();
  log((await page.locator('tr[data-id="5x2"] .switch').getAttribute('aria-checked')) === 'true', 'publish toggle works');
  await page.locator('tr[data-id="6x2"] .switch').click();
  log((await page.locator('tr[data-id="6x2"] .switch').getAttribute('aria-checked')) === 'false', 'unpublish toggle works');
  await page.click('#tab-broker');
  await page.fill('#brokerBudget', '170000000');
  let txt = digits(await page.locator('#brokerResult').innerText());
  const mainCards = await page.locator('.offer.main').count();
  const upCards = await page.locator('.offer.upgrade').count();
  log(mainCards === 1 && upCards <= 1, 'broker sees exactly 1 main and at most 1 upgrade (' + mainCards + '/' + upCards + ')');
  log(txt.includes('159,000,000') || txt.includes('5 کارتخوان'), 'main recommendation is 5+2 for budget 170M');
  const upText = upCards ? digits(await page.locator('.offer.upgrade').innerText()) : '';
  if (upCards) {
    const m = /پرداخت اضافه نسبت به بودجه شما: ([\d,]+)/.exec(upText);
    log(m && Number(m[1].replace(/,/g, '')) <= 10000000, 'upgrade additional payment within cap: ' + (m && m[1]));
  } else log(true, 'no upgrade offered for this budget');
  await page.fill('#brokerBudget', '230000000');
  const m2 = /پرداخت اضافه نسبت به بودجه شما: ([\d,]+)/.exec(digits(await page.locator('#brokerResult').innerText()));
  log(!m2 || Number(m2[1].replace(/,/g, '')) <= 10000000, 'upgrade within cap at 230M budget' + (m2 ? ' (' + m2[1] + ')' : ' (none)'));
  await page.fill('#brokerBudget', '5000000');
  log((await page.locator('#brokerResult').innerText()).includes('باندلی در دسترس نیست'), 'unaffordable budget shows message');
  await page.fill('#brokerBudget', '170000000');
  const brokerText = await page.locator('#view-broker').innerText();
  log(!/بهای تمام|سود|ذخیره بازاریابی|کف رقابتی|بودجه تخفیف/.test(brokerText), 'broker view leaks no cost/profit/reserve/floor wording');
  if (shotDir) await page.screenshot({ path: path.join(shotDir, 'broker.png'), fullPage: true });

  /* --- persistence --- */
  await page.reload();
  await page.waitForSelector('#splash', { state: 'hidden', timeout: 8000 });
  log((await page.locator('#tab-broker').getAttribute('aria-selected')) === 'true' && (await page.inputValue('#brokerBudget')).length > 0, 'tab and broker budget persisted');
  await page.click('#tab-admin');
  log((await page.locator('tr[data-id="5x2"] .switch').getAttribute('aria-checked')) === 'true', 'published state persisted');

  /* --- CSV --- */
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#csvBtn')]);
  const csvPath = await dl.path();
  const csv = require('fs').readFileSync(csvPath, 'utf8');
  log(csv.charCodeAt(0) === 0xfeff && csv.trim().split('\r\n').length === 36, 'CSV has BOM and 35 data rows; file ' + dl.suggestedFilename());

  /* --- share link -> new broker device --- */
  await page.click('#shareBtn');
  await page.waitForSelector('#shareDialog[open]');
  const link = await page.inputValue('#shareText');
  log(link.includes('#offer=') && !/posFloor|driverCost|marketing/.test(link), 'share link built: ' + link.length + ' chars');
  await page.click('#shareCopy');
  await page.keyboard.press('Escape');
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const p2 = await ctx2.newPage();
  const p2errors = [];
  p2.on('pageerror', (e) => p2errors.push(e.message));
  await p2.goto(link);
  await p2.waitForSelector('#splash', { state: 'hidden', timeout: 8000 });
  log((await p2.locator('#tab-broker').getAttribute('aria-selected')) === 'true' && !(await p2.locator('.tabs').isVisible()), 'offer link opens broker-only mode');
  log(p2.url().indexOf('#offer') === -1, 'offer hash removed from URL after import');
  await p2.fill('#brokerBudget', '170000000');
  log((await p2.locator('.offer.main').count()) === 1, 'broker device shows recommendation from imported offer');
  const t2 = digits(await p2.locator('.offer.main').innerText());
  log(t2.includes('159,000,000'), 'total recomputed on broker device: 159,000,000');
  const overflow = await p2.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  log(overflow <= 1, 'no horizontal page scroll at 390px (overflow ' + overflow + ')');
  if (shotDir) await p2.screenshot({ path: path.join(shotDir, 'broker-mobile.png'), fullPage: true });
  const bad = await p2.goto(base + '#offer=AAAA');
  await sleep(300);
  log(p2errors.length === 0, 'no page errors on broker device');
  await ctx2.close();

  /* --- admin mobile --- */
  const mctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const mp = await mctx.newPage();
  await mp.goto(base);
  await mp.waitForSelector('#splash', { state: 'hidden', timeout: 8000 });
  const mo = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  log(mo <= 1, 'admin: no horizontal page scroll at 390px (overflow ' + mo + ')');
  if (shotDir) await mp.screenshot({ path: path.join(shotDir, 'admin-mobile.png') });
  await mctx.close();

  /* --- service worker / offline --- */
  await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 8000 }).catch(() => {});
  const swInfo = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const keys = await caches.keys();
    const cache = keys.length ? await (await caches.open(keys[0])).keys() : [];
    return { scope: reg && reg.scope, active: !!(reg && reg.active), keys, count: cache.length, controlled: !!navigator.serviceWorker.controller };
  });
  log(swInfo.active && swInfo.scope === base.replace(/index\.html$/, ''), 'service worker active with scope ' + swInfo.scope);
  log(swInfo.keys.length === 1 && /^techno-bundle-v10/.test(swInfo.keys[0]) && swInfo.count === 13, 'versioned cache ' + swInfo.keys + ' holds ' + swInfo.count + ' files');
  log(swInfo.controlled, 'page is controlled by the service worker');
  await ctx.setOffline(true);
  const off = await ctx.newPage();
  const offErr = [];
  off.on('pageerror', (e) => offErr.push(e.message));
  await off.goto(base);
  await off.waitForSelector('#splash', { state: 'hidden', timeout: 8000 });
  log((await off.locator('#bundleRows tr').count()) === 35, 'OFFLINE: app loads and calculates 35 bundles');
  await off.locator('tr[data-id="5x2"] [data-act="details"]').click();
  log(digits(await off.locator('#detailsDialog').innerText()).includes('159,000,000'), 'OFFLINE: core calculation (159,000,000) works');
  const fontOk = await off.evaluate(() => document.fonts.check('16px Yekan'));
  log(fontOk, 'OFFLINE: Yekan font available');
  log(offErr.length === 0, 'OFFLINE: no page errors');
  await ctx.setOffline(false);
  await off.close();

  /* --- clear data --- */
  await page.click('#clearBtn');
  await page.waitForSelector('#confirmDialog[open]');
  await page.locator('#confirmDialog button[value="cancel"]').click();
  log((await page.locator('tr[data-id="5x2"] .switch').getAttribute('aria-checked')) === 'true', 'clear-data cancel keeps data');
  await page.click('#clearBtn');
  await page.waitForSelector('#confirmDialog[open]');
  await page.locator('#confirmOk').click();
  await page.waitForFunction(() => document.querySelector('tr[data-id="5x2"] .switch').getAttribute('aria-checked') === 'false', null, { timeout: 3000 }).catch(() => {});
  log((await page.locator('tr[data-id="5x2"] .switch').getAttribute('aria-checked')) === 'false', 'clear-data confirm wipes published state');
  const left = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('technoBundle10:')));
  log(left.length === 0, 'localStorage keys cleared (' + left.length + ' left)');

  /* --- print stylesheet --- */
  await page.emulateMedia({ media: 'print' });
  log(!(await page.locator('.settings').isVisible()) && (await page.locator('#bundleTable').isVisible()), 'print media hides settings, keeps table');
  await page.pdf({ path: shotDir ? path.join(shotDir, 'admin.pdf') : undefined, format: 'A4' }).catch(() => {});

  /* --- summary --- */
  const realProblems = consoleProblems.filter((m) => !/Failed to load resource.*(offline|ERR_INTERNET)/i.test(m));
  log(realProblems.length === 0, 'console: no errors/warnings' + (realProblems.length ? ' -> ' + realProblems.join(' | ') : ''));
  const reqs = failedRequests.filter((u) => !/ERR_INTERNET|offline/.test(u));
  log(reqs.length === 0, 'network: no failed requests / 4xx' + (reqs.length ? ' -> ' + reqs.join(' | ') : ''));

  await browser.close();
  console.log(failures ? '\n' + failures + ' e2e check(s) FAILED' : '\nAll e2e checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
