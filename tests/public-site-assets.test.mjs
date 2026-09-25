import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { clinicVisit, GENERAL_CARE_HREF, generalCareServices } from "../src/lib/general-care.ts";

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

test("general care lists only confirmed services with clinical boundaries", () => {
  assert.equal(generalCareServices.length, 6);
  const copy = generalCareServices.map(({ title, description }) => `${title} ${description}`).join("\n");
  assert.match(copy, /General consultations for all ages/u);
  assert.match(copy, /Blood and laboratory tests/u);
  assert.match(copy, /X-ray and ultrasound services/u);
  assert.match(copy, /IV treatment when prescribed by a doctor and clinically appropriate/u);
  assert.match(copy, /Vaccinations/u);
  assert.match(copy, /semen analysis and male-fertility consultations/u);
  assert.match(copy, /On-site IVF treatment is not offered\./u);
  assert.doesNotMatch(copy, /\bCT\b|\bMRI\b|24\/7|instant reports|every possible test|detox|immune.boost|accredited/iu);
  assert.doesNotMatch(copy, /₹|\b\d{1,2}:\d{2}\b|\bAM\b|\bPM\b/u);
});

test("general-care landing page and homepage keep direct clinic call and map links", async () => {
  assert.equal(clinicVisit.phoneHref, "tel:+919019263709");
  assert.equal(clinicVisit.directionsHref, "https://maps.app.goo.gl/cvFLUCkF6nRPAHUx5");
  assert.match(clinicVisit.address, /Ground Floor, 546, Thanisandra Main Road/u);
  assert.match(clinicVisit.address, /RK Hegde Nagar, Bengaluru, Karnataka 560077/u);
  const page = await readFile(path.join(root, "src/app/care/general-care-lab-tests/page.tsx"), "utf8");
  const overview = await readFile(path.join(root, "src/components/home/GeneralCare.tsx"), "utf8");
  for (const source of [page, overview]) {
    assert.match(source, /href=\{clinicVisit\.phoneHref\}/u);
    assert.match(source, /Call to book/u);
    assert.match(source, /href=\{clinicVisit\.directionsHref\}/u);
    assert.doesNotMatch(source, /onClick|preventDefault|gtag|dataLayer|sendGAEvent|sendBeacon|fetch\(|searchParams|localStorage/u);
    assert.doesNotMatch(source, /publicBookingHref|CARE_SELECTION_EVENT/u);
  }
  assert.match(page, /Dental services and dental OPG are not offered/u);
  assert.match(page, /href="\/care\/pediatrics"/u);
  assert.match(page, /href="\/care\/womens-health"/u);
  assert.match(page, /alternates: \{ canonical: GENERAL_CARE_HREF \}/u);
});

test("general-care landing page is discoverable without changing specialist booking", async () => {
  assert.equal(GENERAL_CARE_HREF, "/care/general-care-lab-tests");
  const home = await readFile(path.join(root, "src/app/page.tsx"), "utf8");
  const footer = await readFile(path.join(root, "src/components/layout/Footer.tsx"), "utf8");
  const sitemap = await readFile(path.join(root, "src/app/sitemap.ts"), "utf8");
  assert.match(home, /<Hero \/>\s+<GeneralCare \/>\s+<Services \/>/u);
  assert.match(footer, /href="\/care\/general-care-lab-tests"/u);
  assert.match(sitemap, /\/care\/general-care-lab-tests/u);
});

test("legacy Ads code remains unmounted while production uses first-party measurement", async () => {
  const layout = await readFile(path.join(root, "src/app/layout.tsx"), "utf8");
  const measurement = await readFile(
    path.join(root, "src/components/analytics/AdsClickMeasurement.tsx"),
    "utf8",
  );

  assert.match(layout, /<meta content="no-referrer" name="referrer" \/>/u);
  assert.doesNotMatch(layout, /AdsClickMeasurement/u);
  assert.match(layout, /<HomepageMeasurement \/>/u);
  assert.match(measurement, /NEXT_PUBLIC_GOOGLE_ADS_ID/u);
  assert.match(measurement, /NEXT_PUBLIC_GOOGLE_ADS_CLICK_MEASUREMENT_ENABLED/u);
  assert.match(measurement, /NEXT_PUBLIC_GOOGLE_ADS_PHONE_CLICK_LABEL/u);
  assert.match(measurement, /NEXT_PUBLIC_GOOGLE_ADS_DIRECTIONS_CLICK_LABEL/u);
  assert.match(measurement, /if \(!isConfigured \|\| blockedHere \|\| !isReady\) return null;/u);
  assert.match(measurement, /const PHONE_HREF = "tel:\+919019263709";/u);
  assert.match(
    measurement,
    /const DIRECTIONS_HREF = "https:\/\/maps\.app\.goo\.gl\/cvFLUCkF6nRPAHUx5";/u,
  );
  assert.match(measurement, /href === PHONE_HREF/u);
  assert.match(measurement, /href === DIRECTIONS_HREF/u);
  assert.match(measurement, /window\.gtag\("event", "conversion"/u);
  assert.match(measurement, /send_to: `\$\{adsId\}\/\$\{label\}`/u);
  assert.doesNotMatch(
    measurement,
    /\bvalue\s*:|\bcurrency\s*:|gtag\([^)]*["']set["'][^)]*["']user_data["']|enhanced_conversions/u,
  );
});

test("Ads tag is opt-in only, non-personalised, and insulated from care context", async () => {
  const measurement = await readFile(
    path.join(root, "src/components/analytics/AdsClickMeasurement.tsx"),
    "utf8",
  );
  const carePathways = await readFile(
    path.join(root, "src/components/home/CarePathways.tsx"),
    "utf8",
  );
  const privacy = await readFile(path.join(root, "src/app/privacy/page.tsx"), "utf8");

  const grantIndex = measurement.indexOf('choice !== "granted"');
  const initializeIndex = measurement.lastIndexOf("initializeAdsMeasurement()");
  const scriptIndex = measurement.indexOf('document.createElement("script")');
  assert.ok(grantIndex >= 0 && initializeIndex > grantIndex);
  assert.ok(scriptIndex >= 0);
  assert.match(measurement, /ad_storage: "denied"/u);
  assert.match(measurement, /ad_user_data: "denied"/u);
  assert.match(measurement, /ad_personalization: "denied"/u);
  assert.match(measurement, /analytics_storage: "denied"/u);
  assert.match(measurement, /allow_ad_personalization_signals", false/u);
  assert.match(measurement, /allow_google_signals", false/u);
  assert.match(measurement, /allow_interest_groups", false/u);
  assert.match(measurement, /ads_data_redaction", true/u);
  assert.match(measurement, /function gtag\(\) \{/u);
  assert.match(measurement, /window\.dataLayer\?\.push\(arguments\)/u);
  assert.match(measurement, /page_location: "https:\/\/asherhealthcare\.in\/"/u);
  assert.match(measurement, /page_referrer: ""/u);
  assert.match(measurement, /page_title: "Asher Healthcare"/u);
  assert.match(measurement, /const allowedPublicPaths = new Set\(\["\/"\]\);/u);
  assert.doesNotMatch(measurement, /allowedPublicPathPrefixes/u);
  assert.match(measurement, /const blockedHere = !isAllowedPublicPath\(pathname\)/u);
  assert.match(measurement, /hasAllowedInitialHomepageUrlContext/u);
  assert.match(measurement, /readStoredChoice\(\) !== "granted"/u);
  assert.match(measurement, /forceHomepageDocumentBoundary/u);
  assert.match(measurement, /destinationHasAllowedHomepageContext/u);
  assert.match(measurement, /entersUnsafeHomepageContext/u);
  assert.match(measurement, /event\.persisted/u);
  assert.match(measurement, /documentBoundaryChanged \|\|/u);
  assert.match(measurement, /!tagBlocked \|\|/u);
  assert.match(measurement, /!window\.__asherAdsClickMeasurementEnabled/u);
  assert.match(measurement, /window\.location\.reload\(\)/u);
  assert.match(measurement, /function readStoredChoice/u);
  assert.match(measurement, /function storeChoice/u);
  assert.match(
    measurement,
    /hasOnlyAllowedQueryKeys\(new URLSearchParams\(window\.location\.search\)\)/u,
  );
  assert.match(measurement, /allowedHashes\.has\(window\.location\.hash\)/u);
  assert.match(measurement, /!hasAllowedHomepageUrlContext\(\)/u);
  for (const hash of ["#care", "#journey", "#clinic", "#main-content"]) {
    assert.ok(measurement.includes(`"${hash}"`), `${hash} should remain a safe homepage anchor`);
  }
  assert.doesNotMatch(carePathways, /history\.replaceState|searchParams\.set\("care"/u);
  assert.match(carePathways, /new CustomEvent\(CARE_SELECTION_EVENT/u);
  assert.doesNotMatch(
    measurement,
    /window\.location\.href|document\.(?:title|referrer)|patientName|doctorId|appointmentReason/u,
  );
  assert.match(measurement, /this homepage immediately loads Google Ads/u);
  assert.match(measurement, /this homepage\s+address and title/u);
  assert.match(privacy, /Cookie-free homepage statistics/u);
  assert.match(privacy, /store only daily totals/u);
  assert.match(privacy, /not a completed call, appointment or clinic visit/u);
  assert.match(privacy, /no longer loads the Google Ads measurement tag/u);
});

test("homepage measurement boundaries render as native document links", async () => {
  const fullyNativeFiles = [
    "src/components/layout/Navbar.tsx",
    "src/components/layout/Footer.tsx",
    "src/components/home/CarePathways.tsx",
    "src/components/home/GeneralCare.tsx",
    "src/components/home/PatientJourney.tsx",
    "src/components/care/CareDetailPage.tsx",
    "src/components/legal/LegalPage.tsx",
    "src/app/admin/login/page.tsx",
    "src/app/error.tsx",
    "src/app/not-found.tsx",
  ];

  for (const file of fullyNativeFiles) {
    const source = await readFile(path.join(root, file), "utf8");
    assert.doesNotMatch(source, /from "next\/link"|<Link\b/u, file);
  }

  const portalLogin = await readFile(path.join(root, "src/app/portal/login/page.tsx"), "utf8");
  const portalDashboard = await readFile(
    path.join(root, "src/components/portal/PatientPortalDashboard.tsx"),
    "utf8",
  );
  const generalCarePage = await readFile(
    path.join(root, "src/app/care/general-care-lab-tests/page.tsx"),
    "utf8",
  );
  assert.match(portalLogin, /<a href="\/"/u);
  assert.match(portalDashboard, /<a href="\/#appointment"/u);
  assert.match(generalCarePage, /<a className=\{styles\.backLink\} href="\/#general-care"/u);
});
