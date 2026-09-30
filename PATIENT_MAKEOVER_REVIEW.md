# Patient-first public website — review build

Prepared and verified locally 30 September 2026. **Cloudflare preview publication authorized; production promotion is pending.**

Baseline: GitHub `asherpharma/asher-healthcare`, main commit `9203633455e73d827e2d63d69cc7ef1975f9bb4c` (cookie-free homepage totals release). The separate, older working checkout and its uncommitted changes were left untouched.

## What the review found

- The old homepage repeated service, care-pathway and journey information across eleven sections. The booking form appeared after several large promotional sections.
- Doctor booking links did not select their doctor, so a person choosing Dr. Reshma could arrive at a form still selecting Pediatrics.
- Automatic WhatsApp navigation after booking could hide the on-site result and included patient information in an external URL.
- Small-screen navigation could leave a blank top strip and clip menu links in landscape mode.
- The map loaded a third-party embed as visitors scrolled, even if they did not need it.

## Implemented version

The homepage now follows seven sections: introduction → care choices → doctors → booking → visit preparation → questions → contact.

- Warm ivory, deep green and soft rose styling; real, existing doctor portraits replace the conceptual clinic hero.
- Three care choices: Pediatrics, Women's Health, and General Care & Tests. General care remains call-assisted; it does not incorrectly use specialist slots.
- Removed the repeated services/pathways, promotional journey, conceptual gallery and decorative motion controller from the rendered homepage. Unused legacy component files remain available in source; clinical detail pages remain accessible.
- Doctor-specific booking links select the correct specialist. Private URL fragments preserve that selection when opened in another tab; no new care query-string or browser-storage tracking was added.
- Doctor/date/time selection comes before patient details. In-flight duplicate submissions are blocked.
- Success and failure feedback receives keyboard focus and is immediately visible. Successful reservations show doctor/date/time and correctly say that clinic confirmation is still pending.
- WhatsApp help is optional and contains no patient details. Booking no longer opens or redirects to another app automatically.
- Phone-sized navigation has reachable, scrollable menus and persistent Call, Directions and Book actions.
- Practical preparation instructions and a clear family-portal entry replace repeated promotion.
- Google Maps is opt-in. Directions remain a normal link before and after map loading.
- Public app cache release updated to the real portrait assets. Staff and patient-portal service workers were not changed.

## Preserved

- Live clinic-controlled schedules, 15-minute slot generation, occupancy checks, server booking API, anti-spam fields and booking consent.
- Usual hours: Dr. Shafi, Monday–Saturday 5–8 PM; Dr. Reshma, Monday–Saturday 7–9 PM. The form remains authoritative for current availability.
- Clinical content and general-care service boundaries; no invented reviews, qualifications, clinic photographs or service claims.
- Cookie-free aggregate homepage measurement and native phone/directions links.
- Staff access, records, billing, manual payments, reports and Android notification delivery code.
- No Firebase rules, live records, credentials, email settings, payment settings or Cloudflare settings were changed.

## Verification

- Production static-export build: passed, 29 generated pages. TypeScript passed as part of the build.
- Full lint check: passed, no errors or warnings.
- Unit suite: 410 passed.
- Booking-experience suite: 8 passed.
- Booking-alert suite: 87 passed.
- Total automated regression tests: **505 passed, zero failures or skips**.
- Isolated Chromium visual/interaction checks: **28 passed**. Widths: 1440, 1024, 844 (landscape), 768, 390, 360 and 320 pixels; no horizontal overflow.
- Tested actual rendered doctor selection, new-tab specialist fragments, menu reachability, reduced motion, image loading, opt-in map state, visible/focused reservation confirmation, and retained care/login/policy routes.
- A local mocked booking response was used for browser testing. No live appointment, patient, payment or notification was created.
- The exported public service worker was checked against the new source version.

Screenshots and machine-readable browser results are in the sibling `../evidence` directory. `../preview-check.cjs` contains the local-only visual test runner.

## Boundaries and release steps

These checks are not a claim that every live service or every physical phone has been tested. The browser connector to the user's open tabs timed out; an isolated local Chrome session was used instead. Remote map rendering was deliberately blocked during local QA. New styling has not yet been checked on a physical Android phone or Safari.

Before release: review the visual preview, confirm the GitHub baseline is still current, create an authorized Cloudflare preview with the existing notification-compatible build configuration, then smoke-test the preview against its configured services. Production promotion requires separate approval. Keep email delivery paused and leave staff notification configuration intact.

The next worthwhile improvement is a measured usability check with a patient and receptionist on real phones—not another batch of decorative features. Verify that they can choose care, reserve a slot, find the clinic and open existing reports without assistance; prioritize any observed friction over additional homepage sections.
