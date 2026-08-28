# Asher Women & Child Healthcare

The production website and clinic-management workspace for Asher Women & Child
Healthcare, Bengaluru.

## Current release

The Staff Today and urgent-lab reliability release gives receptionists and
doctors a live, role-scoped daily workspace for queues, assigned follow-ups, and
urgent lab work. Doctors receive a small, fast Today snapshot plus a secure,
cursor-paginated urgent Lab Desk that can reach every assigned active order
without loading the clinic-wide directory. Refreshes keep the last successful
snapshot visible, recovery is accessible on mobile, and a selected urgent order
opens directly in its verified Lab Desk card.

The release also limits staff authentication to the current browser session,
enforces the complete appointment queue sequence, restores tablet-friendly
layouts, and keeps clinical and patient-directory reads bounded and role-scoped.

The clinical foundation continues to provide the unified patient timeline,
child growth tracking, expanded vaccination records, and structured pregnancy
follow-up.

Production: [asherhealthcare.in](https://asherhealthcare.in)

This application contains private clinical workflows. Never commit patient data,
Firebase service-account credentials, payment secrets, or local environment files.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `src/app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deployment

The `main` branch deploys automatically to Cloudflare Pages. Preview branches are
deployed separately for verification before production promotion.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
