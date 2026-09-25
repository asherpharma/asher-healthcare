# Android appointment alerts — email paused

Status: local implementation; preview runtime prepared. Not published or activated. Do not describe
notifications as working until a controlled server-to-phone test succeeds.

## Scope

The user deferred email setup on 2026-09-25. Android Web Push uses the existing
Cloudflare Pages backend and installed staff web app/Chrome. This path does not
call Resend, use Google Secret Manager, or deploy Firebase Functions.
The optional `notification-functions/` prototype is dormant and is deliberately
not registered in `firebase.json`; never activate both senders together.

- Only new public website requests from the production domain, in Firebase
  project `asher-healthcare-clinic`, after activation are eligible. Preview,
  QA, historical, reception and updated bookings do not send alerts.
- Booking and its server-only push outbox entry are committed together when
  active. Delivery runs after that commit, outside the booking response. Failed
  push delivery does not cancel or duplicate an appointment.
- Only an authenticated active administrator can enroll a personal device,
  review generic delivery status, or retry an alert. Staff access and device
  opt-in are checked again before delivery.
- Payloads contain a generic event and opaque booking ID, never a patient name,
  phone, doctor, date, reason or medical information. The service worker displays
  fixed generic text and opens the same-origin secure appointment desk. Patient
  details still require login. Generic alerts may arrive while signed out;
  disable alerts before sharing the phone. Accepted push cannot be recalled.
- Browser Firestore clients cannot access registrations, outbox or delivery
  ledgers. Existing default-deny rules apply; no access expansion is needed.
  Recent status uses a single-field `createdAt` index.

## Reliability limits

This version makes a bounded, best-effort background attempt with Cloudflare
`waitUntil`. It is **not a durable queue** and has **no automatic retry
scheduler**. Interrupted/failed work remains recorded for an admin to refresh
and retry within the permitted window. The sender reserves time to save
incomplete status. Locks and per-device accepted-send records reduce duplicates,
but provider acceptance followed by persistence failure is still ambiguous;
do not promise exactly-once delivery.

The panel checks the latest 20 outbox entries, not all-time totals. An empty
problems list is not proof that every phone displayed an alert. Provider
acceptance is not a delivery/read receipt. Android/Chrome permissions, battery
restrictions, connectivity and provider availability affect display. Keep using
the appointment desk as the authoritative source.

## Deployment setup

1. Verify tests, TypeScript, lint, production build and Cloudflare runtime
   compatibility. Preview notifications must remain inactive.
2. Cloudflare compatibility date was `2026-07-24` when read on 2026-09-25.
   The pinned `web-push@3.6.7` transport generates encrypted requests then uses
   native `fetch`; it requires `nodejs_compat`. Test that flag on preview first,
   then production. Preserve all existing Firebase/payment bindings. Do not
   introduce broad Wrangler configuration that overwrites dashboard settings.
   On 2026-09-25 the user approved preview-only compatibility. `nodejs_compat`
   was saved using **Save version**, without starting a deployment. The saved
   preview flag and cleared unsaved-changes indicator were visually verified.
   Production runtime settings, enable flags and secrets remain unchanged.
3. Create one matching VAPID key pair through an approved secure process. Store
   the private key only as a Cloudflare **Secret**, never in Git, public
   variables, browser local storage, screenshots or chat. Rotation requires
   device re-enrollment; do not casually replace an existing pair.
4. Configure the following production-only server variables. Keep both enable
   flags off on preview. Start production disabled until reviewed publication.

   | Variable | Purpose |
   | --- | --- |
   | `BOOKING_ALERTS_ENABLED` | `false` until deliberate activation, then `true` |
   | `BOOKING_ALERT_PUSH_CONFIGURED` | `true` only with verified sender/key setup |
   | `BOOKING_ALERTS_ACTIVATED_AT` | Fresh exact UTC timestamp; never backdate to replay old records |
   | `BOOKING_ALERT_VAPID_PUBLIC_KEY` | Matching public Web Push key |
   | `BOOKING_ALERT_VAPID_PRIVATE_KEY` | Matching private key stored as Secret |

   Never use `NEXT_PUBLIC_` for a signing secret. Email status is paused even if
   an old email configuration variable exists. No extra sending service or new
   paid plan is required by this architecture; existing hosting/database usage
   charges can still apply.
5. After approved production activation, the administrator opens
   `https://asherhealthcare.in/admin/settings#booking-alerts` in Android Chrome
   or the installed staff app, taps **Enable booking notifications**, then
   personally allows notifications. Deployment/installation does not grant
   device permission automatically.
6. **Check phone display** tests local rendering only, not delivery. With
   separate approval for one clearly identified test booking, close the app,
   submit the test, confirm receipt on the phone, tap the alert, verify secure
   login/appointment opening and inspect delivery status. Verify the exact test
   record and slot before any authorized cleanup.

## Email retained for later

Resend domain `notify.asherhealthcare.in` and its three DNS records were visually
verified on 2026-09-25. Existing website/mail records were preserved. The agent
did not submit the prepared sending-key form; storage of an email API key is
not confirmed. No email has been sent. Do not resume billing, identity
verification or email activation during this Android-only task.
`BOOKING-ALERTS-SETUP.md` describes the earlier, paused combined design.

## Validation and release record

After the Android pivot (2026-09-25): 370 existing unit tests and 83 booking-alert
tests passed. TypeScript, full lint (zero errors; one warning in an ignored local
simulator fixture) and webpack production build (28 pages) passed locally.
The updated focused Firestore rules test passed 48 get/set
denials, including the new outbox and device ledgers; the exact local emulator
was stopped. The full 46-rule-test suite passed before the pivot. Storage-rule
emulator checks and Node 22 CI remain pending.
No live test booking, push, preview publication or production activation has
occurred.

The actual workerd simulator passed a synthetic transport smoke with
`nodejs_compat`, date `2026-07-24`: binary request integrity, Web Crypto
verification of the generated VAPID signatures, successful acceptance and
rejection of 301/302/303/307/308/410/429/503 responses. Actual outbound push
requests: zero. This caught and fixed a real runtime incompatibility:
workerd rejects `redirect: error`, so the transport now uses `manual` and
explicitly rejects every non-2xx response. Authorization is never forwarded
to redirect destinations. The simulator was stopped by the test's finally block.
This does not replace a real closed-app phone delivery test.

Dependency audit: no pre-existing package versions changed with the pinned
Web Push addition. The root audit reports 11 pre-existing production findings
(one critical, seven high, three moderate), none in the newly added Web Push
dependency closure. Do not claim a clean root audit. Their applicability to
static-export Cloudflare hosting is under review; no unrelated upgrade has
been bundled into this feature.

Initial applicability check: `next.config.ts` exports static pages with image
optimization disabled. The two critical Next advisories concern a
[Windows-hosted Next server](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36)
and [AVIF image optimization](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4).
Those runtime surfaces are absent from this Cloudflare static deployment
(an inference from the code/hosting configuration, not a claim that every
audit finding is harmless). Do not expose the unpatched Windows development
server publicly. Remaining baseline findings still need separate triage.

Rollback: disable Cloudflare `BOOKING_ALERTS_ENABLED` and redeploy if required
for changed variables to apply. Existing appointments remain untouched.
Authenticated owners can unsubscribe while globally paused. Before reactivation,
review unfinished deliveries and choose a fresh timestamp; never silently
replay historical appointments. Keep the optional Firebase function disabled.
