import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";

const root = process.cwd();

async function source(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

test("patient homepage is readable without decorative motion or client-only reveals", async () => {
  const page = await source("src/app/page.tsx");
  const homeFiles = await Promise.all([
    "Hero", "CareOptions", "Doctors", "AppointmentCTA", "VisitGuide", "FrequentlyAskedQuestions", "Contact",
  ].map((file) => source(`src/components/home/${file}.tsx`)));

  assert.doesNotMatch(page, /PremiumMotion|^"use client"/u);
  for (const component of homeFiles) {
    assert.doesNotMatch(component, /premium-tilt|data-premium-tilt|motion-reveal|hero-depth-ring|hero-glass-sheen/u);
    assert.doesNotMatch(component, /framer-motion|three|WebGL|<canvas|<video|autoPlay|onMouseMove|onPointerMove/u);
  }
});

test("hero uses identifiable real doctors and direct patient actions", async () => {
  const hero = await source("src/components/home/Hero.tsx");

  assert.equal([...hero.matchAll(/<h1\b/gu)].length, 1);
  assert.match(hero, /aria-labelledby="welcome-heading"/u);
  assert.match(hero, /<h1 id="welcome-heading">/u);
  for (const [asset, name] of [
    ["dr-shafi-ahamad.jpg", "Dr. Lt Col Shafi Ahamad"],
    ["dr-shaik-reshma.jpg", "Dr. Shaik Reshma"],
  ]) {
    const image = [...hero.matchAll(/<Image\s[\s\S]*?\/>/gu)].find((match) => match[0].includes(asset))?.[0];
    assert.ok(image, `hero must use ${asset}`);
    assert.ok(image.includes(`alt="${name}`), "doctor portraits need identifying alternative text");
    assert.match(image, /\bpreload\b/u);
    assert.match(image, /\bsizes=/u);
    assert.doesNotMatch(image, /\bpriority\b/u);
  }
  assert.match(hero, /href="#appointment"/u);
  assert.match(hero, /href="tel:\+919019263709"/u);
  assert.match(hero, /href="https:\/\/maps\.app\.goo\.gl\/cvFLUCkF6nRPAHUx5"/u);
  assert.doesNotMatch(hero, /asher-hero-clinic|Representative|floating-card|hero-security-chip|onClick|preventDefault/u);
});

test("makeover CSS cannot leak into staff pages and supports keyboard and reduced-motion users", async () => {
  const css = await source("src/app/patient-home.css");
  const page = await source("src/app/page.tsx");
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//gu, "");
  const selectors = [...withoutComments.matchAll(/([^{}]+)\{/gu)]
    .map((match) => match[1].trim())
    .filter((selector) => !selector.startsWith("@"));
  assert.ok(selectors.length > 20, "the scoped stylesheet should cover the patient experience");
  for (const selectorGroup of selectors) {
    for (const selector of selectorGroup.split(/,(?![^(]*\))/u)) {
      assert.match(selector.trim(), /^\.patient-home(?:[\s.:#[>+~]|$)/u, `unscoped selector: ${selector.trim()}`);
    }
  }
  assert.match(page, /className="patient-home"/u);
  assert.match(css, /:focus-visible/u);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/u);
  assert.match(css, /scroll-behavior:\s*auto/u);
  assert.match(css, /animation:\s*none/u);
  assert.match(css, /transition:\s*none/u);
  assert.doesNotMatch(css, /@keyframes|perspective\s*:|rotate[XY]\(/u);
});
