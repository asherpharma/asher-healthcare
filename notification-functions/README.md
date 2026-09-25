# Appointment alerts (server only)

## Paused implementation — do not deploy

As of 2026-09-25, the user has deferred email setup. This experimental combined
email/Firebase Functions implementation is retained for later review but is not
registered in `firebase.json` and is not the active Android delivery path.
Do not enable it alongside the Cloudflare sender: doing so could duplicate alerts.
The current Android-only release and setup are documented in
`../BOOKING-ALERTS-SETUP.md`. The configuration below describes this dormant
implementation, not requirements for Android alerts.

This optional Firebase Functions v2 codebase sends a generic email to
`asherhealthcare100@gmail.com` and Web Push to enrolled active administrators.
It is disabled by default. Website deployment alone does not activate it.
No provider requests or real appointment records are used by unit tests.

## Deliberate limits

- Only newly created `appointments/{appointmentId}` documents with `source:
  website`, `createdBy: public-website`, `status: requested`, and server-stamped
  production `requestOrigin` (`https://asherhealthcare.in` or its `https://www.asherhealthcare.in`
  alias) are eligible. Admin device enrollment and all links use the canonical root origin.
- The Firebase project must be `asher-healthcare-clinic`. Preview origins, QA,
  missing origin, and documents created before activation never send alerts.
- Date gating uses the Firestore document create time, not a patient-supplied
  field. Existing bookings, updates, cancellations and reception bookings do not
  trigger notifications. The existing booking transaction is not changed here.
- Email and push contain no patient name, telephone, reason, doctor, appointment
  date or medical details. Email links to the fixed production appointment desk.
  Push contains only `{type: "appointment-request", appointmentId}`; the service
  worker renders fixed generic text and opens `/admin/appointments` after login.
- Staff access and device opt-in are re-read before every push attempt. A role
  revocation blocks subsequent attempts. An already accepted notification cannot
  be recalled. No patient data is exposed on the lock screen.
- Successful provider acceptance is not proof of inbox delivery, reading, device
  display or appointment confirmation. Browser/Android permissions, battery
  settings, connectivity and provider availability affect actual delivery.

## Configuration (deployment operator)

Use Firebase Secret Manager for the two secrets; never put them in the website,
Git, browser storage, screenshots, chat, or plaintext environment examples.

| Setting | Value / purpose |
| --- | --- |
| `ALERTS_ENABLED` | `false` until controlled production activation |
| `ALERTS_ACTIVATED_AT` | Exact activation time in UTC, e.g. `YYYY-MM-DDTHH:mm:ssZ`; empty blocks all sends |
| `ALERTS_REGION` | `asia-south1` default; choose deliberately to suit Firestore location |
| `ALERTS_ORIGIN` | Must be `https://asherhealthcare.in` |
| `ALERTS_EMAIL_TO` | Must be `asherhealthcare100@gmail.com`; changing recipient needs reviewed code authorization |
| `ALERTS_EMAIL_FROM` | Plain email address on the verified Resend sending domain, no display-name markup |
| `ALERTS_VAPID_PUBLIC_KEY` | VAPID public key matching the registration API's public key |
| `ALERTS_RESEND_API_KEY` | Secret Manager secret; preferably sending-only and scoped to the verified domain |
| `ALERTS_VAPID_PRIVATE_KEY` | Secret Manager secret paired with the public key |

The root Firebase configuration uses source `notification-functions`, codebase
`booking-alerts`, Node 22. Dependencies are pinned to registry-verified versions:
Firebase Functions 7.4.0, Admin 14.5.0 and web-push 3.6.7. No FCM client SDK or
new Firestore composite index is required. The existing client-deny fallback
must protect `adminPushDevices` and `appointmentAlerts`, including subcollections.

Registration API configuration is separate: `BOOKING_ALERT_PUSH_CONFIGURED=true`
and its matching VAPID public key should only advertise readiness after backend
setup is verified. Do not enable that flag just because this source exists.

Suggested rollout order:

1. Run the pure unit tests and existing application/rules tests. Test the UI on
   preview without provider credentials or active sending.
2. Verify domain ownership/sender in Resend and configure its restricted API key.
   A free plan/quota is not an unlimited or guaranteed email service.
3. Generate a VAPID pair securely; store the private key only as a bound secret.
   Keep the pair stable. Rotation requires re-enrolling affected browser devices.
4. Deploy this codebase disabled, confirming the exact production Firebase project
   and any required Cloud Functions/Eventarc billing permissions. Do not grant
   broader IAM access automatically. Cloud Functions usage may be billable.
5. Set a fresh UTC activation cutoff and enable the worker, then advertise API
   readiness. Re-enable after a pause only with a new cutoff if old events must
   not send. No old data backfill is part of this feature.
6. The administrator signs in on their own Android phone and explicitly enables
   notifications in the app. Permission cannot be granted remotely.
7. With approval, submit one clearly identified test booking and check provider
   acceptance, email inbox/spam, Android notification and secure tap destination.
   Do not claim end-to-end delivery until these checks pass.

## Retries, privacy and operational attention

Firestore triggers are at-least-once, not exactly-once. The worker keeps
`appointmentAlerts/{id}` summaries and independent `channels/email` and
`devices/{deviceId}` ledgers. Each attempt claims a two-minute transactional
lease, retries with exponential backoff (one minute up to one hour), and stops
after 12 attempts or before 20 hours from document creation. The Firebase event
retry flag handles scheduling; there is no public retry endpoint.

Resend's fixed idempotency key is `asher-appointment-v1-{appointmentId}` and the
email body is immutable. The retry cutoff is deliberately shorter than Resend's
24-hour key retention. A changed email payload/configuration fails closed for
that alert. Network acknowledgement loss is retried with the same key. Do not
reset a completed/expired ledger or manually replay it after 24 hours: verify
provider status first to avoid a duplicate email.

Web Push cannot guarantee exactly-once display. A stable collapse topic and
notification tag reduce duplicates, but crashes between provider acceptance and
ledger persistence can still cause repeated notifications. A 404/410 disables
only the unchanged subscription; renewed subscriptions are not disabled by a
stale response. Revoked/non-admin/opted-out devices are skipped.

Device fanout snapshots the first 100 active devices by document ID. If more
exist, the summary explicitly reports `device_limit_exceeded` / `needs_attention`
and does not silently claim full delivery. Other permanent failures also reach
`needs_attention`. Check these server-only records/logs operationally; this
release does not include a separate alert-health dashboard or automatic paging.
No raw provider bodies, endpoints, encryption keys, email credentials, patient
payloads or device subscriptions are copied into logs/delivery ledgers.

All device and alert records are server-owned. Apply an approved retention policy
separately; no broad deletion/TTL policy or cleanup of real data is introduced.
Failure to send an alert never rolls back or removes the successful booking.

## Dependency audit hold resolved (25 September 2026)

The prior two moderate findings came through
`firebase-admin 14.5.0 -> @google-cloud/storage 8.2.0 -> gaxios 6.7.1 -> uuid 9.0.1`.
The upstream [GHSA-w5hq-g745-h8pq advisory](https://github.com/uuidjs/uuid/security/advisories/GHSA-w5hq-g745-h8pq)
identifies buffered v3/v5/v6 APIs as affected and 11.1.1 as a patched release.
No newer compatible gaxios 6.x update was available, and normal audit-fix dry-run
proposed no changes.

A reviewed override now changes **only gaxios 6.7.1's UUID dependency to exact
11.1.1**. This deliberately exceeds its declared `^9.0.1` child range; it is not
a blanket UUID override or a forced SDK upgrade. All 271 other lockfile package
entries retained identical versions/integrity values. The application root
lockfile and the worker's pinned SDK/Web Push versions were not changed.

Compatibility evidence:

- [UUID 11.1.1 package exports](https://github.com/uuidjs/uuid/blob/v11.1.1/package.json)
  retain a Node CommonJS entry. Tests resolve UUID from gaxios's actual module
  context and confirm the patched version and CommonJS export path.
- [gaxios 6.7.1](https://github.com/googleapis/gaxios/blob/v6.7.1/src/gaxios.ts)
  calls only no-argument `uuid.v4()` for multipart boundaries. Its real multipart
  adapter path is exercised with synthetic data entirely in memory; header/body
  boundary agreement, v4 format and distinct values pass. Network fallback is
  explicitly blocked in the test.
- Regression tests confirm v3/v5/v6 reject undersized buffers without partial
  writes. These APIs are not used by this worker, but the tests verify that the
  patched dependency—not just an audit suppression—is installed.

`npm audit --omit=dev` reports **zero vulnerabilities** in this codebase. The
22 tests (18 delivery + 4 dependency compatibility), source syntax checks and
Firebase v2 SDK import passed locally on Node 24.19.0. Deployment targets Node
22; CI must run its clean install/import and dependency tests on that runtime.
`npm test` runs both test groups; `npm run test:dependencies` runs the four
compatibility checks alone.

Remove the override only after upstream gaxios/storage adopts a patched UUID
dependency or no longer needs it, with the same audit/compatibility checks. Do
not expand this override to unrelated dependency versions. The dependency audit
hold is resolved; provider configuration, deployment and supervised delivery
validation remain separate activation prerequisites. No real email/push,
booking creation or production change was performed by these dependency checks.

References: [Firestore triggers](https://firebase.google.com/docs/functions/firestore-events),
[Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys),
[Web Push library](https://github.com/web-push-libs/web-push).
