import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (file) => readFile(new URL("../" + file, import.meta.url), "utf8");

test("specialist journeys show each doctor's verified public profile details", async () => {
  const source = await read("src/lib/public-clinic-content.ts");
  assert.match(source, /id: "pediatrics",[\s\S]*?doctor: "Dr\. Lt Col Shafi Ahamad",[\s\S]*?doctorQualifications: "MBBS, MD \(Pediatrics\)",[\s\S]*?doctorImage: "\/images\/dr-shafi-ahamad\.jpg"/);
  assert.match(source, /id: "obg",[\s\S]*?doctor: "Dr\. Shaik Reshma",[\s\S]*?doctorQualifications: "MBBS, MS \(OBG\)",[\s\S]*?doctorImage: "\/images\/dr-shaik-reshma\.jpg"/);
});

test("specialist page keeps the selected care type in booking links and uses clinic contact details", async () => {
  const source = await read("src/components/care/CareDetailPage.tsx");
  assert.match(source, /const bookingHref = "\/?care=" \+ journey\.id \+ "#appointment"/);
  assert.match(source, /<Navbar bookingHref=\{bookingHref\}/);
  assert.match(source, /<Footer bookingHref=\{bookingHref\}/);
  assert.match(source, /href=\{bookingHref\}/);
  assert.match(source, /src=\{journey\.doctorImage\}/);
  assert.match(source, /alt=\{journey\.doctorImageAlt\}/);
  assert.doesNotMatch(source, /src=\{journey\.image\}/);
  assert.match(source, /clinicVisit\.phoneHref/);
  assert.match(source, /clinicVisit\.directionsHref/);
});

test("shared navigation defaults stay unchanged while specialist pages can pass context", async () => {
  const [navbar, footer, styles] = await Promise.all([
    read("src/components/layout/Navbar.tsx"),
    read("src/components/layout/Footer.tsx"),
    read("src/components/care/CareDetailPage.module.css"),
  ]);
  assert.match(navbar, /bookingHref = "\/#appointment"/);
  assert.equal(navbar.match(/href=\{bookingHref\}/g)?.length, 2);
  assert.match(footer, /bookingHref = "\/#appointment"/);
  assert.match(footer, /href=\{bookingHref\}/);
  assert.match(styles, /@media \(max-width: 540px\)/);
  assert.match(styles, /\.doctorPortrait/);
});
