import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const receptionPaymentSource = await readFile(
  new URL("../src/components/admin/ReceptionPayment.tsx", import.meta.url),
  "utf8",
);
const expressReceptionSource = await readFile(
  new URL("../src/components/admin/ExpressReception.tsx", import.meta.url),
  "utf8",
);
const billingSource = await readFile(
  new URL("../src/app/admin/billing/page.tsx", import.meta.url),
  "utf8",
);

test("express reception records manual collection through the audited billing endpoint", () => {
  assert.match(receptionPaymentSource, /\/api\/billing\/manual-payment/u);
  assert.match(receptionPaymentSource, /"cash" \| "upi" \| "card" \| "bank_transfer"/u);
  assert.match(receptionPaymentSource, /Saved to the secure ledger/u);
  assert.match(receptionPaymentSource, /printReceiptPdf/u);
  assert.match(receptionPaymentSource, /printBlankPrescriptionPdf/u);
  assert.doesNotMatch(receptionPaymentSource, /\/api\/razorpay\/create-qr/u);
  assert.doesNotMatch(receptionPaymentSource, /\/api\/razorpay\/qr-status/u);
});

test("reception copy describes the one-page manual collection workflow", () => {
  assert.match(expressReceptionSource, /Record manual collection and print/u);
  assert.match(expressReceptionSource, /external UPI, card\/POS, or bank collection/u);
  assert.doesNotMatch(expressReceptionSource, /documents unlock after server-confirmed payment/iu);
});

test("billing keeps gateway compatibility but disables new automated collection entry points", () => {
  assert.match(billingSource, /const AUTOMATED_PAYMENT_COLLECTION_ENABLED = false;/u);
  assert.match(billingSource, /Manual collection is active/u);
  assert.match(billingSource, /Automatic QR and online checkout are currently off/u);
  assert.match(billingSource, /\/api\/billing\/manual-payment/u);
  assert.match(billingSource, /\/api\/razorpay\/create-order/u);
  assert.match(
    billingSource,
    /AUTOMATED_PAYMENT_COLLECTION_ENABLED \? \([\s\S]*?checkout\.razorpay\.com/u,
  );
});
