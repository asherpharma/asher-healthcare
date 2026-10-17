import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import adapter, { injectHomepageGtmBootstrap, GOOGLE_GTM_NOSCRIPT } from "../scripts/gtm-head-adapter.mjs";

const bootstrap = "window.__asherPlacementFixture = true;";
const html = '<!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/><link rel="stylesheet" href="/_next/style.css"/><meta content="no-referrer" name="referrer"/><title>Asher Healthcare</title></head><body id="top"><main id="main-content">Homepage</main><script>self.__next_f.push([1,"payload"])</script></body></html>';
const originalGoogleNoscript = `<!-- Google Tag Manager (noscript) -->
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-TQC7XR38"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<!-- End Google Tag Manager (noscript) -->`;
const renderedGoogleNoscript = originalGoogleNoscript.replace("-->\n<noscript>", "--><noscript>").replace("</noscript>\n<!--", "</noscript><!--");

test("the original Google fallback element is unchanged; only exterior comment spacing is compacted for React", () => {
  assert.equal(GOOGLE_GTM_NOSCRIPT, renderedGoogleNoscript);
  assert.equal(GOOGLE_GTM_NOSCRIPT.match(/<noscript>[\s\S]*?<\/noscript>/u)[0], originalGoogleNoscript.match(/<noscript>[\s\S]*?<\/noscript>/u)[0]);
  assert.doesNotMatch(GOOGLE_GTM_NOSCRIPT, /\s(?:id|title|referrerpolicy)=/iu);
});

test("the separate privacy bootstrap and original body fallback are parser-visible in their exact positions", () => {
  const updated = injectHomepageGtmBootstrap(html, bootstrap);
  assert.ok(updated.includes(`<head><meta charSet="utf-8"/><meta content="no-referrer" name="referrer"/><script id="asher-homepage-gtm-bootstrap">${bootstrap}</script><link`));
  assert.equal(updated.match(/name="referrer"/gu).length, 1);
  assert.equal(updated.match(/charSet="utf-8"/gu).length, 1);
  assert.equal(updated.match(/<script id="asher-homepage-gtm-bootstrap">/gu).length, 1);
  const fallback = renderedGoogleNoscript;
  assert.ok(updated.includes(fallback));
  assert.ok(updated.includes(`<body id="top">${fallback}<main`));
  assert.equal(updated.slice(updated.indexOf("<body")).replace(fallback, ""), html.slice(html.indexOf("<body")));
  assert.ok(updated.includes("<title>Asher Healthcare</title>"));
  assert.equal(updated.match(/<noscript>/gu).length, 1);
  assert.equal(updated.match(/<iframe\b/gu).length, 1);
  assert.ok(fallback.includes('src="https://www.googletagmanager.com/ns.html?id=GTM-TQC7XR38"'));
  assert.ok(fallback.includes('height="0" width="0" style="display:none;visibility:hidden"'));
  assert.ok(updated.indexOf('content="no-referrer"') < updated.indexOf(fallback), "The page policy must precede the untouched iframe.");
  assert.doesNotMatch(updated, /rel="preload"/u);
});

test("reapplying the exact bootstrap is idempotent; stale or duplicate markup fails closed", () => {
  const updated = injectHomepageGtmBootstrap(html, bootstrap);
  assert.equal(injectHomepageGtmBootstrap(updated, bootstrap), updated);
  assert.throws(() => injectHomepageGtmBootstrap(updated, bootstrap + "\nwindow.other = true;"), /differs or is misplaced/u);
  const duplicate = updated.replace("</head>", `<script id="asher-homepage-gtm-bootstrap">${bootstrap}</script></head>`);
  assert.throws(() => injectHomepageGtmBootstrap(duplicate, bootstrap), /Duplicate/u);
  const misplaced = updated.replace(`<script id="asher-homepage-gtm-bootstrap">${bootstrap}</script>`, "")
    .replace("</head>", `<script id="asher-homepage-gtm-bootstrap">${bootstrap}</script></head>`);
  assert.throws(() => injectHomepageGtmBootstrap(misplaced, bootstrap), /misplaced/u);
  const fallback = renderedGoogleNoscript;
  assert.throws(() => injectHomepageGtmBootstrap(updated.replace("</body>", `${fallback}</body>`), bootstrap), /Duplicate/u);
  assert.throws(() => injectHomepageGtmBootstrap(updated.replace(fallback, fallback.replace('width="0"', 'width="1"')), bootstrap), /fallback differs/u);
  assert.throws(() => injectHomepageGtmBootstrap(updated.replace(fallback, fallback.replace("<iframe ", '<iframe referrerpolicy="no-referrer" ')), bootstrap), /fallback differs/u);
  assert.throws(() => injectHomepageGtmBootstrap(updated.replace(fallback, fallback.replace("<noscript>", '<noscript id="asher-homepage-gtm-noscript">')), bootstrap), /fallback differs/u);
  assert.throws(() => injectHomepageGtmBootstrap(updated.replace(fallback, "").replace("</body>", `${fallback}</body>`), bootstrap), /fallback differs or is misplaced/u);
  assert.throws(() => injectHomepageGtmBootstrap(updated.replace(fallback, ""), bootstrap), /Incomplete/u);
  assert.throws(() => injectHomepageGtmBootstrap(updated.replace(`<script id="asher-homepage-gtm-bootstrap">${bootstrap}</script>`, ""), bootstrap), /Incomplete/u);
});

test("invalid script and document input cannot produce an apparently valid export", () => {
  for (const source of [undefined, null, "", " ", "</script><script>window.bad = true", "<!--comment", "window.x = '\0';", "function("]) {
    assert.throws(() => injectHomepageGtmBootstrap(html, source), undefined, String(source));
  }
  for (const page of [
    undefined, null, "<html></html>", html.replace("<head>", ""), html.replace("</head>", ""),
    html.replace("</head>", "<head></head></head>"), html.replace("<title>Asher Healthcare</title>", ""),
    html.replace("Asher Healthcare</title>", "Patient records</title>"),
    html.replace("</head>", "<title>Asher Healthcare</title></head>"),
    html.replace('<meta charSet="utf-8"/>', ""), html.replace('charSet="utf-8"', 'charSet="utf-16"'),
    html.replace('content="no-referrer"', 'content="origin"'),
    html.replace('<meta content="no-referrer" name="referrer"/>', ""),
    html.replace("</head>", '<meta name="referrer" content="no-referrer"/></head>'),
    html.replace("</body>", '<meta name="referrer" content="origin"/></body>'),
    html.replace('name="referrer"', 'name="other" name="referrer"'),
    html.replace('charSet="utf-8"', 'charSet="utf-16" charset="utf-8"'),
    html.replace("Homepage</main>", "Homepage<form></form></main>"),
    html.replace("</head>", '<link rel="preload" href="https://www.googletagmanager.com/gtm.js?id=GTM-TQC7XR38"/></head>'),
    html.replace("</body>", '<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-TQC7XR38"></iframe></noscript></body>'),
  ]) assert.throws(() => injectHomepageGtmBootstrap(page, bootstrap));
});

test("the adapter rejects unreviewed versions, output modes and target metadata", async () => {
  const context = { config: { output: "export" }, nextVersion: "16.3.7", projectDir: "/fixture", outputs: { staticFiles: [] } };
  for (const invalid of [
    { ...context, config: { output: "standalone" } }, { ...context, nextVersion: "16.3.8" },
    { ...context, projectDir: null }, { ...context, outputs: {} }, context,
    { ...context, outputs: { staticFiles: [{ id: "index.html", filePath: "/fixture/out/book.html" }] } },
    { ...context, outputs: { staticFiles: [{ id: "../index.html", filePath: "/fixture/out/index.html" }] } },
    { ...context, outputs: { staticFiles: [{ id: "index.html", filePath: "/fixture/out/index.html" }, { id: "index.html", filePath: "/fixture/out/index.html" }] } },
  ]) await assert.rejects(adapter.onBuildComplete(invalid));
});

test("the completed static export hook modifies only out/index.html", async (t) => {
  const fixture = await mkdtemp(join(tmpdir(), "asher-gtm-head-adapter-"));
  const cleanupTarget = resolve(fixture);
  if (dirname(cleanupTarget) !== resolve(tmpdir()) || !basename(cleanupTarget).startsWith("asher-gtm-head-adapter-")) {
    throw new Error("Unexpected temporary fixture cleanup target.");
  }
  t.after(() => rm(cleanupTarget, { recursive: true, force: true }));
  const output = join(fixture, "out");
  await mkdir(output);
  const homepage = join(output, "index.html");
  const excluded = ["book.html", "admin.html", "portal.html", "privacy.html", "404.html", "index.txt"];
  await writeFile(homepage, html);
  for (const name of excluded) await writeFile(join(output, name), `excluded:${name}`);
  const context = {
    config: { output: "export" }, nextVersion: "16.3.7", projectDir: fixture,
    outputs: { staticFiles: [{ id: "/index.html", filePath: homepage }, ...excluded.map((name) => ({ id: `/${name}`, filePath: join(output, name) }))] },
  };
  await adapter.onBuildComplete(context);
  const updated = await readFile(homepage, "utf8");
  assert.ok(updated.includes('id="asher-homepage-gtm-bootstrap"'));
  assert.ok(updated.includes(renderedGoogleNoscript));
  assert.ok(updated.includes("GTM-TQC7XR38"));
  for (const name of excluded) assert.equal(await readFile(join(output, name), "utf8"), `excluded:${name}`);
  for (const id of ["\\index.html", "index.html", "/index.html"]) {
    context.outputs.staticFiles[0].id = id;
    await adapter.onBuildComplete(context);
    assert.equal(await readFile(homepage, "utf8"), updated);
  }
});
