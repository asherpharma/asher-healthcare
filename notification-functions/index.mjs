import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { defineBoolean, defineSecret, defineString } from "firebase-functions/params";
import { info, warn } from "firebase-functions/logger";
import webPush from "web-push";
import { processAppointmentAlert } from "./delivery.mjs";
import { firestoreStore } from "./firestore-store.mjs";

const enabled = defineBoolean("ALERTS_ENABLED", { default: false });
const activatedAt = defineString("ALERTS_ACTIVATED_AT", { default: "" });
const region = defineString("ALERTS_REGION", { default: "asia-south1" });
const origin = defineString("ALERTS_ORIGIN", { default: "https://asherhealthcare.in" });
const recipient = defineString("ALERTS_EMAIL_TO", { default: "asherhealthcare100@gmail.com" });
const sender = defineString("ALERTS_EMAIL_FROM", { default: "" });
const vapidPublicKey = defineString("ALERTS_VAPID_PUBLIC_KEY", { default: "" });
const resendApiKey = defineSecret("ALERTS_RESEND_API_KEY");
const vapidPrivateKey = defineSecret("ALERTS_VAPID_PRIVATE_KEY");

async function sendEmail(message, { idempotencyKey, apiKey }) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
    headers: {
      "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`,
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(message),
  });
  if (!response.ok) {
    // Do not retain/log provider bodies: they may echo configuration or keys.
    await response.body?.cancel();
    throw Object.assign(new Error("Email provider rejected delivery."), { status: response.status });
  }
  await response.body?.cancel();
}

async function sendPush(subscription, message, options) {
  await webPush.sendNotification(subscription, JSON.stringify(message), {
    TTL: 60 * 60, urgency: "normal", topic: options.topic, timeout: 15_000,
    vapidDetails: { subject: options.subject, publicKey: options.publicKey, privateKey: options.privateKey },
  });
}

export const appointmentBooked = onDocumentCreated({
  document: "appointments/{appointmentId}", region, retry: true,
  timeoutSeconds: 300, memory: "256MiB", minInstances: 0, maxInstances: 3, concurrency: 5,
  secrets: [resendApiKey, vapidPrivateKey],
}, async (event) => {
  if (!event.data) return;
  const app = getApps()[0] || initializeApp();
  const config = {
    enabled: enabled.value(), activatedAt: activatedAt.value(), origin: origin.value(),
    recipient: recipient.value(), sender: sender.value(),
    resendApiKey: resendApiKey.value(),
    vapidPublicKey: vapidPublicKey.value(), vapidPrivateKey: vapidPrivateKey.value(),
  };
  // The Firestore resource path, not client fields, identifies the deployment.
  const sourceProject = /^\/\/firestore\.googleapis\.com\/projects\/([^/]+)\//u.exec(event.source || "")?.[1];
  const projectId = sourceProject || app.options.projectId || process.env.GCLOUD_PROJECT;
  const result = await processAppointmentAlert({
    id: event.params.appointmentId, projectId,
    createdAtMs: event.data.createTime?.toMillis(),
    appointment: event.data.data(),
  }, config, { store: firestoreStore(getFirestore(app)), sendEmail, sendPush });
  if (result.status === "processing") {
    // Eventarc retries the event. The transactional channel ledgers and the
    // fixed deadline make each retry bounded and independent of other channels.
    throw new Error("Appointment alert delivery pending; retry required.");
  }
  const log = result.status === "needs_attention" ? warn : info;
  log("Appointment alert processed", {
    status: result.status, code: result.code || "already_processed",
    pushTargetCount: result.pushTargetCount || 0,
    fanoutTruncated: result.fanoutTruncated === true,
  });
});
