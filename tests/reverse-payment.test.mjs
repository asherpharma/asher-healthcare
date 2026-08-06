import assert from "node:assert/strict";
import test from "node:test";

import { HttpError } from "../server/razorpay/http.js";
import {
  assertMatchingManualReversalReplay,
  calculateManualPaymentReversal,
  manualPaymentReversalMaterial,
  normalizeManualPaymentReversalRequest,
} from "../server/billing/reverse-payment.js";

const requestId = "e7e9cc18-6df0-4ce5-97c6-8af5e5975ee3";
const administrator = { uid: "admin-1", role: "admin" };

test("normalizes a stable manual-payment reversal request", () => {
  assert.deepEqual(normalizeManualPaymentReversalRequest({
    requestId: requestId.toUpperCase(),
    invoiceId: "invoice_123",
    paymentId: "payment_123",
    reason: "  Cash entry duplicated  ",
  }), {
    requestId,
    invoiceId: "invoice_123",
    paymentId: "payment_123",
    reason: "Cash entry duplicated",
  });
});

test("rejects invalid identifiers and unclear reasons", () => {
  assert.throws(
    () => normalizeManualPaymentReversalRequest({
      requestId: "retry-1",
      invoiceId: "invoice_123",
      paymentId: "payment_123",
      reason: "Duplicate entry",
    }),
    /fresh payment correction/u,
  );
  assert.throws(
    () => normalizeManualPaymentReversalRequest({
      requestId,
      invoiceId: "invoice/123",
      paymentId: "payment_123",
      reason: "Duplicate entry",
    }),
    /valid manual payment/u,
  );
  assert.throws(
    () => normalizeManualPaymentReversalRequest({
      requestId,
      invoiceId: "invoice_123",
      paymentId: "payment_123",
      reason: "bad",
    }),
    /at least 5 characters/u,
  );
});

test("subtracts an exact manual payment and uses neutral summary metadata", () => {
  assert.deepEqual(calculateManualPaymentReversal(
    { total: 500, amountPaid: 500, balance: 0 },
    { amount: 300, method: "upi", source: "manual", status: "received" },
  ), {
    reversedAmount: 300,
    amountPaid: 200,
    balance: 300,
    paymentStatus: "partial",
    paymentMethod: "not_recorded",
    paymentReference: "",
    paidAt: null,
  });
  assert.deepEqual(calculateManualPaymentReversal(
    { total: 500, amountPaid: 250, balance: 250 },
    { amount: 250, method: "cash", source: "manual", status: "received" },
  ), {
    reversedAmount: 250,
    amountPaid: 0,
    balance: 500,
    paymentStatus: "unpaid",
    paymentMethod: "not_recorded",
    paymentReference: "",
    paidAt: null,
  });
});

test("rejects gateway, corrected, refunded, and inconsistent ledger rows", () => {
  const invoice = { total: 500, amountPaid: 250, balance: 250 };
  assert.throws(
    () => calculateManualPaymentReversal(invoice, {
      amount: 250,
      method: "cash",
      source: "gateway",
      status: "received",
    }),
    /refund workflow/u,
  );
  assert.throws(
    () => calculateManualPaymentReversal(invoice, {
      amount: 250,
      method: "cash",
      source: "manual",
      status: "reversed",
    }),
    /already corrected/u,
  );
  assert.throws(
    () => calculateManualPaymentReversal(invoice, {
      amount: 250,
      method: "cash",
      refundedAmount: 1,
      source: "manual",
      status: "received",
    }),
    /administrator review/u,
  );
  assert.throws(
    () => calculateManualPaymentReversal(
      { total: 500, amountPaid: 100, balance: 500 },
      { amount: 100, method: "cash", source: "manual", status: "received" },
    ),
    /administrator review/u,
  );
  assert.throws(
    () => calculateManualPaymentReversal(
      { total: 500, amountPaid: 100, balance: 400 },
      { amount: 250, method: "cash", source: "manual", status: "received" },
    ),
    /administrator review/u,
  );
});

test("scopes replay identity to the administrator and request UUID", () => {
  assert.equal(
    manualPaymentReversalMaterial("admin-a", requestId),
    manualPaymentReversalMaterial("admin-a", requestId.toUpperCase()),
  );
  assert.notEqual(
    manualPaymentReversalMaterial("admin-a", requestId),
    manualPaymentReversalMaterial("admin-b", requestId),
  );
});

test("returns only an exact completed replay", () => {
  const input = normalizeManualPaymentReversalRequest({
    requestId,
    invoiceId: "invoice_123",
    paymentId: "payment_123",
    reason: "Duplicate cash entry",
  });
  const operation = {
    operationId: "operation-1",
    status: "completed",
    requestId,
    invoiceId: "invoice_123",
    invoiceNumber: "ASH-20260807-TEST01",
    paymentId: "payment_123",
    patientId: "patient_123",
    patientName: "Ananya Rao",
    amount: 250,
    paymentStatus: "partial",
    reason: "Duplicate cash entry",
    actorUid: administrator.uid,
  };
  assert.deepEqual(
    assertMatchingManualReversalReplay(operation, input, administrator),
    {
      requestId,
      invoiceId: "invoice_123",
      invoiceNumber: "ASH-20260807-TEST01",
      paymentId: "payment_123",
      amount: 250,
      paymentStatus: "partial",
      alreadyProcessed: true,
    },
  );
  assert.throws(
    () => assertMatchingManualReversalReplay(
      operation,
      { ...input, paymentId: "payment_456" },
      administrator,
    ),
    (error) => error instanceof HttpError && error.status === 409,
  );
});
