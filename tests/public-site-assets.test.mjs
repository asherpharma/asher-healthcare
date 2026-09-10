import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";

import {
  nextPublicBookingDate,
  PUBLIC_BOOKING_WHATSAPP_URL,
  publicBookingDoctor,
  publicBookingHref,
} from "../src/lib/public-booking.ts";

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
  const faq = await readFile(path.join(root, "src/components/home/FrequentlyAskedQuestions.tsx"), "utf8");
  const booking = await readFile(path.join(root, "src/components/home/AppointmentCTA.tsx"), "utf8");
  const doctors = await readFile(path.join(root, "src/components/home/Doctors.tsx"), "utf8");
  const care = await readFile(path.join(root, "src/lib/public-clinic-content.ts"), "utf8");
  const publicCopy = `${hero}\n${contact}\n${faq}\n${booking}\n${doctors}\n${care}`;

  assert.match(hero, /Dr\. Shafi 5–8 PM · Dr\. Reshma 7–9 PM/u);
  assert.match(contact, /Monday–Saturday/u);
  assert.match(publicCopy, /Dr\. Shafi(?: from|:) 5:00 PM(?:–| to )8:00 PM/u);
  assert.match(publicCopy, /Dr\. Reshma(?: from|:) 7:00 PM(?:–| to )9:00 PM/u);
  assert.doesNotMatch(publicCopy, /Specialist slots Mon–Sat, 5–8 PM/u);
  assert.doesNotMatch(publicCopy, /specialist appointments are normally available[^.]*5:00 PM to 8:00 PM/u);
  assert.doesNotMatch(publicCopy, /Open every day|Open daily/u);
});

test("appointment booking keeps its initial server and client markup time-neutral", async () => {
  const appointment = await readFile(
    path.join(root, "src/components/home/AppointmentCTA.tsx"),
    "utf8",
  );

  assert.match(appointment, /const \[date, setDate\] = useState\(""\);/u);
  assert.match(
    appointment,
    /const \[clinicClock, setClinicClock\] = useState\(\{ date: "", time: "" \}\);/u,
  );
  assert.match(
    appointment,
    /setTimeout\(\(\) => setClinicClock\(currentClinicClock\(\)\), 0\)/u,
  );
  assert.match(
    appointment,
    /nextEnabledDate\(schedule, clinicClock\.date\)/u,
  );
  assert.doesNotMatch(appointment, /useState\(currentClinicClock\)/u);
  assert.doesNotMatch(appointment, /useState\(\(\) => nextEnabledDate\(schedule\)\)/u);
  assert.doesNotMatch(appointment, /min=\{clinicDate\(\)\}/u);
});

test("specialty booking links preserve the intended doctor", () => {
  assert.equal(publicBookingHref("pediatrics"), "/?care=pediatrics#appointment");
  assert.equal(publicBookingHref("obg"), "/?care=obg#appointment");
  assert.equal(publicBookingHref(), "/#appointment");
  assert.equal(publicBookingDoctor("pediatrics"), "pediatrics");
  assert.equal(publicBookingDoctor("obg"), "obg");
  assert.equal(publicBookingDoctor("unknown"), null);
  assert.equal(publicBookingDoctor(null), null);
});

test("next clinic day search skips closed days and stays bounded", () => {
  const mondayToSaturday = { enabledDays: [1, 2, 3, 4, 5, 6] };
  assert.equal(nextPublicBookingDate(mondayToSaturday, "2026-09-11"), "2026-09-12");
  assert.equal(nextPublicBookingDate(mondayToSaturday, "2026-09-12"), "2026-09-14");
  assert.equal(nextPublicBookingDate({ enabledDays: [0] }, "2026-09-14", 3), "");
  assert.equal(nextPublicBookingDate({ enabledDays: [] }, "2026-09-14", 99), "");
  assert.equal(nextPublicBookingDate(mondayToSaturday, "not-a-date"), "");
  assert.equal(nextPublicBookingDate(mondayToSaturday, "2026-02-31"), "");
  assert.equal(nextPublicBookingDate({ enabledDays: [0] }, "2026-09-14", Number.NaN), "2026-09-20");
});

test("doctor and service calls to action share the private booking handoff", async () => {
  const doctors = await readFile(path.join(root, "src/components/home/Doctors.tsx"), "utf8");
  const services = await readFile(path.join(root, "src/components/home/Services.tsx"), "utf8");
  const care = await readFile(path.join(root, "src/components/home/CarePathways.tsx"), "utf8");
  const detail = await readFile(path.join(root, "src/components/care/CareDetailPage.tsx"), "utf8");
  const bookingLink = await readFile(path.join(root, "src/components/home/PublicBookingLink.tsx"), "utf8");

  assert.match(doctors, /<PublicBookingLink doctorId=\{doctor\.id\}>/u);
  assert.match(services, /<PublicBookingLink doctorId=\{service\.doctorId\}>/u);
  assert.match(services, /doctorId: "pediatrics"[\s\S]*?title: "Pediatric Care"/u);
  assert.match(services, /doctorId: "obg"[\s\S]*?title: "Pregnancy Care"/u);
  assert.match(care, /publicBookingHref\(doctorId\)/u);
  assert.match(detail, /publicBookingHref\(journey\.id\)/u);
  assert.match(bookingLink, /new CustomEvent\(CARE_SELECTION_EVENT/u);
  assert.match(bookingLink, /prefers-reduced-motion: reduce/u);
});

test("public booking uses tappable slots and keeps confirmation on the website", async () => {
  const booking = await readFile(path.join(root, "src/components/home/AppointmentCTA.tsx"), "utf8");
  const motion = await readFile(path.join(root, "src/components/home/PremiumMotion.tsx"), "utf8");
  const whatsappMessage = decodeURIComponent(new URL(PUBLIC_BOOKING_WHATSAPP_URL).searchParams.get("text") || "");

  assert.match(booking, /className="booking-slot-grid"/u);
  assert.match(booking, /type="radio"\s+name="time"/u);
  assert.doesNotMatch(booking, /<select[\s\S]{0,200}name="time"/u);
  assert.match(booking, /nextPublicBookingDate\(schedule, date\)/u);
  assert.match(booking, /if \(submittingRef\.current\) return;/u);
  assert.match(booking, /submittingRef\.current = true;/u);
  assert.match(booking, /role=\{result\.tone === "success" \? "status" : "alert"\}/u);
  assert.match(booking, /WhatsApp clinic \(optional\)/u);
  assert.doesNotMatch(booking, /window\.open\(whatsappUrl|window\.location\.href = whatsappUrl/u);
  assert.doesNotMatch(whatsappMessage, /patient|phone|symptom|reason|doctor|date|time/iu);
  assert.doesNotMatch(motion, /\.appointment-copy > \*|\.booking-card/u);
});
