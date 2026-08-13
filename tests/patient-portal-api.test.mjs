import assert from "node:assert/strict";
import test from "node:test";
import { onRequestGet as adminGet, onRequestPost as adminPost } from "../functions/api/admin/patient-access.js";
import { onRequestGet as documentGet, onRequestPost as documentPost } from "../functions/api/patient/document.js";
import { onRequestGet as portalGet, onRequestPost as portalPost } from "../functions/api/patient/portal.js";
import { onRequestGet as reportGet, onRequestPost as reportPost } from "../functions/api/patient/report.js";
import { handlePatientReport } from "../functions/api/patient/report.js";

test("portal APIs reject browser GET access", () => {
  for (const handler of [adminGet, documentGet, portalGet, reportGet]) {
    const response = handler();
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
});

test("portal APIs reject cross-origin POST before auth or data access", async () => {
  for (const handler of [adminPost, documentPost, portalPost, reportPost]) {
    const response = await handler({ request: new Request("https://asherhealthcare.in/api/test", { method: "POST", headers: { Origin: "https://attacker.example", "Content-Type": "application/json" }, body: "{}" }), env: {} });
    assert.equal(response.status, 403);
  }
});

test("patient APIs require an authenticated Firebase token", async () => {
  for (const handler of [documentPost, portalPost, reportPost]) {
    const response = await handler({ request: new Request("https://asherhealthcare.in/api/test", { method: "POST", headers: { Origin: "https://asherhealthcare.in", "Content-Type": "application/json" }, body: JSON.stringify({ action: "dashboard" }) }), env: { FIREBASE_WEB_API_KEY: "test" } });
    assert.equal(response.status, 401);
  }
});

test("report bytes are buffered then exact access is reauthorized before response", async () => {
  let authorizationCount = 0;
  const response = await handlePatientReport({
    request: new Request("https://asherhealthcare.in/api/patient/report", { method: "POST", headers: { Origin: "https://asherhealthcare.in", "Content-Type": "application/json" }, body: JSON.stringify({ patientId: "patient-A", reportId: "report-1", action: "download" }) }),
    env: {},
  }, {
    requireAccount: async () => ({ uid: "account-A" }),
    authorize: async () => {
      authorizationCount += 1;
      if (authorizationCount === 2) throw new Error("revoked");
      return { patientId: "patient-A", storagePath: "reports/patient-A/report.pdf", action: "download" };
    },
    fetchObject: async () => ({ body: new Uint8Array([1, 2, 3]), contentType: "application/pdf", extension: "pdf", size: 3 }),
  });
  assert.equal(authorizationCount, 2);
  assert.equal(response.status, 500);
  assert.match(response.headers.get("Content-Type") || "", /application\/json/u);
});
