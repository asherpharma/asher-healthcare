import assert from "node:assert/strict";
import test from "node:test";

import { SERVICE_ACCOUNT_SCOPES } from "../server/razorpay/firebase.js";
import { HttpError } from "../server/razorpay/http.js";
import {
  fetchLabReportObject,
  fetchPatientReportObject,
  patientReportStreamResponse,
  validateLabReportPath,
  validatePatientReportPath,
} from "../server/storage/report-objects.js";

const env = { FIREBASE_STORAGE_BUCKET: "asher-healthcare-clinic.firebasestorage.app" };
const reportPath = "reports/patient-1/1750000000000-a1b2c3d4-report.pdf";

test("service-account token requests the read-only Cloud Storage scope", () => {
  assert.ok(SERVICE_ACCOUNT_SCOPES.includes(
    "https://www.googleapis.com/auth/devstorage.read_only",
  ));
  assert.equal(SERVICE_ACCOUNT_SCOPES.some((scope) => (
    scope === "https://www.googleapis.com/auth/devstorage.full_control"
    || scope === "https://www.googleapis.com/auth/devstorage.read_write"
  )), false);
});

test("report paths must be a single safe object below the exact patient prefix", () => {
  assert.equal(validatePatientReportPath(reportPath, "patient-1"), reportPath);
  const finalizedLabPath = "lab-reports/patient-1/lab-order-1.pdf";
  assert.equal(
    validateLabReportPath(finalizedLabPath, "patient-1"),
    finalizedLabPath,
  );
  assert.equal(validateLabReportPath(reportPath, "patient-1"), reportPath);
  assert.throws(
    () => validatePatientReportPath(finalizedLabPath, "patient-1"),
    (error) => error instanceof HttpError && error.status === 409,
  );
  for (const invalid of [
    "reports/patient-2/1750000000000-report.pdf",
    "reports/patient-1/../patient-2/report.pdf",
    "reports/patient-1/folder/report.pdf",
    "reports/patient-1/report.exe",
    "reports/patient-1/report.pdf\u0000.jpg",
  ]) {
    assert.throws(
      () => validatePatientReportPath(invalid, "patient-1"),
      (error) => error instanceof HttpError && error.status === 409,
    );
  }
});

test("lab proxy fetches the new server-only namespace without widening generic access", async () => {
  const labPath = "lab-reports/patient-1/lab-order-1.pdf";
  const reportBytes = Uint8Array.from([0x25, 0x50, 0x44, 0x46]);
  let requestCount = 0;
  const fetchImpl = async () => {
    requestCount += 1;
    if (requestCount === 1) {
      return Response.json({
        name: labPath,
        size: String(reportBytes.byteLength),
        contentType: "application/pdf",
        generation: "1786000000000001",
      });
    }
    return new Response(reportBytes, { headers: { "Content-Type": "application/pdf" } });
  };
  const result = await fetchLabReportObject(env, labPath, "patient-1", {
    fetchImpl,
    accessTokenProvider: async () => "server-token",
  });
  assert.equal(result.size, reportBytes.byteLength);
  assert.equal(requestCount, 2);
});

test("server fetches metadata then streams the exact immutable generation", async () => {
  const calls = [];
  const reportBytes = Uint8Array.from([0x25, 0x50, 0x44, 0x46]);
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (calls.length === 1) {
      return Response.json({
        name: reportPath,
        size: String(reportBytes.byteLength),
        contentType: "application/pdf",
        generation: "1786000000000000",
      });
    }
    return new Response(reportBytes, {
      headers: { "Content-Type": "application/pdf" },
    });
  };

  const result = await fetchPatientReportObject(env, reportPath, "patient-1", {
    fetchImpl,
    accessTokenProvider: async () => "server-token",
  });
  assert.equal(result.contentType, "application/pdf");
  assert.equal(result.extension, "pdf");
  assert.equal(result.size, 4);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].url.includes(encodeURIComponent(reportPath)));
  assert.ok(calls[1].url.includes("alt=media"));
  assert.ok(calls[1].url.includes("generation=1786000000000000"));
  assert.equal(calls[0].options.headers.Authorization, "Bearer server-token");

  const response = patientReportStreamResponse(result, "download");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store, max-age=0");
  assert.equal(
    response.headers.get("Content-Disposition"),
    'attachment; filename="medical-report.pdf"',
  );
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), reportBytes);
});

test("storage failures use generic errors and never include object paths", async () => {
  await assert.rejects(
    fetchPatientReportObject(env, reportPath, "patient-1", {
      fetchImpl: async () => new Response("forbidden", { status: 403 }),
      accessTokenProvider: async () => "server-token",
    }),
    (error) => (
      error instanceof HttpError
      && error.status === 503
      && !error.message.includes("patient-1")
      && !error.message.includes("1750000000000")
    ),
  );
});
