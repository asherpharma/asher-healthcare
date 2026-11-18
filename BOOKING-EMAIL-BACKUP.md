# Website booking email backup

Status: prepared and tested with synthetic records; not activated on the live
site. No test or patient emails have been sent. The Android alert configuration
is unchanged. Do not deploy the dormant Firebase notification prototype.

## What staff receive

Each successful new website booking saves a request and reserves the slot. Once
enabled, it also saves a server-only email job in the same database transaction.
A background attempt is made right away. If it is interrupted or a retry
is needed, a separate scheduled Worker checks the saved jobs every five
minutes. The booking response does not wait for either email or Android push.
Preview, QA, reception, declined form submissions and slot conflicts never
send an alert. Activation does not send for old bookings.

The only email destination is `asherhealthcare100@gmail.com`; the sender is
`booking-alerts@notify.asherhealthcare.in`. The subject is generic. The body
includes the patient’s name, booking mobile number, assigned doctor and
appointment date/time in India time, plus a link to the signed-in appointments
desk. The request is not itself staff confirmation. No reason for visit,
clinical notes, reports, attachments or patient IDs are sent. Push text stays
generic. Staff can always use **Appointments → New requests** as the source of truth.

The email status panel reports the latest 20 email jobs separately from
Android. “Accepted by email service” is not proof the message came to the
inbox. Transient provider failures retry with the same key for less than
20 hours; permanent failures or changes to a previously attempted message
are held for staff attention. The queue stores the appointment reference and
delivery status, not a copy of the patient details or email body. The existing
Firestore deny-by-default rule protects it against browser access.

## Before setting up production

1. Confirm the clinic permits this limited identifiable booking data to be
   processed by both Resend and the clinic Gmail account. Restrict the mailbox
   to authorised clinic staff, enable multi-factor sign-in, check forwarding
   and delegated access, hide Gmail message previews on phone lock screens,
   and agree on retention. Resend’s published security
   information says its standard plans retain email/log data for 30 days and
   that data is stored in the US. The sending region alone does not change
   that. Check the clinic's obligations and provider terms before enabling
   detailed email. If this setup is not suitable, keep patient identifiers
   in the signed-in clinic portal and use a link-only alert instead.
2. Recheck `notify.asherhealthcare.in` in Resend. It was previously verified.
   Confirm outbound sender verification and both open and click tracking off.
   Preserve DNS, receiving email and existing records; no new paid plan is
   part of this change.
3. After release approval, stage the website with email off. Keep all new
   configuration production-only. Use a sending-only Resend key restricted to
   the verified domain, and a separate random 32-byte sweep secret. Paste keys
   only into encrypted Cloudflare secret fields; never into Git, chat, command
   logs, screenshots or public environment variables.

   | Cloudflare production setting | Value |
   | --- | --- |
   | `BOOKING_ALERT_EMAIL_ENABLED` | `false` until approved activation |
   | `BOOKING_ALERT_EMAIL_ACTIVATED_AT` | Fresh UTC ISO timestamp when enabling; never backdate |
   | `BOOKING_ALERT_RESEND_API_KEY` | Restricted sending key, as a Secret |
   | `BOOKING_ALERT_EMAIL_SWEEP_SECRET` | Random unpadded base64url key (43 characters), as a Secret |

4. Configure the separate [scheduler](booking-email-scheduler/README.md) with
   the same sweep secret. It has no public endpoint, no patient-data access,
   and no Firebase or Resend key. Use the production Pages function and
   existing service identity; no Firebase rules, indexes, or billing changes
   are required for setup. Check quotas before launch; existing usage may apply.
5. For an approved pre-activation test, leave `BOOKING_ALERT_EMAIL_ENABLED=false`.
   Set `BOOKING_ALERT_EMAIL_TEST_UNTIL` to a UTC ISO timestamp less than one
   hour ahead and apply the production configuration. While signed in as an
   active admin on the canonical live site, go to **Settings → Booking alerts
   → Send fictional test email**. No appointment, slot, push or retry job is
   created. The fixed subject is `[TEST] Asher Healthcare booking email — no appointment`.
   Repeat taps in this test window use one provider idempotency key. Remove the
   test window after the check; enabling real email disables this test action.
6. With explicit approval, verify the sender and actual clinic Gmail receipt
   using only fake booking details. Check both inbox/spam and signed-in
   appointment links. Verify the Pages runtime, the scheduled retry path and
   the staff delivery panel before relying on the channel. Do not replay a
   genuine old booking to test it.

To pause email, switch off only `BOOKING_ALERT_EMAIL_ENABLED`, apply the change
to production and stop the Worker trigger. Android and appointments remain
independent. Re-starting with a fresh activation time avoids sending stale jobs.

Provider references: [Resend security and retention](https://resend.com/security),
[domain and tracking setup](https://resend.com/docs/dashboard/domains/introduction),
[idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys),
[Cloudflare cron triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/).
