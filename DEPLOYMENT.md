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
