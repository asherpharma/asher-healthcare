# Usability flow v9

## Scope

- Public doctor/service links preserve the intended specialist.
- Booking shows tappable time slots, a selection review, and an on-site confirmation. The optional WhatsApp link contains no patient details.
- Next clinic-day navigation is bounded to 14 days. It checks occupancy for the selected date only; it does not promise a free slot before that check completes.
- Staff and family sign-in use a compact shared layout, password visibility control, and a separate reset form. Installation/access guidance is below the primary task.
- Navy branding is retained; teal and rose accents meet 4.5:1 contrast against white. Mobile booking starts with the form.
- Patient overview no longer starts eight record subscriptions. Each clinical tab loads its own section; Timeline loads all sections permitted for the current role.
- Loading, verified empty, and error states are distinct. Unverified counts are not displayed as zero.
- Today opens the exact appointment. Follow-up and Reminder actions retain the verified patient without exposing identifiers in URLs or persistent browser storage.
- Rapid handoff requests ignore stale responses. Reminder actions stay unavailable until the linked patient is verified.
- Appointment reminders explicitly use the existing descending date index. This corrects the live Reminder desk loading error without changing indexes or permissions.

## Unchanged safeguards

Email/password authentication, clinic-approved family access, role permissions, network-only private records, atomic server booking, manual payment collection, and the existing doctor schedules remain in place. This release changes no Firestore rules, indexes, billing configuration, or authentication providers.

## Verification and promotion

Run the complete unit suite, ESLint, and a production build. Check public booking and both login pages at 320px and 390px phone widths and a desktop width. Do not submit a real booking, reset email, payment, or reminder during a read-only smoke check.

Before production promotion, an authenticated clinic reviewer should verify Today → exact appointment, Patient → Follow-up, Patient → Remind, and patient switching across individual record tabs and Timeline. Live authenticated write flows require an approved disposable profile; passing code tests alone is not evidence that every production workflow has been exercised.

Local visual builds can use a non-production demo Firebase identifier. Only the Git source is pushed; Cloudflare rebuilds with the existing deployment configuration. Local generated `out` and `.next` directories must never be committed or uploaded as a production release.

## Signed-in preview checks — 11 September 2026

- Patient directory, overview, visit history and all eight Timeline sections loaded successfully. Repeatedly tapping the active Visits tab kept its verified empty state ready.
- Patient → Follow-up opened a form with the correct verified patient and no identity in the URL. The form was cancelled without saving.
- Patient → Remind preserved the correct patient filter. This check exposed the appointment date-query/index mismatch addressed by the regression fix above; the corrected preview must be checked again after deployment.
- No patient, appointment, task, reminder, payment or clinical record was created, edited or deleted by these checks.
- Exact Today → appointment navigation and switching between two distinct active patients could not be exercised with the available live records. They remain covered by automated tests, not by a live multi-patient smoke check. Saving tasks, sending reminders and non-admin role sessions were not exercised.
