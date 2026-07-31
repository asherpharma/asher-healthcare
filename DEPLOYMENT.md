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
## Razorpay secure payment setup

The public website remains a static Next.js export. Secure payment endpoints run as Cloudflare Pages Functions under `/api/razorpay/*`; Razorpay secrets are never included in browser JavaScript.

### Cloudflare Variables and Secrets

In Cloudflare, open **Workers & Pages → asher-healthcare → Settings → Variables and Secrets**. Add the following to both Preview and Production. Mark credentials and private keys as encrypted secrets.

- `RAZORPAY_KEY_ID` — begin with a Razorpay Test Mode key.
- `RAZORPAY_KEY_SECRET` — the matching Test Mode secret.
- `RAZORPAY_WEBHOOK_SECRET` — a new random secret used only for webhooks.
- `FIREBASE_PROJECT_ID` — `asher-healthcare-clinic`.
- `FIREBASE_WEB_API_KEY` — the Firebase web API key already used by the website.
- `FIREBASE_CLIENT_EMAIL` — the `client_email` from a restricted Firebase service account JSON key.
- `FIREBASE_PRIVATE_KEY` — the complete `private_key` from that service account JSON key, including the BEGIN/END lines.

Do not add any of these values to GitHub. The Razorpay key ID is returned to authenticated staff only when checkout starts; the key secret never leaves Cloudflare.

### Firebase service account

1. In Firebase/Google Cloud, create a dedicated service account for the payment function.
2. Grant only the minimum Firestore access required for this clinic project. Avoid Owner or Editor roles.
3. Generate a JSON key and place only `client_email` and `private_key` into Cloudflare encrypted secrets.
4. Store the downloaded JSON key in the clinic's password manager, then remove it from Downloads and shared computers.
5. Deploy the updated `firestore.rules`. Client applications can record manual payments, while gateway payment records are accepted only from the trusted service account.

### Razorpay webhook

In the Razorpay dashboard, create a webhook with this URL:

`https://asherhealthcare.in/api/razorpay/webhook`

Use the same value entered as `RAZORPAY_WEBHOOK_SECRET` and subscribe to both `payment.captured` and `qr_code.credited`. This allows checkout and reception POS QR payments to update the invoice even if the staff browser closes after payment.

Razorpay QR Codes is an on-demand merchant feature. Ask Razorpay Support or the account point of contact to enable QR Codes before testing the reception POS workflow.

### Test before going live

1. Keep Razorpay in Test Mode and use Test Mode API keys.
2. Open an unpaid invoice in **Admin → Billing** and select **Record payment**.
3. Choose the amount and select **Pay online**.
4. Complete a Razorpay test payment.
5. Confirm the invoice balance, payment audit entry, collected-today amount, and receipt PDF update once—and only once.
6. Test a failed payment, a partial payment, closing the checkout window, and webhook delivery.
7. Replace Test Mode keys with Live Mode keys only after Razorpay activates the account and all checks pass.

For reception POS testing, register one general case (₹250) and one Pediatric/OBG specialist case (₹500), generate each single-use QR, complete payment, and confirm that printing remains unavailable until the server reports the payment as captured.

After any variable, secret, rule, or function change, redeploy the Cloudflare Pages project before testing production.
