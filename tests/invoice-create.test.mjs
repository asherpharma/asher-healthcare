import assert from "node:assert/strict";
import test from "node:test";

import {
  invoiceCreatePayloadMaterial,
  invoiceCreateRequestMaterial,
  normalizeInvoiceCreateRequest,
  replayInvoiceCreateResult,
} from "../server/billing/invoice-create.js";

const requestId = "9cb95937-b1cd-4c31-a459-f65d99c64b38";

function validRequest(overrides = {}) {
  return {
    requestId,
    patientId: "patient_123",
    items: [
      { description: " Consultation fee ", quantity: 1, unitPrice: 500 },
      { description: "Vaccine", quantity: 2, unitPrice: 250.25 },
    ],
    discount: 0.5,
    notes: " Front desk invoice ",
    initialPayment: { amount: 250, method: "upi", reference: " UPI-123 " },
    ...overrides,
  };
}

test("normalizes exact invoice totals and optional initial payment", () => {
  const request = normalizeInvoiceCreateRequest(validRequest());
  assert.deepEqual(request.items, [
    { description: "Consultation fee", quantity: 1, unitPrice: 500, amount: 500 },
    { description: "Vaccine", quantity: 2, unitPrice: 250.25, amount: 500.5 },
  ]);
  assert.equal(request.subtotalPaise, 100050);
  assert.equal(request.discountPaise, 50);
  assert.equal(request.totalPaise, 100000);
  assert.deepEqual(request.initialPayment, {
    amount: 250,
    amountPaise: 25000,
    method: "upi",
    reference: "UPI-123",
  });
  assert.equal(request.notes, "Front desk invoice");
});

test("rejects invalid line data, excessive discounts, and overpayment", () => {
  assert.throws(
    () => normalizeInvoiceCreateRequest(validRequest({
      items: [{ description: "Consultation", quantity: 1.5, unitPrice: 500 }],
    })),
    /quantity must be a whole number/u,
  );
  assert.throws(
    () => normalizeInvoiceCreateRequest(validRequest({ discount: 1000.51 })),
    /greater than the subtotal/u,
  );
  assert.throws(
    () => normalizeInvoiceCreateRequest(validRequest({
      initialPayment: { amount: 1000.01, method: "cash", reference: "" },
    })),
    /greater than the invoice total/u,
  );
});

test("requires a fresh UUID, a valid patient, and 1 to 50 charges", () => {
  assert.throws(
    () => normalizeInvoiceCreateRequest(validRequest({ requestId: "retry-1" })),
    /fresh invoice request/u,
  );
  assert.throws(
    () => normalizeInvoiceCreateRequest(validRequest({ patientId: "patient/123" })),
    /valid active patient/u,
  );
  assert.throws(
    () => normalizeInvoiceCreateRequest(validRequest({ items: [] })),
    /between 1 and 50/u,
  );
});

test("request identity is actor-bound and payload material is normalized", () => {
  assert.notEqual(
    invoiceCreateRequestMaterial("staff-a", requestId),
    invoiceCreateRequestMaterial("staff-b", requestId),
  );
  const first = normalizeInvoiceCreateRequest(validRequest());
  const second = normalizeInvoiceCreateRequest(validRequest({ notes: "Front   desk invoice" }));
  assert.equal(invoiceCreatePayloadMaterial(first), invoiceCreatePayloadMaterial(second));
  assert.equal(invoiceCreatePayloadMaterial(first).includes("patientName"), false);
});

test("completed operations replay only for the same actor, request, and payload", () => {
  const result = { invoice: { id: "invoice-1", invoiceNumber: "ASH-1" }, payment: null };
  const operation = {
    actorUid: "staff-a",
    requestId,
    requestFingerprint: "fingerprint-a",
    status: "committed",
    result,
  };
  assert.deepEqual(replayInvoiceCreateResult(operation, {
    actorUid: "staff-a",
    requestId,
    requestFingerprint: "fingerprint-a",
  }), result);
  assert.throws(
    () => replayInvoiceCreateResult(operation, {
      actorUid: "staff-b",
      requestId,
      requestFingerprint: "fingerprint-a",
    }),
    /different details/u,
  );
  assert.throws(
    () => replayInvoiceCreateResult(operation, {
      actorUid: "staff-a",
      requestId,
      requestFingerprint: "fingerprint-b",
    }),
    /different details/u,
  );
});
