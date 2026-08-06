import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateManualPayment,
  normalizeManualPaymentRequest,
} from "../server/billing/manual-payment.js";

const requestId = "e7e9cc18-6df0-4ce5-97c6-8af5e5975ee3";

test("normalizes a two-decimal manual payment request", () => {
  assert.deepEqual(
    normalizeManualPaymentRequest({
      requestId,
      invoiceId: "invoice_123",
      amount: "250.50",
      method: "upi",
      reference: "  UPI-REF-1  ",
    }),
    {
      requestId,
      invoiceId: "invoice_123",
      amount: 250.5,
      amountPaise: 25050,
      method: "upi",
      reference: "UPI-REF-1",
    },
  );
});

test("rejects reused-looking or imprecise manual payment input", () => {
  assert.throws(
    () => normalizeManualPaymentRequest({
      requestId: "not-a-uuid",
      invoiceId: "invoice_123",
      amount: 250,
      method: "cash",
    }),
    /fresh payment attempt/u,
  );
  assert.throws(
    () => normalizeManualPaymentRequest({
      requestId,
      invoiceId: "invoice_123",
      amount: 1.999,
      method: "cash",
    }),
    /two decimal places/u,
  );
  assert.throws(
    () => normalizeManualPaymentRequest({
      requestId,
      invoiceId: "invoice_123",
      amount: 250,
      method: "online",
    }),
    /cash, UPI, card, or bank transfer/u,
  );
});

test("calculates partial and final ledger balances in paise", () => {
  const invoice = { total: 500, amountPaid: 0, balance: 500 };
  assert.deepEqual(calculateManualPayment(invoice, 25000), {
    amountPaid: 250,
    balance: 250,
    paymentStatus: "partial",
  });
  assert.deepEqual(calculateManualPayment(invoice, 50000), {
    amountPaid: 500,
    balance: 0,
    paymentStatus: "paid",
  });
});

test("rejects overpayment, paid invoices, and inconsistent legacy totals", () => {
  assert.throws(
    () => calculateManualPayment({ total: 500, amountPaid: 0, balance: 500 }, 50001),
    /greater than the current outstanding balance/u,
  );
  assert.throws(
    () => calculateManualPayment({ total: 500, amountPaid: 500, balance: 0 }, 100),
    /already paid/u,
  );
  assert.throws(
    () => calculateManualPayment({ total: 500, amountPaid: 100, balance: 500 }, 100),
    /administrator review/u,
  );
});
