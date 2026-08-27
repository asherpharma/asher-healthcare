import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const billingSource = await readFile(
  new URL("../src/app/admin/billing/page.tsx", import.meta.url),
  "utf8",
);

test("billing uses bounded recent patients and an explicit private search picker", () => {
  assert.match(billingSource, /fetchPatientDirectoryPage\(user, \{ pageSize: RECENT_PATIENT_LIMIT \}\)/u);
  assert.match(billingSource, /const RECENT_PATIENT_LIMIT = 12;/u);
  assert.match(billingSource, /patientSearchReady\(patientPickerQuery\)/u);
  assert.match(
    billingSource,
    /searchPatientDirectory\(user, patientPickerQuery\.trim\(\), \{ pageSize: PATIENT_SEARCH_LIMIT \}\)/u,
  );
  assert.match(billingSource, /window\.setTimeout\([\s\S]*?, 280\);/u);
  assert.match(billingSource, /Search details stay only on this screen/u);
  assert.doesNotMatch(billingSource, /import \{ fetchPatientDirectory \}/u);
  assert.doesNotMatch(billingSource, /Select active patient/u);
  assert.doesNotMatch(billingSource, /localStorage|sessionStorage/u);
});

test("billing resolves exact handoffs and verifies invoice patients in chunks before controls open", () => {
  assert.match(billingSource, /resolvePatientDirectoryEntries\(user, handoffPatientId/u);
  assert.match(billingSource, /const INVOICE_PATIENT_RESOLUTION_CHUNK = 50;/u);
  assert.match(
    billingSource,
    /invoicePatientIds\.slice\(index, index \+ INVOICE_PATIENT_RESOLUTION_CHUNK\)/u,
  );
  assert.match(
    billingSource,
    /resolvePatientDirectoryEntries\(user, patientIds, \{[\s\S]*?includeArchived: profile\.role === "admin"/u,
  );
  assert.match(
    billingSource,
    /resolvedInvoicePatientKey === invoicePatientIdsKey && !unavailableReason/u,
  );
  assert.match(billingSource, /Patient status could not be verified[\s\S]*?controls are paused/u);
});

test("billing rechecks the exact patient immediately before every financial mutation", () => {
  assert.equal(
    [...billingSource.matchAll(/recheckPatientBeforeBillingMutation\(/gu)].length,
    8,
    "one helper definition plus seven mutation-time checks should remain in place",
  );
  assert.match(
    billingSource,
    /recheckPatientBeforeBillingMutation\(patientId: string\)[\s\S]*?resolvePatientDirectoryEntries\(user, patientId/u,
  );
  assert.match(
    billingSource,
    /async function createInvoice[\s\S]*?recheckPatientBeforeBillingMutation\(selectedPatient\.id\)[\s\S]*?\/api\/billing\/invoice-create/u,
  );
  assert.match(
    billingSource,
    /async function recordPayment[\s\S]*?recheckPatientBeforeBillingMutation\(payingInvoice\.patientId\)[\s\S]*?submitManualPayment/u,
  );
  assert.match(
    billingSource,
    /async function reversePayment[\s\S]*?recheckPatientBeforeBillingMutation\(reversingInvoice\.patientId\)[\s\S]*?\/api\/billing\/reverse-payment/u,
  );
  assert.match(
    billingSource,
    /async function submitRazorpayRefund[\s\S]*?recheckPatientBeforeBillingMutation\(refundInvoice\.patientId\)[\s\S]*?\/api\/razorpay\/refund/u,
  );
  assert.match(
    billingSource,
    /async function syncRazorpayRefund[\s\S]*?recheckPatientBeforeBillingMutation\(syncInvoice\.patientId\)[\s\S]*?\/api\/razorpay\/refund-status/u,
  );
  assert.match(
    billingSource,
    /async function startRazorpayPayment[\s\S]*?recheckPatientBeforeBillingMutation\(invoice\.patientId\)[\s\S]*?\/api\/razorpay\/create-order/u,
  );
  assert.match(billingSource, /receipts and invoice history remain available/u);
});
