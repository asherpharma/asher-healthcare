import { getDocument } from "../razorpay/firebase.js";
import { HttpError } from "../razorpay/http.js";

const REQUIRED_SERVER_SETTINGS = Object.freeze([
  "FIREBASE_PROJECT_ID",
  "FIREBASE_WEB_API_KEY",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
]);

const REQUIRED_PAYMENT_SETTINGS = Object.freeze([
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "RAZORPAY_WEBHOOK_SECRET",
]);

const REQUIRED_REPORT_SETTINGS = Object.freeze([
  "FIREBASE_STORAGE_BUCKET",
  "FIREBASE_REPORT_WRITER_CLIENT_EMAIL",
  "FIREBASE_REPORT_WRITER_PRIVATE_KEY",
  "FIREBASE_REPORT_CLEANUP_CLIENT_EMAIL",
  "FIREBASE_REPORT_CLEANUP_PRIVATE_KEY",
]);

function configured(env, names) {
  return names.every((name) => typeof env?.[name] === "string" && env[name].trim().length > 0);
}

function razorpayMode(env) {
  const keyId = String(env?.RAZORPAY_KEY_ID || "").trim();
  if (keyId.startsWith("rzp_live_")) return "live";
  if (keyId.startsWith("rzp_test_")) return "test";
  return "unknown";
}

export async function clinicSystemHealth(env, staff, database = { getDocument }) {
  const startedAt = Date.now();
  const staffDocument = await database.getDocument(env, `staff/${staff.uid}`);
  const authorized = (
    staffDocument
    && staffDocument.data.active === true
    && staffDocument.data.role === "admin"
  );

  if (!authorized) {
    throw new HttpError(403, "Only an active clinic administrator can inspect system health.");
  }

  const paymentConfigured = configured(env, REQUIRED_PAYMENT_SETTINGS);
  const paymentMode = razorpayMode(env);

  return {
    checkedAt: new Date().toISOString(),
    responseTimeMs: Math.max(0, Date.now() - startedAt),
    services: {
      database: { status: "operational" },
      authentication: {
        status: configured(env, REQUIRED_SERVER_SETTINGS) ? "configured" : "attention",
      },
      payments: {
        status: "operational",
        mode: "manual",
        gatewayMode: paymentConfigured ? paymentMode : "unconfigured",
      },
      clinicalReports: {
        status: configured(env, REQUIRED_REPORT_SETTINGS) ? "configured" : "attention",
      },
    },
    release: String(env?.CF_PAGES_COMMIT_SHA || env?.CF_PAGES_BRANCH || "local").slice(0, 40),
  };
}
