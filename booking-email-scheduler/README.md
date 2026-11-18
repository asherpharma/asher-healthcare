# Booking email retry scheduler

This standalone Cloudflare Worker has no HTTP handler or public URL. It only posts
to the fixed production sweep URL on a scheduled event. It needs the sweep
secret only; do not attach Firebase or Resend credentials to it.

The checked-in config does not create a cron trigger. Before enabling
this on production, verify the Pages email configuration and one synthetic
test alert. Create a random 32-byte, unpadded base64url sweep secret (43
characters); set the same value using the encrypted
`BOOKING_ALERT_EMAIL_SWEEP_SECRET` binding in Pages production and this Worker.
Never commit the secret, paste it in chat or write it to command logs.

After production activation is approved, use an operational copy of this
config in this directory, with `"triggers": { "crons": ["*/5 * * * *"] }`, for
the scheduled deploy. Use the approved, installed Wrangler to deploy with
that config. The trigger checks every five minutes; inspect the Worker's
Cron Events for failures. A successful run means the sweep completed,
not that individual emails arrived in the clinic inbox. The checked-in
trigger-less config leaves an already-deployed trigger unchanged on
subsequent Wrangler deployments. To stop it, remove the trigger explicitly
or use `"triggers": { "crons": [] }` for the approved deploy.

Do not run a local scheduled invocation against production to test the
module. Run the isolated, fully mocked `tests/booking-email-sweep.test.mjs`
instead.
