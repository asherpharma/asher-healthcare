import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";

const root = process.cwd();

async function source(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

test("public motion is a small progressive client enhancement", async () => {
  const page = await source("src/app/page.tsx");
  const controller = await source("src/components/home/PremiumMotion.tsx");

  assert.match(page, /<PremiumMotion \/>/u);
  assert.match(controller, /^"use client";/u);
  assert.match(controller, /IntersectionObserver/u);
  assert.match(controller, /prefers-reduced-motion: reduce/u);
  assert.match(controller, /\(hover: hover\) and \(pointer: fine\)/u);
  assert.match(controller, /requestAnimationFrame/u);
  assert.doesNotMatch(controller, /framer-motion|three|WebGL|canvas/u);
});

test("hero depth remains semantic and decorative layers stay hidden", async () => {
  const hero = await source("src/components/home/Hero.tsx");

  assert.match(hero, /data-premium-tilt="3\.5"/u);
  assert.match(hero, /hero-depth-ring hero-depth-ring-one" aria-hidden="true"/u);
  assert.match(hero, /hero-glass-sheen" aria-hidden="true"/u);
  assert.match(hero, /<h1>Healthcare designed around/u);
  assert.match(hero, /href="#appointment"/u);
  assert.doesNotMatch(hero, /<video|autoPlay|<canvas/u);
});

test("3D interactions are restrained and opt out for reduced motion", async () => {
  const css = await source("src/app/globals.css");
  const homeFiles = await Promise.all([
    "Hero.tsx",
    "Services.tsx",
    "CarePathways.tsx",
    "WhyChooseUs.tsx",
    "Doctors.tsx",
    "Gallery.tsx",
  ].map((file) => source(`src/components/home/${file}`)));

  assert.match(css, /@media \(hover: hover\) and \(pointer: fine\)/u);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.motion-enhanced \.motion-reveal[\s\S]*opacity: 1 !important/u);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.premium-tilt[\s\S]*transform: none !important/u);
  assert.match(css, /\.hero-depth-ring \{ animation: none !important; \}/u);

  const strengths = homeFiles
    .flatMap((file) => [...file.matchAll(/data-premium-tilt="([0-9.]+)"/gu)])
    .map((match) => Number(match[1]));
  assert.ok(strengths.length >= 6, "premium depth should cover the key public surfaces");
  assert.ok(strengths.every((value) => value > 0 && value <= 5), "tilt strength should remain subtle");
});
