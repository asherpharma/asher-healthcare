import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (file) => readFile(new URL("../" + file, import.meta.url), "utf8");

test("specialist journeys show each doctor's verified public profile details", async () => {
  const source = await read("src/lib/public-clinic-content.ts");
  for (const detail of [
    'doctor: "Dr. Lt Col Shafi Ahamad"',
    'doctorQualifications: "MBBS, MD (Pediatrics)"',
    'doctorImage: "/images/dr-shafi-ahamad.jpg"',
    'doctor: "Dr. Shaik Reshma"',
    'doctorQualifications: "MBBS, MS (OBG)"',
    'doctorImage: "/images/dr-shaik-reshma.jpg"',
  ]) assert.ok(source.includes(detail), detail);
});

test("specialist page keeps care context in booking links and uses clinic contact details", async () => {
  const source = await read("src/components/care/CareDetailPage.tsx");
  for (const detail of [
    'const bookingHref = "/?care=" + journey.id + "#appointment";',
    "<Navbar bookingHref={bookingHref} />",
    "<Footer bookingHref={bookingHref} />",
    "href={bookingHref}",
    "src={journey.doctorImage}",
    "alt={journey.doctorImageAlt}",
    "clinicVisit.phoneHref",
    "clinicVisit.directionsHref",
  ]) assert.ok(source.includes(detail), detail);
  assert.ok(!source.includes("src={journey.image}"), "use the named specialist's portrait");
});

test("shared navigation keeps its home default and specialist portrait styling adapts to mobile", async () => {
  const [navbar, footer, styles] = await Promise.all([
    read("src/components/layout/Navbar.tsx"),
    read("src/components/layout/Footer.tsx"),
    read("src/components/care/CareDetailPage.module.css"),
  ]);
  assert.ok(navbar.includes('bookingHref = "/#appointment"'));
  assert.equal(navbar.split("href={bookingHref}").length - 1, 2);
  assert.ok(footer.includes('bookingHref = "/#appointment"'));
  assert.ok(footer.includes("href={bookingHref}"));
  assert.ok(styles.includes("@media (max-width: 540px)"));
  assert.ok(styles.includes(".doctorPortrait"));
});
