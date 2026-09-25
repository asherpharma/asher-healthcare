// Audit intercepted LOCAL browser reports, including focused retries. This
// performs no network activity and does not turn failed checks into passes.
// The latest functional result must pass; payload validation is rerun here.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const filenames = process.argv.slice(2);
assert.ok(filenames.length, 'Provide browser report JSON paths in run order');
const reports = await Promise.all(filenames.map(async file => JSON.parse(await readFile(file, 'utf8'))));
const latest = new Map();
const allRequests = [];
for (const report of reports) {
  assert.equal(report.localOnly, true);
  assert.equal(report.errors.length, 0, 'Unexpected browser page error');
  for (const result of report.results) latest.set(result.name, result);
  allRequests.push(...report.requests);
}
const functional = [...latest.values()].filter(test => test.name !== 'network payloads exclude sensitive context and personalization');
assert.equal(functional.length, 16, 'All functional scenarios must have results');
for (const test of functional) assert.equal(test.pass, true, test.name);

const googleRequests = allRequests.filter(request => /google|doubleclick/.test(new URL(request.url).hostname));
const isExistingMap = request => {
  const url = new URL(request.url);
  return url.hostname === 'www.google.com' && url.pathname === '/maps' && url.searchParams.get('output') === 'embed';
};
const adsRequests = googleRequests.filter(request => !isExistingMap(request));
let conversionRequests = 0;
const labels = new Set();
for (const request of googleRequests) {
  const url = new URL(request.url);
  const text = decodeURIComponent(request.url + (request.body || '') + JSON.stringify(request.headers));
  for (const marker of ['synthetic-private-marker', '/care/', '/portal/', 'SYNTHETIC QA PERSON', '9000000000', 'SYNTHETIC QA PRIVATE FORM', '+919000000000']) {
    assert.ok(!text.includes(marker), `Forbidden context: ${marker}`);
    assert.ok(!text.includes(createHash('sha256').update(marker.toLowerCase()).digest('hex')), 'Hashed private marker');
  }
  for (const key of ['em', 'ph', 'user_data', 'sha256_email_address', 'sha256_phone_number']) assert.ok(!url.searchParams.has(key), key);
  for (const key of ['url', 'dl', 'top']) {
    if (!url.searchParams.has(key)) continue;
    const context = new URL(url.searchParams.get(key));
    assert.ok(['http://127.0.0.1:4318', 'https://asherhealthcare.in'].includes(context.origin), key);
    assert.equal(context.pathname, '/', key);
    assert.equal(context.searchParams.get('care'), null, key);
  }
  for (const key of ['ref', 'dr']) assert.ok(!url.searchParams.get(key), key);
  for (const key of ['dt', 'tiba']) if (url.searchParams.has(key)) assert.ok(['Asher Healthcare', 'Asher Women & Child Healthcare | Bengaluru'].includes(url.searchParams.get(key)), key);
  if (!isExistingMap(request)) assert.equal(request.headers.referer, undefined, 'Ads request referrer');
  if (request.decision === 'tag-library-only') {
    assert.equal(request.url, 'https://www.googletagmanager.com/gtag/js?id=AW-18404988056');
    assert.equal(request.status, 200);
    assert.equal(request.headers.cookie, undefined);
    assert.equal(request.headers.authorization, undefined);
  } else assert.equal(request.decision, 'blocked');
  if (/(?:pagead\/(?:1p-)?conversion|viewthroughconversion|\/ccm\/collect|\/g\/collect)/.test(url.pathname)) {
    conversionRequests++;
    assert.equal(url.searchParams.get('npa'), '1');
    if (url.searchParams.has('label')) labels.add(url.searchParams.get('label'));
  }
}
assert.ok(conversionRequests > 0);
assert.ok(labels.has('i2sQCLOk-IMdEJipl8hE'), 'Actual phone-click request required');
assert.ok(labels.has('j5IqCLak-IMdEJipl8hE'), 'Actual directions-click request required');
console.log(JSON.stringify({ pass: true, functionalScenarios: functional.length, reports: filenames.length, inspectedAdsRequests: adsRequests.length, blockedMeasurementRequests: adsRequests.filter(request => request.decision === 'blocked').length, existingMapRequestsAuditedSeparately: googleRequests.length - adsRequests.length }));
