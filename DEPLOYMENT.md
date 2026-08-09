# Deploy Asher Healthcare

## Static website deployment

This project is configured for a static Next.js export, which makes it suitable for Cloudflare Pages.

1. In Cloudflare, open Workers & Pages and create a Pages project from asherpharma/asher-healthcare.
2. Use main as the production branch after merging the feature/homepage pull request.
3. Select Next.js (Static HTML Export).
4. Set the build command to npx next build.
5. Set the build output directory to out.
6. Deploy the preview first, review it, then promote the production branch.

## Connect asherhealthcare.in

For both asherhealthcare.in and www.asherhealthcare.in:

1. Add asherhealthcare.in as a Cloudflare zone.
2. Copy the two Cloudflare nameservers shown for the zone.
3. In GoDaddy, replace the domain's nameservers with those Cloudflare nameservers.
4. In Cloudflare Pages > Custom domains, add asherhealthcare.in first and follow the prompts.
5. Add www.asherhealthcare.in and configure the preferred-domain redirect after both domains are active.
6. Confirm that any existing email-related DNS records (MX, SPF, DKIM) are present in Cloudflare before relying on the new nameservers.

If nameservers must stay at GoDaddy, Cloudflare Pages can connect www with a CNAME to the Pages domain, but the root domain requires Cloudflare DNS.

## Firebase activation

1. Create a Firebase project owned by the clinic.
2. Enable Email/Password authentication.
3. Copy .env.example to .env.local and fill in the Firebase web configuration.
4. Deploy the default-deny firestore.rules and storage.rules before adding any patient data.
5. Add role-based security rules for admin, doctor, and reception users.
6. Do not store patient records until access controls, backups, and the clinic's privacy process are reviewed.

Never commit .env.local or clinic credentials to GitHub.

## Staff invitation email and sign-in

Staff invitations use Firebase Authentication's **Password reset** email as a one-time
set-password link. The clinic must not send or store temporary passwords.

1. In Firebase, open **Authentication -> Settings -> Authorized domains** and add
   `asherhealthcare.in`.
2. Open **Authentication -> Templates -> Password reset** and use wording similar to:

   - Subject: `Your Asher Staff access is ready`
   - Message: `Hello %DISPLAY_NAME%, you have been invited to Asher Staff. Your login
     email is %EMAIL%. Select %LINK% to create your password. Then open or install the
     staff app at https://asherhealthcare.in/admin/login. If you did not expect this
     invitation, contact the clinic administrator.`

3. Keep the invitation continuation and app link on
   `https://asherhealthcare.in/admin/login` so Firebase accepts the production domain.
4. Test a new invitation, a resent invitation, password creation, forgotten-password
   recovery, and installation from both Android Chrome and iPhone Safari before adding
   real staff accounts.

Phone OTP sign-in is **not enabled**. Production SMS verification requires Firebase's
Blaze pay-as-you-go plan and per-SMS billing, plus the Phone provider, India SMS region,
reCAPTCHA, and the authorized production domain. Do not enable or deploy OTP until the
clinic owner explicitly approves Blaze billing. Email-and-password remains the supported
staff login method in the meantime.

## Razorpay secure payment setup

The public website remains a static Next.js export. Secure payment endpoints run as Cloudflare Pages Functions under `/api/razorpay/*`; Razorpay secrets are never included in browser JavaScript.

### Cloudflare Variables and Secrets

In Cloudflare, open **Workers & Pages → asher-healthcare → Settings → Variables and Secrets**. Add the following to both Preview and Production. Mark credentials and private keys as encrypted secrets.

- `RAZORPAY_KEY_ID` — begin with a Razorpay Test Mode key.
- `RAZORPAY_KEY_SECRET` — the matching Test Mode secret.
- `RAZORPAY_WEBHOOK_SECRET` — a new random secret used only for webhooks.
- `FIREBASE_PROJECT_ID` — `asher-healthcare-clinic`.
- `FIREBASE_STORAGE_BUCKET` — `asher-healthcare-clinic.firebasestorage.app` (the exact bucket shown in Firebase Storage).
- `FIREBASE_WEB_API_KEY` — the Firebase web API key already used by the website.
- `FIREBASE_CLIENT_EMAIL` — the `client_email` from a restricted Firebase service account JSON key.
- `FIREBASE_PRIVATE_KEY` — the complete `private_key` from that service account JSON key, including the BEGIN/END lines.
- `FIREBASE_REPORT_WRITER_CLIENT_EMAIL` — the `client_email` from a separate,
  bucket-scoped report-finalizer service account.
- `FIREBASE_REPORT_WRITER_PRIVATE_KEY` — the complete private key from that
  report-finalizer account. Keep it encrypted and separate from the read-only
  report-delivery credential.
- `FIREBASE_REPORT_CLEANUP_CLIENT_EMAIL` — the `client_email` from a third,
  delete-only report-reconciliation service account.
- `FIREBASE_REPORT_CLEANUP_PRIVATE_KEY` — the complete private key from that
  cleanup account. Keep it encrypted and separate from both delivery and writer
  credentials.

Do not add any of these values to GitHub. The Razorpay key ID is returned to authenticated staff only when checkout starts; the key secret never leaves Cloudflare.

### Firebase service account

1. In Firebase/Google Cloud, create a dedicated service account for the clinic's trusted functions.
2. Grant only the minimum Firestore access required for this clinic project. Avoid Owner or Editor roles.

#### Bucket security preflight (required)

Before adding any condition-scoped report binding:

1. Enable **Uniform Bucket-Level Access** on `gs://BUCKET` and verify
   `iamConfiguration.uniformBucketLevelAccess.enabled` is `true`. Conditional
   bucket IAM bindings are not a safe substitute for legacy object ACLs, and
   Cloud Storage requires uniform access for bucket-level IAM Conditions.
2. Read the current bucket IAM policy before editing it and preserve its
   `etag` and every unrelated binding. When using the JSON/REST workflow,
   request policy version 3 (`optionsRequestedPolicyVersion=3`). The policy
   submitted back to Cloud Storage must contain top-level `"version": 3`;
   otherwise conditional bindings can be omitted or rejected.
3. Confirm no deployment script, default object ACL, or legacy object ACL is
   expected to grant report access. With Uniform Bucket-Level Access enabled,
   all access must come from IAM and Firebase Storage Rules as designed here.
4. After applying the bindings, retrieve the policy again with requested IAM
   policy version 3 and verify each `condition.expression`, service-account
   member, role, `etag`, and top-level `version`. Do not continue if the policy
   is version 1, a condition is missing, or a broad inherited Storage role is
   present.

For a command-line preflight, use the clinic's exact bucket name:

```sh
gcloud storage buckets update gs://BUCKET --uniform-bucket-level-access
gcloud storage buckets describe gs://BUCKET --format="json(iamConfiguration.uniformBucketLevelAccess)"
gcloud storage buckets get-iam-policy gs://BUCKET --format=json
```

If policy JSON is applied by REST or automation, use an optimistic-concurrency
update with the freshly read `etag`, explicit IAM policy version 3, and no
replacement of unrelated bindings.

3. Do **not** grant `roles/storage.objectViewer`: it includes object listing. Create a
   project custom role for report delivery containing only
   `storage.objects.get`, then bind it on the clinic report bucket with this IAM
   condition (replace `BUCKET` with the exact bucket name):

   ```text
   resource.type == "storage.googleapis.com/Object" &&
   (
     resource.name.startsWith("projects/_/buckets/BUCKET/objects/reports/") ||
     resource.name.startsWith("projects/_/buckets/BUCKET/objects/lab-reports/")
   )
   ```

   This credential may get one already-authorized permanent report object. It
   must not have `storage.objects.list`, `storage.objects.create`,
   `storage.objects.update`, or `storage.objects.delete`.
4. Generate a JSON key and place only `client_email` and `private_key` into Cloudflare encrypted secrets.
5. Store the downloaded JSON key in the clinic's password manager, then remove it from Downloads and shared computers.
6. Deploy the updated `firestore.rules` and `storage.rules`. Browser reads of `reports/**` and all browser access to `lab-reports/**` are intentionally denied. Authenticated viewing, printing, and downloading must use the same-origin report APIs so current staff access is rechecked and an immutable audit entry is written before bytes are streamed.

Create a second dedicated service account for report finalization. Do **not**
grant `roles/storage.objectUser`, Owner, Editor, or Storage Admin. Instead create
two project custom roles and two conditional bucket bindings for this account:

| Custom role | Exact permissions | Required IAM condition |
| --- | --- | --- |
| Pending report worker | `storage.objects.get`, `storage.objects.delete` | Object name starts with `projects/_/buckets/BUCKET/objects/pending-reports/` |
| Permanent report creator | `storage.objects.create` | Object name starts with `projects/_/buckets/BUCKET/objects/lab-reports/` |

Include `resource.type == "storage.googleapis.com/Object"` in both conditions.
Do not put `storage.objects.list` or `storage.objects.update` in either custom
role. In particular, the finalizer account must never receive get, update, or
delete permission on `lab-reports/`. Interrupted-commit comparison is performed by
the separate get-only report-delivery credential; the writer credential cannot
read or destroy permanent records.

Put the finalizer account's email and private key in the two
`FIREBASE_REPORT_WRITER_*` encrypted secrets above. The trusted
`/api/labs/finalize-report` endpoint first creates a server-only
`labReportFinalizationIntents/{labOrderId}` recovery record, then uses the writer
to inspect one staged object and create the deterministic immutable report with
`ifGenerationMatch=0`. The final order pointer, patient report, immutable audit,
and completed intent state are written atomically before the exact staged
generation is deleted. Configure a short bucket lifecycle for abandoned
`pending-reports/` objects as a cleanup backstop.

Create a third dedicated service account for exceptional report cleanup. It
must have no Firestore role and no Storage get, list, create, or update
permission. Create one custom role containing only `storage.objects.delete` and
bind it to the bucket with this condition:

```text
resource.type == "storage.googleapis.com/Object" &&
resource.name.startsWith("projects/_/buckets/BUCKET/objects/lab-reports/")
```

Put this account in the two encrypted `FIREBASE_REPORT_CLEANUP_*` secrets. The
admin-only `POST /api/admin/labs/finalization` endpoint uses the separate
get-only delivery credential to verify the intent's exact content digest and
object generation first. A discard atomically claims the intent, then the
cleanup credential deletes only that observed generation with
`ifGenerationMatch`; a second atomic write marks it discarded and appends the
immutable audit entry. Never reuse the writer or delivery credential for this
delete permission.

After applying the bindings, review the bucket IAM policy and confirm all of the
following before production use:

- The delivery account has get-only access under legacy/generic `reports/` and
  finalized `lab-reports/`, and cannot list the bucket.
- The finalizer account can get/delete only under `pending-reports/` and create
  only under `lab-reports/`.
- The cleanup account can delete only under `lab-reports/` and cannot get or
  list any object; its encrypted secret is available only to the trusted Pages
  Functions runtime.
- Neither the delivery nor finalizer account can update an object or delete a
  permanent report.
- No inherited project-level Storage Admin, Object Admin, Object User, or Object
  Viewer role broadens either account.
- Uniform Bucket-Level Access is enabled, the retrieved policy is IAM policy
  version 3, and every prefix restriction is still present after re-reading the
  bucket policy.

### Audited report delivery

- Laboratory-order reports stream from `POST /api/labs/report-access` after validating the active staff member, active patient, current doctor assignment, and immutable lab-order link.
- Other patient reports stream from `POST /api/patients/report-access` after validating the active staff member, active patient, immutable report pointer, and current doctor assignment.
- Audit event names end in `_authorized`: the entry records that the requested
  view, print, or download passed authorization. It does not falsely claim that
  the browser completed delivery or printing after the response left the server.
- Both endpoints return `Cache-Control: private, no-store`; the browser never receives a Firebase Storage download URL or service-account token.
- Keep `FIREBASE_STORAGE_BUCKET` set in both Preview and Production. A missing
  bucket or missing get-only custom-role binding produces only a generic storage
  error and does not expose patient paths.

### Razorpay webhook

In the Razorpay dashboard, create a webhook with this URL:

`https://asherhealthcare.in/api/razorpay/webhook`

Use the same value entered as `RAZORPAY_WEBHOOK_SECRET` and subscribe to `payment.captured`, `qr_code.credited`, `refund.created`, `refund.processed`, and `refund.failed`. This allows checkout, reception POS QR payments, and refunds to reconcile even if the staff browser closes.

Razorpay QR Codes is an on-demand merchant feature. Ask Razorpay Support or the account point of contact to enable QR Codes before testing the reception POS workflow.

### Test before going live

1. Keep Razorpay in Test Mode and use Test Mode API keys.
2. Open an unpaid invoice in **Admin → Billing** and select **Record payment**.
3. Choose the amount and select **Pay online**.
4. Complete a Razorpay test payment.
5. Confirm the invoice balance, payment audit entry, collected-today amount, and receipt PDF update once—and only once.
6. Test a failed payment, a partial payment, closing the checkout window, and webhook delivery.
7. In Test Mode, verify a partial refund and a full refund. Confirm that a processed refund reopens the correct invoice balance once, a pending refund can be safely synchronized, and a second request cannot be created while one is pending.
8. Replace Test Mode keys with Live Mode keys only after Razorpay activates the account and all checks pass.

For reception POS testing, register one general case (₹250) and one Pediatric/OBG specialist case (₹500), generate each single-use QR, complete payment, and confirm that printing remains unavailable until the server reports the payment as captured.

After any variable, secret, rule, or function change, redeploy the Cloudflare Pages project before testing production.

## Firestore indexes and booking-guard expiry

The dashboard uses collection-group date queries for payment audit entries and clinical visits. Deploy the versioned indexes together with the Firestore rules:

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

Public appointment throttling stores short-lived, hashed guard records in the `bookingGuards` collection group. Firestore TTL is a project setting rather than a Firebase configuration-file resource, so enable it once from Google Cloud Shell:

```bash
gcloud firestore fields ttls update expiresAt --collection-group=bookingGuards --enable-ttl --project=asher-healthcare-clinic
```

The TTL policy may delete expired guard documents asynchronously. Each guard ID includes its active time bucket, so an older document cannot block a valid booking after that window ends even if cleanup is delayed. Do not add raw phone numbers, IP addresses, or browser identifiers to these guard documents.
