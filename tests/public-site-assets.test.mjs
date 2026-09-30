import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { clinicVisit, GENERAL_CARE_HREF, generalCareServices } from "../src/lib/general-care.ts";

const root = process.cwd();

const publicImages = [
  "public/asher-hero-clinic-v2.webp",
  "public/asher-abstract-care-v2.webp",
  "public/images/asher-logo-compact-v2.webp",
  "public/images/pediatric-care-consultation-v2.webp",
  "public/images/womens-care-consultation-v2.webp",
  "public/images/dr-shafi-ahamad.jpg",
  "public/images/dr-shaik-reshma.jpg",
];

async function loadPublicComponent(relativePath, browser = {}, modules = {}) {
  const source = await readFile(path.join(root, relativePath), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const exports = {};
  const jsx = (type, props) => ({ type, props });
  vm.runInNewContext(compiled, {
    exports,
    require(name) {
      if (Object.hasOwn(modules, name)) return modules[name];
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "Fragment" };
      if (name === "next/image") return { default: "Image" };
      if (name === "lucide-react") return new Proxy({}, { get: (_target, icon) => `icon:${String(icon)}` });
      if (name === "./CareBookingLink") return { default: "CareBookingLink" };
      if (name === "@/lib/public-clinic-content") return { CARE_SELECTION_EVENT: "asher:select-care" };
      throw new Error(`Unexpected public component dependency: ${name}`);
    },
    ...browser,
  });
  return exports.default;
}

function descendants(node, type) {
  if (Array.isArray(node)) return node.flatMap((child) => descendants(child, type));
  if (!node || typeof node !== "object") return [];
  return [...(node.type === type ? [node] : []), ...descendants(node.props?.children, type)];
}

test("public care imagery exists and stays lightweight", async () => {
  for (const relativePath of publicImages) {
    const details = await stat(path.join(root, relativePath));
    assert.ok(details.isFile(), `${relativePath} should be a file`);
    assert.ok(details.size > 10_000, `${relativePath} should not be empty`);
    assert.ok(details.size < 250_000, `${relativePath} should stay below 250 KB`);
  }
});

test("homepage keeps a short patient-first sequence without duplicate sections", async () => {
  const page = await readFile(path.join(root, "src/app/page.tsx"), "utf8");
  const appointment = await readFile(
    path.join(root, "src/components/home/AppointmentCTA.tsx"),
    "utf8",
  );

  const main = page.match(/<main\b[^>]*>([\s\S]*?)<\/main>/u)?.[1];
  assert.ok(main, "the homepage must retain its main landmark");
  assert.deepEqual([...main.matchAll(/<([A-Z]\w*)\s*\/>/gu)].map((match) => match[1]), [
    "Hero", "CareOptions", "Doctors", "AppointmentCTA", "VisitGuide", "FrequentlyAskedQuestions", "Contact",
  ]);
  assert.doesNotMatch(page, /<(?:Services|GeneralCare|CarePathways|WhyChooseUs|PatientJourney|Gallery|PremiumMotion)\b/u);
  assert.match(page, /className="patient-home"/u);
  assert.match(page, /import "\.\/patient-home\.css"/u);

  const sources = await Promise.all(["CareOptions", "Doctors", "AppointmentCTA", "VisitGuide", "FrequentlyAskedQuestions", "Contact"].map(
    (name) => readFile(path.join(root, `src/components/home/${name}.tsx`), "utf8"),
  ));
  for (const anchor of ["services", "care", "general-care", "doctors", "appointment", "appointment-pediatrics", "appointment-obg", "journey", "clinic", "contact"]) {
    assert.ok(sources.some((source) => source.includes(`id="${anchor}"`)), `legacy #${anchor} links must resolve`);
  }
  assert.match(sources.join("\n"), /For emergencies|For urgent or emergency|emergency services/u);
  assert.match(appointment, /CARE_SELECTION_EVENT/u);
});

test("three visible care choices preserve specialist booking and general-care phone routing", async () => {
  const CareOptions = await loadPublicComponent("src/components/home/CareOptions.tsx");
  const tree = CareOptions();
  const cards = descendants(tree, "article");
  assert.equal(cards.length, 3);
  assert.deepEqual(descendants(tree, "CareBookingLink").map((link) => link.props.doctorId), ["pediatrics", "obg"]);
  const generalCare = cards.find((card) => card.props.id === "general-care");
  assert.ok(generalCare);
  assert.equal(descendants(generalCare, "CareBookingLink").length, 0, "general care must not select a specialist slot");
  assert.deepEqual(descendants(generalCare, "a").map((link) => link.props.href), [clinicVisit.phoneHref, GENERAL_CARE_HREF]);
  for (const href of ["/care/pediatrics", "/care/womens-health", GENERAL_CARE_HREF]) {
    assert.ok(descendants(tree, "a").some((link) => link.props.href === href));
  }
  for (const link of descendants(tree, "a")) assert.equal(link.props.onClick, undefined, "care detail and phone links must stay native");
});

test("doctor cards pair the correct clinician, hours and booking selection", async () => {
  const Doctors = await loadPublicComponent("src/components/home/Doctors.tsx");
  const cards = descendants(Doctors(), "article");
  assert.equal(cards.length, 2);
  for (const [index, id, name, hours] of [
    [0, "pediatrics", "Dr. Lt Col Shafi Ahamad", "5:00 PM–8:00 PM"],
    [1, "obg", "Dr. Shaik Reshma", "7:00 PM–9:00 PM"],
  ]) {
    const card = cards[index];
    assert.deepEqual(descendants(card, "CareBookingLink").map((link) => link.props.doctorId), [id]);
    assert.ok(JSON.stringify(card).includes(name));
    assert.ok(JSON.stringify(card).includes(hours));
  }
  for (const component of ["Hero", "MobileCareBar"]) {
    const PublicSurface = await loadPublicComponent(`src/components/home/${component}.tsx`);
    const callLinks = descendants(PublicSurface(), "a").filter((link) => link.props.href === clinicVisit.phoneHref);
    assert.equal(callLinks.length, 1, `${component} must retain the clinic call action`);
    assert.equal(callLinks[0].props.onClick, undefined, "calling the clinic must remain native");
  }
});

test("the public service worker precaches available real-doctor assets without old concept imagery", async () => {
  const worker = await readFile(path.join(root, "public/sw.js"), "utf8");
  const handlers = new Map();
  const cacheNames = [];
  const precached = [];
  let installation;
  vm.runInNewContext(worker, {
    self: {
      addEventListener: (name, callback) => handlers.set(name, callback),
      skipWaiting() {},
    },
    caches: {
      async open(name) {
        cacheNames.push(name);
        return { async addAll(assets) { precached.push(...assets); } };
      },
    },
  });
  assert.equal(typeof handlers.get("install"), "function");
  handlers.get("install")({ waitUntil: (promise) => { installation = promise; } });
  await installation;
  assert.equal(cacheNames.length, 1);
  assert.match(cacheNames[0], /^asher-public-/u);
  assert.match(cacheNames[0], /patient-makeover/u);
  assert.ok(precached.includes("/images/dr-shafi-ahamad.jpg"));
  assert.ok(precached.includes("/images/dr-shaik-reshma.jpg"));
  assert.equal(new Set(precached).size, precached.length);
  for (const asset of precached) {
    assert.match(asset, /^\//u);
    assert.doesNotMatch(asset, /^\/(?:admin|portal|api)(?:\/|$)|[?#]|asher-hero-clinic|asher-abstract-care/u);
    const localFile = asset === "/" ? "src/app/page.tsx" : `public${asset}`;
    assert.ok((await stat(path.join(root, localFile))).isFile(), `${asset} must exist for atomic precache installation`);
  }
});

test("specialist booking links preselect in place and preserve doctor-specific native fragment fallbacks", async () => {
  for (const doctorId of ["pediatrics", "obg"]) {
    for (const reduceMotion of [false, true]) {
      const events = [];
      const scrolls = [];
      const focus = [];
      let prevented = false;
      let targetPresent = true;
      const appointment = {
        scrollIntoView: (options) => scrolls.push(options),
        querySelector: (selector) => {
          assert.equal(selector, 'select[name="doctor"]');
          return { focus: (options) => focus.push(options) };
        },
      };
      const CareBookingLink = await loadPublicComponent("src/components/home/CareBookingLink.tsx", {
        document: { getElementById: (id) => { assert.equal(id, "appointment"); return targetPresent ? appointment : null; } },
        window: { dispatchEvent: (event) => events.push(event), matchMedia: () => ({ matches: reduceMotion }) },
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
      });
      const link = CareBookingLink({ doctorId, children: "Book consultation" });
      assert.equal(link.type, "a");
      assert.equal(link.props.href, `#appointment-${doctorId}`);
      const click = (overrides = {}) => link.props.onClick({
        button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
        preventDefault() { prevented = true; }, ...overrides,
      });
      for (const modified of [{ button: 1 }, { metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }]) click(modified);
      assert.equal(events.length, 0);
      assert.equal(prevented, false, "modified clicks retain ordinary browser navigation");
      assert.equal(link.props.href, `#appointment-${doctorId}`, "new tabs retain the selected doctor without a query string");
      targetPresent = false;
      click();
      assert.equal(events.length, 0);
      assert.equal(prevented, false, "missing booking target must retain the native link");
      targetPresent = true;
      click();
      assert.equal(events.length, 1);
      assert.equal(events[0].type, "asher:select-care");
      assert.deepEqual(Object.keys(events[0].detail), ["doctorId"]);
      assert.equal(events[0].detail.doctorId, doctorId);
      assert.equal(link.props.href, `#appointment-${doctorId}`, "in-place enhancement must not remove the native fallback");
      assert.equal(scrolls[0].behavior, reduceMotion ? "auto" : "smooth");
      assert.equal(focus[0].preventScroll, true);
    }
  }
  const source = await readFile(path.join(root, "src/components/home/CareBookingLink.tsx"), "utf8");
  assert.doesNotMatch(source, /searchParams|pushState|replaceState|localStorage|sessionStorage|fetch\(|sendBeacon|gtag|dataLayer/u);
});

test("visit preparation stays three steps and returning patients keep a native portal link", async () => {
  const VisitGuide = await loadPublicComponent("src/components/home/VisitGuide.tsx");
  const tree = VisitGuide();
  const steps = descendants(tree, "ol");
  assert.equal(steps.length, 1);
  assert.equal(descendants(steps[0], "li").length, 3);
  const portal = descendants(tree, "a").filter((link) => link.props.href === "/portal/login");
  assert.equal(portal.length, 1);
  assert.equal(portal[0].props.onClick, undefined);
});

test("the interactive Google map loads only after explicit choice while directions stay native", async () => {
  let initialized = false;
  let showMap;
  const ClinicMap = await loadPublicComponent("src/components/home/ClinicMap.tsx", {}, {
    react: {
      useState(initial) {
        if (!initialized) {
          assert.equal(initial, false, "the map must be off by default");
          showMap = initial;
          initialized = true;
        }
        return [showMap, (next) => { showMap = next; }];
      },
    },
  });
  const initial = ClinicMap();
  assert.equal(descendants(initial, "iframe").length, 0, "an offscreen or lazy iframe still exposes a premature third-party request");
  assert.equal(descendants(initial, "img").length, 0);
  assert.equal(descendants(initial, "script").length, 0);
  const buttons = descendants(initial, "button");
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].props.type, "button");
  assert.equal(buttons[0].props.children, "Show interactive map");
  buttons[0].props.onClick();
  const selected = ClinicMap();
  const frames = descendants(selected, "iframe");
  assert.equal(frames.length, 1);
  assert.equal(frames[0].props.title, "Asher Women and Child Healthcare location");
  assert.equal(frames[0].props.referrerPolicy, "no-referrer");
  assert.equal(frames[0].props.loading, "lazy");
  const embedUrl = new URL(frames[0].props.src);
  assert.equal(embedUrl.origin, "https://www.google.com");
  assert.equal(embedUrl.pathname, "/maps");
  assert.equal(embedUrl.searchParams.get("output"), "embed");
  for (const tree of [initial, selected]) {
    const links = descendants(tree, "a");
    assert.equal(links.length, 1);
    assert.equal(links[0].props.href, clinicVisit.directionsHref);
    assert.equal(links[0].props.onClick, undefined);
    assert.equal(links[0].props.rel, "noreferrer");
  }
  const contact = await readFile(path.join(root, "src/components/home/Contact.tsx"), "utf8");
  assert.match(contact, /<ClinicMap \/>/u);
  assert.doesNotMatch(contact, /<iframe|www\.google\.com/u);
  const mapSource = await readFile(path.join(root, "src/components/home/ClinicMap.tsx"), "utf8");
  assert.doesNotMatch(mapSource, /fetch\(|sendBeacon|localStorage|sessionStorage|location\.|createElement|useEffect|setTimeout/u);
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

  assert.match(hero, /Specialist evenings · Usually Mon–Sat/u);
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
  assert.match(home, /<Hero \/>\s+<CareOptions \/>\s+<Doctors \/>/u);
  const careOptions = await readFile(path.join(root, "src/components/home/CareOptions.tsx"), "utf8");
  assert.match(careOptions, /href="\/care\/general-care-lab-tests"/u);
  assert.match(careOptions, /id="general-care"/u);
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
  const careBookingLink = await readFile(path.join(root, "src/components/home/CareBookingLink.tsx"), "utf8");
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
  assert.doesNotMatch(careBookingLink, /history\.replaceState|searchParams\.set\("care"/u);
  assert.match(careBookingLink, /new CustomEvent\(CARE_SELECTION_EVENT/u);
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
    "src/components/home/Hero.tsx",
    "src/components/home/CareOptions.tsx",
    "src/components/home/CareBookingLink.tsx",
    "src/components/home/Doctors.tsx",
    "src/components/home/VisitGuide.tsx",
    "src/components/home/ClinicMap.tsx",
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
