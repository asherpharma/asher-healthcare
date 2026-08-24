import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";

const root = process.cwd();

const publicImages = [
  "public/asher-hero-clinic-v2.webp",
  "public/asher-abstract-care-v2.webp",
  "public/images/asher-logo-compact-v2.webp",
  "public/images/pediatric-care-consultation-v2.webp",
  "public/images/womens-care-consultation-v2.webp",
];

test("public care imagery exists and stays lightweight", async () => {
  for (const relativePath of publicImages) {
    const details = await stat(path.join(root, relativePath));
    assert.ok(details.isFile(), `${relativePath} should be a file`);
    assert.ok(details.size > 10_000, `${relativePath} should not be empty`);
    assert.ok(details.size < 250_000, `${relativePath} should stay below 250 KB`);
  }
});

test("homepage keeps its public navigation anchors and new care journey", async () => {
  const page = await readFile(path.join(root, "src/app/page.tsx"), "utf8");
  const care = await readFile(
    path.join(root, "src/components/home/CarePathways.tsx"),
    "utf8",
  );
  const appointment = await readFile(
    path.join(root, "src/components/home/AppointmentCTA.tsx"),
    "utf8",
  );

  for (const section of [
    "<Hero />",
    "<Services />",
    "<CarePathways />",
    "<Doctors />",
    "<PatientJourney />",
    "<AppointmentCTA />",
    "<Contact />",
  ]) {
    assert.ok(page.includes(section), `${section} should remain on the homepage`);
  }

  assert.match(care, /This guide helps with navigation—it does not diagnose/u);
  assert.match(care, /For emergencies, use local emergency services/u);
  assert.match(appointment, /CARE_SELECTION_EVENT/u);
});

test("care detail pages and sitemap remain discoverable", async () => {
  const sitemap = await readFile(path.join(root, "src/app/sitemap.ts"), "utf8");
  const pediatrics = await stat(path.join(root, "src/app/care/pediatrics/page.tsx"));
  const womensHealth = await stat(path.join(root, "src/app/care/womens-health/page.tsx"));

  assert.ok(pediatrics.isFile());
  assert.ok(womensHealth.isFile());
  assert.match(sitemap, /care\/pediatrics/u);
  assert.match(sitemap, /care\/womens-health/u);
});

test("public specialist hours are consistent with the default booking schedule", async () => {
  const hero = await readFile(path.join(root, "src/components/home/Hero.tsx"), "utf8");
  const contact = await readFile(path.join(root, "src/components/home/Contact.tsx"), "utf8");
  const appointments = await readFile(path.join(root, "src/lib/appointments.ts"), "utf8");

  assert.match(hero, /Mon–Sat, 5–8 PM/u);
  assert.match(contact, /Monday–Saturday/u);
  assert.match(contact, /5:00 PM–8:00 PM/u);
  assert.match(appointments, /startTime: "17:00"/u);
  assert.match(appointments, /endTime: "20:00"/u);
  assert.doesNotMatch(`${hero}\n${contact}`, /Open every day|Open daily/u);
});
