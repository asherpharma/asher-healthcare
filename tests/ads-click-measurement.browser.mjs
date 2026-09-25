// Explicitly authorized LOCAL-ONLY privacy QA. No production navigation.
// Google tag JavaScript may load; ALL measurement and other external requests
// are intercepted and aborted before transmission. Fresh browser context only.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.QA_BASE_URL || 'http://127.0.0.1:4318';
assert.equal(new URL(base).hostname, '127.0.0.1', 'Never run against production');
const output = path.resolve(process.env.QA_OUTPUT_DIR || 'tmp/ads-browser-qa');
const consentKey = 'asher_ads_measurement_consent_v1';
const phoneLabel = 'i2sQCLOk-IMdEJipl8hE';
const directionsLabel = 'j5IqCLak-IMdEJipl8hE';
const results = [];
const requests = [];
const errors = [];
let scenario = 'startup';
let reachedRequestedScenario = !process.env.QA_FROM_SCENARIO;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ['--disable-back-forward-cache'], ...(process.env.QA_BROWSER_EXECUTABLE ? { executablePath: process.env.QA_BROWSER_EXECUTABLE } : {}) });
const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
await context.addInitScript(() => {
  window.addEventListener('pageshow', event => { window.__qaRestoredFromCache = event.persisted; });
  // Survives hydration and reloads: no test can invoke the OS dialer or Maps.
  // Do not stop propagation; the actual application click listener must run.
  document.addEventListener('click', event => {
    const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (anchor?.getAttribute('href') === 'tel:+919019263709' || anchor?.getAttribute('href') === 'https://maps.app.goo.gl/cvFLUCkF6nRPAHUx5') event.preventDefault();
  }, true);
});
await context.route('**/*', async route => {
  const request = route.request();
  const url = new URL(request.url());
  if (url.origin === base && request.method() === 'GET' && !url.pathname.startsWith('/api/')) {
    await route.continue();
    return;
  }
  const entry = { scenario, url: request.url(), method: request.method(), body: request.postData(), headers: await request.allHeaders(), decision: 'blocked' };
  requests.push(entry);
  // Only the canonical Google tag library is allowed to leave the test browser.
  if (request.url() === 'https://www.googletagmanager.com/gtag/js?id=AW-18404988056' && request.method() === 'GET' && request.resourceType() === 'script') {
    if (entry.headers.referer || entry.headers.cookie || entry.headers.authorization) {
      entry.error = 'Unexpected sensitive header: library fetch blocked';
      await route.abort('blockedbyclient');
      return;
    }
    entry.decision = 'tag-library-only';
    try {
      const response = await route.fetch({ timeout: 30000, maxRedirects: 0, headers: { 'user-agent': entry.headers['user-agent'] || 'Local privacy QA' } });
      entry.status = response.status();
      await route.fulfill({ response });
    } catch (error) {
      entry.error = error.message;
      await route.abort('blockedbyclient');
    }
    return;
  }
  await route.abort('blockedbyclient');
});
context.on('page', p => p.on('pageerror', e => errors.push({ scenario, message: e.message })));
const page = await context.newPage();
page.setDefaultTimeout(60000);
page.setDefaultNavigationTimeout(120000);
const settle = () => page.waitForTimeout(1600);
const load = async (url = '/') => { await page.goto(base + url, { waitUntil: 'domcontentloaded', timeout: 120000 }); await settle(); };
const tagPresent = () => page.locator('#asher-google-ads-tag').count();
const googleAttempts = () => requests.filter(r => /google|doubleclick/.test(new URL(r.url).hostname));
// The existing clinic Maps iframe is not Google Ads measurement. Keep it in
// the full request audit, but do not misclassify its lazy load as a tag event.
const adsAttempts = () => googleAttempts().filter(r => {
  const url = new URL(r.url);
  return !(url.hostname === 'www.google.com' && url.pathname === '/maps' && url.searchParams.get('output') === 'embed');
});
const conversionAttempts = () => requests.filter(r => /(?:pagead\/(?:1p-)?conversion|viewthroughconversion|\/ccm\/collect|\/g\/collect)/.test(new URL(r.url).pathname));
const queuedEvents = () => page.evaluate(() => (window.dataLayer || []).filter(x => x[0] === 'event' && x[1] === 'conversion').map(x => x[2]));
const fixedClick = async href => {
  const link = page.locator(`a[href="${href}"]`).first();
  await link.click({ noWaitAfter: true });
  await settle();
};
const clickBoth = async () => {
  await fixedClick('tel:+919019263709');
  await fixedClick('https://maps.app.goo.gl/cvFLUCkF6nRPAHUx5');
};
const assertNoTag = async () => { assert.equal(await tagPresent(), 0); assert.equal(adsAttempts().filter(r => r.scenario === scenario).length, 0); };
const run = async (name, fn) => {
  if (name === process.env.QA_FROM_SCENARIO) reachedRequestedScenario = true;
  if (!reachedRequestedScenario) return;
  scenario = name;
  const start = requests.length;
  try { await fn(); results.push({ name, pass: true, requestCount: requests.length - start }); console.log('PASS ' + name); }
  catch (error) { results.push({ name, pass: false, error: error.message, stack: error.stack, currentUrl: page.url() }); console.log('FAIL ' + name + ': ' + error.message); throw error; }
};
try {
  if (process.env.QA_FROM_SCENARIO) await load('/care/womens-health');
  if (process.env.QA_FOCUSED_CARE === 'true') {
    await run('care page stays untagged even with stored opt-in', async () => {
      await load('/care/womens-health');
      await page.evaluate(k => localStorage.setItem(k, 'granted'), consentKey);
      await load('/care/womens-health');
      await clickBoth();
      await assertNoTag();
    });
  } else if (process.env.QA_FOCUSED_BOUNDARY === 'true') {
    await run('native home-care Back and Forward privacy boundary', async () => {
      await load('/care/womens-health');
      await page.evaluate(k => localStorage.setItem(k, 'granted'), consentKey);
      await page.locator('a[href="/"]').first().click();
      await page.waitForURL(base + '/');
      await page.waitForFunction(() => Boolean(window.google_tag_manager?.['AW-18404988056']));
      await page.locator('a[href="/care/womens-health"]').first().click();
      await page.waitForURL('**/care/womens-health');
      assert.equal(await page.evaluate(() => typeof window.google_tag_manager), 'undefined');
      await page.locator('a[href="/"]').first().click();
      await page.waitForURL(base + '/');
      await page.waitForFunction(() => Boolean(window.google_tag_manager?.['AW-18404988056']));
      await page.goBack({ waitUntil: 'commit', timeout: 30000 });
      assert.equal(new URL(page.url()).pathname, '/care/womens-health');
      assert.equal(await page.evaluate(() => typeof window.google_tag_manager), 'undefined');
      await page.goForward({ waitUntil: 'commit', timeout: 30000 });
      await page.waitForFunction(() => Boolean(window.google_tag_manager?.['AW-18404988056']));
      for (const request of googleAttempts()) {
        assert.ok(!decodeURIComponent(request.url + (request.body || '')).includes('/care/'));
      }
    });
  } else {
  await run('fresh visitor: no tag before consent', async () => {
    await load();
    await page.getByRole('button', { name: 'Accept cookies', exact: true }).waitFor();
    await clickBoth();
    await assertNoTag();
    await page.screenshot({ path: path.join(output, 'consent-desktop.png'), fullPage: false });
    await page.setViewportSize({ width: 360, height: 640 });
    await page.screenshot({ path: path.join(output, 'consent-mobile.png'), fullPage: false });
    const panel = await page.getByRole('dialog', { name: 'Your cookie choices' }).boundingBox();
    assert.ok(panel && panel.y >= 0 && panel.y + panel.height <= 640, 'Consent panel must fit mobile viewport');
    const clinicBar = await page.getByRole('navigation', { name: 'Quick clinic actions' }).boundingBox();
    assert.ok(clinicBar && panel.y + panel.height < clinicBar.y, 'Cookie notice must not cover clinic actions');
    const accept = await page.getByRole('button', { name: 'Accept cookies', exact: true }).boundingBox();
    const reject = await page.getByRole('button', { name: 'Reject optional', exact: true }).boundingBox();
    assert.ok(accept && reject && Math.abs(accept.y - reject.y) < 2, 'Accept and reject remain side by side');
    await page.setViewportSize({ width: 1280, height: 900 });
  });
  await run('decline persists without any Google request', async () => {
    await page.getByRole('button', { name: 'Reject optional', exact: true }).click();
    await load();
    assert.equal(await page.evaluate(k => localStorage.getItem(k), consentKey), 'denied');
    await clickBoth();
    await assertNoTag();
    await page.setViewportSize({ width: 360, height: 640 });
    const settings = await page.getByRole('button', { name: 'Cookie settings', exact: true }).boundingBox();
    const clinicBar = await page.getByRole('navigation', { name: 'Quick clinic actions' }).boundingBox();
    assert.ok(settings && clinicBar && settings.y + settings.height < clinicBar.y, 'Cookie settings must not cover clinic actions');
    await page.setViewportSize({ width: 1280, height: 900 });
  });
  await run('opt in loads real Google tag with neutral page context', async () => {
    await page.getByRole('button', { name: 'Cookie settings', exact: true }).click();
    await page.getByRole('button', { name: 'Accept cookies', exact: true }).click();
    await page.waitForFunction(() => Boolean(window.google_tag_manager?.['AW-18404988056']), undefined, { timeout: 45000 });
    await settle();
    assert.equal(await tagPresent(), 1);
    const library = requests.find(r => r.decision === 'tag-library-only');
    assert.equal(library?.status, 200, 'Real Google script must execute for a valid network test');
    assert.equal(library.headers.referer, undefined, 'No referring URL on tag-library fetch');
    const config = await page.evaluate(() => window.dataLayer.map(x => Array.from(x)).find(x => x[0] === 'config'));
    assert.equal(config[2].page_location, 'https://asherhealthcare.in/');
    assert.equal(config[2].allow_ad_personalization_signals, false);
    assert.equal(config[2].allow_google_signals, false);
    assert.equal(config[2].allow_interest_groups, false);
    assert.equal((await queuedEvents()).length, 0, 'No click events from initialization');
  });
  await run('phone click produces blocked intent event, never a completed call', async () => {
    const start = requests.length;
    const eventStart = (await queuedEvents()).length;
    await fixedClick('tel:+919019263709');
    assert.ok(requests.slice(start).some(r => new URL(r.url).searchParams.get('label') === phoneLabel), 'Expected new intercepted phone-click conversion');
    const events = await queuedEvents();
    assert.equal(events.length, eventStart + 1);
    assert.equal(events.at(-1).send_to, `AW-18404988056/${phoneLabel}`);
    assert.ok(conversionAttempts().every(r => r.decision === 'blocked'));
  });
  await run('directions click produces blocked intent event, external navigation blocked', async () => {
    const start = requests.length;
    const eventStart = (await queuedEvents()).length;
    await fixedClick('https://maps.app.goo.gl/cvFLUCkF6nRPAHUx5');
    assert.ok(requests.slice(start).some(r => new URL(r.url).searchParams.get('label') === directionsLabel), 'Expected new intercepted directions-click conversion');
    const events = await queuedEvents();
    assert.equal(events.length, eventStart + 1);
    assert.equal(events.at(-1).send_to, `AW-18404988056/${directionsLabel}`);
  });
  await run('homepage care selection and synthetic form fields stay out of measurement', async () => {
    await page.getByRole('button', { name: 'Choose this care', exact: true }).click();
    assert.equal(new URL(page.url()).searchParams.get('care'), null, 'Care selection must not become URL context');
    await page.locator('input[name="name"]').fill('SYNTHETIC QA PERSON');
    await page.locator('input[name="phone"]').fill('9000000000');
    await page.locator('textarea[name="reason"]').fill('SYNTHETIC QA PRIVATE FORM');
    await page.locator('select[name="doctor"]').selectOption('obg');
    await clickBoth();
    const outgoing = decodeURIComponent(JSON.stringify(googleAttempts()));
    for (const marker of ['SYNTHETIC QA PERSON', '9000000000', 'SYNTHETIC QA PRIVATE FORM', '+919000000000']) {
      assert.ok(!outgoing.includes(marker), marker);
      assert.ok(!outgoing.includes(createHash('sha256').update(marker.toLowerCase()).digest('hex')), 'No hashed form marker');
    }
    for (const request of googleAttempts()) {
      const params = new URL(request.url).searchParams;
      for (const field of ['em', 'ph', 'user_data', 'sha256_email_address', 'sha256_phone_number']) assert.ok(!params.has(field), 'No enhanced-conversion field: ' + field);
    }
    assert.ok(!requests.some(r => r.url.includes('/api/appointments/book')), 'No appointment submission');
  });
  await run('withdrawal unloads tag and stays off after reload', async () => {
    await page.getByRole('button', { name: 'Cookie settings', exact: true }).click();
    await page.getByRole('button', { name: 'Reject optional', exact: true }).click();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => typeof window.google_tag_manager === 'undefined');
    await settle();
    assert.equal(await page.evaluate(k => localStorage.getItem(k), consentKey), 'denied');
    assert.equal(await page.evaluate(() => typeof window.google_tag_manager), 'undefined', 'withdrawal must unload runtime');
    await clickBoth();
    await assertNoTag();
  });
  await run('sensitive query blocks tag even with stored consent', async () => {
    await page.evaluate(k => localStorage.setItem(k, 'granted'), consentKey);
    await load('/?qa_private=synthetic-private-marker');
    await assertNoTag();
  });
  await run('sensitive fragment blocks tag even with stored consent', async () => {
    await load('/#synthetic-private-marker');
    await assertNoTag();
  });
  await run('care, privacy and portal pages block tag even with stored consent', async () => {
    for (const route of ['/care/womens-health', '/care/pediatrics', '/care/general-care-lab-tests', '/privacy', '/portal/login']) {
      await load(route);
      await assertNoTag();
    }
  });
  await run('public to portal uses fresh document without Google runtime', async () => {
    await load('/');
    await page.waitForFunction(() => Boolean(window.google_tag_manager?.['AW-18404988056']));
    await page.evaluate(() => { window.__qaDocumentMarker = 'public-before-portal'; });
    await page.locator('a[href="/portal/login"]').first().click();
    await page.waitForURL('**/portal/login');
    await settle();
    assert.equal(await tagPresent(), 0);
    assert.equal(await page.evaluate(() => window.__qaDocumentMarker), undefined, 'Expected full document navigation');
    assert.equal(await page.evaluate(() => typeof window.google_tag_manager), 'undefined');
  });
  await run('homepage to care and back uses document boundaries', async () => {
    await load('/');
    await page.waitForFunction(() => Boolean(window.google_tag_manager?.['AW-18404988056']));
    await page.evaluate(() => { window.__qaDocumentMarker = 'homepage-tagged'; });
    await page.locator('a[href="/care/womens-health"]').first().click();
    await page.waitForURL('**/care/womens-health');
    assert.equal(await page.evaluate(() => window.__qaDocumentMarker), undefined, 'forward care navigation must replace document');
    assert.equal(await page.evaluate(() => typeof window.google_tag_manager), 'undefined', 'forward care navigation must not retain Google runtime');
    await page.locator('a[href="/"]').first().click();
    await page.waitForURL(base + '/');
    await page.waitForFunction(() => Boolean(window.google_tag_manager?.['AW-18404988056']));
    await page.goBack({ waitUntil: 'commit', timeout: 30000 });
    assert.equal(new URL(page.url()).pathname, '/care/womens-health');
    assert.equal(await page.evaluate(() => typeof window.google_tag_manager), 'undefined', 'Back to care must not retain Google runtime');
    await page.goForward({ waitUntil: 'commit', timeout: 30000 });
    await page.waitForFunction(() => Boolean(window.google_tag_manager?.['AW-18404988056']));
  });
  await run('loaded tag is removed on disallowed fragment transition', async () => {
    await page.evaluate(() => { location.hash = 'synthetic-private-marker'; });
    await page.waitForFunction(() => typeof window.google_tag_manager === 'undefined');
    await settle();
    assert.equal(await tagPresent(), 0);
    assert.equal(await page.evaluate(() => typeof window.google_tag_manager), 'undefined');
  });
  await run('cross-tab withdrawal stops loaded tag', async () => {
    await page.evaluate(k => localStorage.setItem(k, 'granted'), consentKey);
    await load('/');
    await page.waitForFunction(() => Boolean(window.google_tag_manager?.['AW-18404988056']));
    const other = await context.newPage();
    await other.goto(base + '/portal/login', { waitUntil: 'domcontentloaded' });
    await other.evaluate(k => localStorage.setItem(k, 'denied'), consentKey);
    await page.bringToFront();
    await page.waitForFunction(() => typeof window.google_tag_manager === 'undefined');
    await settle();
    assert.equal(await tagPresent(), 0);
    assert.equal(await page.evaluate(k => localStorage.getItem(k), consentKey), 'denied');
    assert.equal(await page.evaluate(() => typeof window.google_tag_manager), 'undefined');
    const marker = adsAttempts().length;
    await clickBoth();
    assert.equal(adsAttempts().length, marker);
    await other.close();
  });
  await run('cross-tab storage clear revokes loaded tag', async () => {
    await page.evaluate(k => localStorage.setItem(k, 'granted'), consentKey);
    await load('/');
    await page.waitForFunction(() => Boolean(window.google_tag_manager?.['AW-18404988056']));
    const other = await context.newPage();
    await other.goto(base + '/portal/login', { waitUntil: 'domcontentloaded' });
    await other.evaluate(() => localStorage.clear());
    await page.bringToFront();
    await page.waitForFunction(() => typeof window.google_tag_manager === 'undefined');
    await settle();
    assert.equal(await tagPresent(), 0);
    assert.equal(await page.evaluate(() => typeof window.google_tag_manager), 'undefined');
    await other.close();
  });
  await run('Back after off-page withdrawal cannot resume measurement', async () => {
    await page.evaluate(k => localStorage.setItem(k, 'granted'), consentKey);
    await load('/');
    await page.waitForFunction(() => Boolean(window.google_tag_manager?.['AW-18404988056']));
    await page.locator('a[href="/care/womens-health"]').first().click();
    await page.waitForURL('**/care/womens-health');
    await page.evaluate(k => localStorage.setItem(k, 'denied'), consentKey);
    const marker = adsAttempts().length;
    await page.goBack({ waitUntil: 'commit', timeout: 30000 });
    await page.waitForFunction(() => typeof window.google_tag_manager === 'undefined');
    await clickBoth();
    assert.equal(adsAttempts().length, marker);
    console.log('Back restoration cache flag: ' + await page.evaluate(() => window.__qaRestoredFromCache));
  });
  await run('network payloads exclude sensitive context and personalization', async () => {
    for (const request of googleAttempts()) {
      const url = new URL(request.url);
      const text = decodeURIComponent(request.url + (request.body || '') + JSON.stringify(request.headers));
      assert.ok(!text.includes('synthetic-private-marker'));
      assert.ok(!text.includes('/portal/'));
      assert.ok(!text.includes('/care/'));
      for (const key of ['url', 'dl', 'top']) {
        if (url.searchParams.has(key)) {
          const contextUrl = new URL(url.searchParams.get(key));
          assert.ok([base, 'https://asherhealthcare.in'].includes(contextUrl.origin), key);
          assert.equal(contextUrl.pathname, '/', key);
          assert.equal(contextUrl.searchParams.get('care'), null, key);
        }
      }
      for (const key of ['ref', 'dr']) assert.ok(!url.searchParams.get(key), key + ' must be empty');
      for (const key of ['dt', 'tiba']) if (url.searchParams.has(key)) assert.ok(['Asher Healthcare', 'Asher Women & Child Healthcare | Bengaluru'].includes(url.searchParams.get(key)), key);
      if (adsAttempts().includes(request)) assert.equal(request.headers.referer, undefined, 'No HTTP referer on Ads measurement');
      if (request.decision !== 'tag-library-only') assert.equal(request.decision, 'blocked');
    }
    for (const request of conversionAttempts()) {
      const params = new URL(request.url).searchParams;
      assert.equal(params.get('npa'), '1', 'Actual conversion request must disable personalization');
    }
    assert.ok(conversionAttempts().length > 0, 'Must inspect real attempted tag requests');
    assert.equal(errors.length, 0, 'No unexpected page errors');
  });
  }
} catch {
  await page.screenshot({ path: path.join(output, 'failure.png'), timeout: 5000 }).catch(() => {});
  process.exitCode = 1;
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ at: new Date().toISOString(), localOnly: true, results, requests, errors }, null, 2));
  console.log(JSON.stringify({ passed: results.filter(r => r.pass).length, failed: results.filter(r => !r.pass).length, blockedRequests: requests.filter(r => r.decision === 'blocked').length, report: path.join(output, 'report.json') }));
  await browser.close();
}
