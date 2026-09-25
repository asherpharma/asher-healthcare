# Appointment email and Android admin notifications

> HISTORICAL / PAUSED DESIGN (2026-09-25): The user deferred email setup.
> Follow `ANDROID-BOOKING-ALERTS.md` for the current Cloudflare Android-only
> path. Do not deploy the Firebase function or resume Resend/billing setup.
> The instructions below are retained for later review, not active setup steps.

Status: implementation in an isolated working branch; NOT published or activated.

Local validation on 2026-09-24/25: 370 existing unit tests and 46 booking-alert tests passed, as did TypeScript, targeted lint, whitespace checks, worker SDK import/syntax checks, and the webpack production build (28 static pages). The initial Firestore emulator startup problem was traced to sandboxed Java entropy initialization; an isolated localhost-only run outside that sandbox passed all 46 Firestore rules tests, including notification-device/ledger denials. Storage rules and Node 22 CI checks remain pending. A narrow reviewed `gaxios@6.7.1 -> uuid@11.1.1` override resolved the worker's two moderate findings; the scoped audit now reports zero vulnerabilities, and 18 delivery plus four dependency compatibility tests pass. See `notification-functions/README.md`. Do not activate based on local checks alone.

Browser access recovered after repeated control timeouts and a session reset. Resend login and the Cloudflare clinic zone are now verified through the UI. Created the sending domain `notify.asherhealthcare.in` in Resend (Tokyo region, domain ID `dd556b07-08df-432d-ba22-2b26383067ca`). On 2026-09-25, after the user's action-time approval, saved and visually verified exactly three new DNS records: TXT `resend._domainkey.notify` with the public DKIM value shown in Resend, CNAME `rsend.notify` to `rsend-apne1.forge.rmta.net`, and CNAME `send.notify` to `send.forge.rmta.net`; both CNAMEs are DNS-only, all TTLs Auto. All four existing records (`@`, `www`, and two `secureserver` DKIM CNAMEs) were preserved. No optional root DMARC was added and receiving remains disabled. Submitted Resend's "I've already added the records" check; status was Pending / Looking for DNS records. No API key or other secret has been created or changed, and notifications remain inactive.

Latest verification observation (2026-09-25): Resend's domain and all three DNS records show **Verified**, with "Your domain is ready to send emails." Prepared (but did not submit) an API key named `Asher appointment alerts`, permission `Sending access`, restricted to `notify.asherhealthcare.in`. Handed the user the secure creation/storage step for `ALERTS_RESEND_API_KEY` in the production project's Secret Manager; saving is not yet confirmed. No key value is requested in chat. Delivery is not configured or tested yet.

User approved Resend and chose `asherhealthcare100@gmail.com` as the recipient, with Android for the administrator phone. No patient names, phone numbers, reasons, or clinical information are sent to Resend or placed in push payloads. Only a generic alert and a secure appointment-desk link are used.

## Scope

- New website appointment requests only; reception/phone/walk-in entries do not send alerts.
- The booking API still commits the reservation and appointment together, independently of alert delivery. One server-owned `requestOrigin` field is added for provenance.
- A separately deployed Firebase function reacts after a saved booking. Preview origins, old records, records before activation, wrong projects and malformed/legacy sources are rejected.
- Email goes to the fixed approved mailbox. Android subscriptions are accepted only from an authenticated active admin on the canonical production website.
- Phone text is generic even when logged out. The app requires a fresh staff login before displaying appointment details. Enable only on a personal admin device; disable before sharing it.
- Notification subscriptions and delivery ledgers remain inaccessible to browser Firestore clients under the existing default-deny rules. No rule expansion or index change is required.
- Provider acceptance is not proof of inbox/device delivery. Duplicate delivery is minimized, not guaranteed impossible. See `notification-functions/README.md` for bounded retries, leases and failure handling.

## Required one-time setup

1. Sign in/create the clinic Resend account (user completes terms/verification). Stay on the free plan unless separately approved.
2. Verify an owned sending subdomain, preferably `notify.asherhealthcare.in`. Use only exact DNS records issued by Resend; do not overwrite root-domain MX/SPF or existing mail records. Confirm domain-authorization DNS changes before applying.
3. The user creates a sending-only Resend API key restricted to this verified domain. Store it directly in Firebase Secret Manager as `ALERTS_RESEND_API_KEY`; never paste it in chat, commit it, or put it in a public variable.
4. Configure Web Push VAPID keys: private key in Secret Manager as `ALERTS_VAPID_PRIVATE_KEY`; matching public key in the worker parameter and Cloudflare server setting below. Keys are not generated or exposed by the UI.
5. Deploy the separate `booking-alerts` Firebase function codebase using the instructions in `notification-functions/README.md`. Start disabled. Confirm region, runtime permissions, trigger and secrets; use minimum needed access. Existing Firebase Blaze usage may apply; no new paid Resend plan is authorized.
6. Test the website code on a preview. It must say alerts are inactive and must never send from preview bookings, even if a preview uses the live Firebase project.
7. After reviewed publication to production, set worker activation timestamp to a current UTC time and enable the worker. Do not backdate it to replay old records.
8. Set matching Cloudflare production-only server variables; keep preview disabled:

   | Variable | Value |
   | --- | --- |
   | `BOOKING_ALERTS_ENABLED` | `true` only after worker deployment is verified |
   | `BOOKING_ALERT_EMAIL_CONFIGURED` | `true` only after sender and worker email configuration are verified |
   | `BOOKING_ALERT_PUSH_CONFIGURED` | `true` only after push worker configuration is verified |
   | `BOOKING_ALERT_VAPID_PUBLIC_KEY` | Matching public Web Push key; never the private key |

9. On the administrator's Android phone, open `https://asherhealthcare.in/admin/settings#booking-alerts` in Chrome or the installed staff app, tap **Enable booking notifications**, then **Allow**. Installation alone does not enable notifications.
10. The **Check phone display** button tests only local display, not the server pipeline. Complete one separately authorized, clearly identified test booking; verify email arrival, phone arrival with the app closed, secure link/login, correct admin restriction, and delivery-ledger outcomes. Confirm its exact record/slot before any cleanup. Do not silently create test bookings in production.

## Validation and release boundary

Run `npm run test:unit`, `npm run test:booking-alerts`, `npm run test:rules`, `npm run lint` and the production build. Install the worker's exact locked dependencies and run its syntax/import checks as well. CI includes the booking-alert tests.

No local build artifacts should be uploaded to Cloudflare. Apart from the separately approved sending-domain DNS setup documented above, no real alert, patient record, secret, account permission or production setting has been changed by this work. Publishing the frontend alone does not activate the backend.

Rollback: disable worker `ALERTS_ENABLED` and Cloudflare `BOOKING_ALERTS_ENABLED`; existing appointments remain untouched. The admin API still permits authenticated owners to unsubscribe while the feature is disabled. Before reactivation, review queued/needs-attention statuses and choose a fresh activation timestamp rather than silently replaying old requests.
