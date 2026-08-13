import assert from "node:assert/strict";
import test from "node:test";

import { clinicSystemHealth } from "../server/operations/health.js";

const fullEnvironment = {
  FIREBASE_PROJECT_ID: "asher-test",
  FIREBASE_WEB_API_KEY: "web-key",
  FIREBASE_CLIENT_EMAIL: "database@example.test",
  FIREBASE_PRIVATE_KEY: "private-key",
  FIREBASE_STORAGE_BUCKET: "reports.example.test",
  FIREBASE_REPORT_WRITER_CLIENT_EMAIL: "writer@example.test",
  FIREBASE_REPORT_WRITER_PRIVATE_KEY: "writer-key",
  FIREBASE_REPORT_CLEANUP_CLIENT_EMAIL: "cleanup@example.test",
  FIREBASE_REPORT_CLEANUP_PRIVATE_KEY: "cleanup-key",
  RAZORPAY_KEY_ID: "rzp_test_key",
  RAZORPAY_KEY_SECRET: "payment-secret",
  RAZORPAY_WEBHOOK_SECRET: "webhook-secret",
  CF_PAGES_COMMIT_SHA: "0123456789abcdef",
};

test("system health returns redacted readiness only to a current administrator", async () => {
  const result = await clinicSystemHealth(
    fullEnvironment,
    { uid: "admin-1", role: "admin" },
    { async getDocument() { return { data: { active: true, role: "admin" } }; } },
  );

  assert.equal(result.services.database.status, "operational");
  assert.equal(result.services.payments.status, "attention");
  assert.equal(result.services.payments.mode, "test");
  assert.equal(result.services.clinicalReports.status, "configured");
  assert.equal(result.release, "0123456789abcdef");
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("payment-secret"), false);
  assert.equal(serialized.includes("private-key"), false);
  assert.equal(serialized.includes("@example.test"), false);
});

test("system health distinguishes a live Razorpay configuration without exposing its key", async () => {
  const result = await clinicSystemHealth(
    { ...fullEnvironment, RAZORPAY_KEY_ID: "rzp_live_redacted" },
    { uid: "admin-1", role: "admin" },
    { async getDocument() { return { data: { active: true, role: "admin" } }; } },
  );

  assert.equal(result.services.payments.status, "configured");
  assert.equal(result.services.payments.mode, "live");
  assert.equal(JSON.stringify(result).includes("rzp_live_redacted"), false);
});

test("system health reports missing optional services without exposing variable names", async () => {
  const result = await clinicSystemHealth(
    { FIREBASE_PROJECT_ID: "asher-test" },
    { uid: "admin-1", role: "admin" },
    { async getDocument() { return { data: { active: true, role: "admin" } }; } },
  );
  assert.equal(result.services.authentication.status, "attention");
  assert.equal(result.services.payments.status, "attention");
  assert.equal(JSON.stringify(result).includes("RAZORPAY"), false);
});

test("system readiness assigns storage only to secure clinical reports", async () => {
  const withoutStorage = { ...fullEnvironment };
  delete withoutStorage.FIREBASE_STORAGE_BUCKET;
  const result = await clinicSystemHealth(
    withoutStorage,
    { uid: "admin-1", role: "admin" },
    { async getDocument() { return { data: { active: true, role: "admin" } }; } },
  );

  assert.equal(result.services.authentication.status, "configured");
  assert.equal(result.services.clinicalReports.status, "attention");
});

test("system health rechecks active administrator access", async () => {
  for (const data of [null, { active: false, role: "admin" }, { active: true, role: "reception" }]) {
    await assert.rejects(
      clinicSystemHealth(
        fullEnvironment,
        { uid: "admin-1", role: "admin" },
        { async getDocument() { return data ? { data } : null; } },
      ),
      (error) => error.status === 403,
    );
  }
});
