import {
  assertActivePatientDocument,
  commitWrites,
  createDocumentWrite,
  getDocument,
  verifyDocumentWrite,
} from "../razorpay/firebase.js";
import { HttpError } from "../razorpay/http.js";
import { validDocumentId } from "../razorpay/payments.js";
import { clinicClock } from "../reception/workflow.js";

const MANUAL_METHODS = new Set(["cash", "upi", "card", "bank_transfer"]);
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function cleanText(value, field, maximum, { required = false } = {}) {
  if (typeof value !== "string") throw new HttpError(400, `${field} must be entered as text.`);
  const cleaned = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
  if (required && !cleaned) throw new HttpError(400, `${field} is required.`);
  if (Array.from(cleaned).length > maximum) {
    throw new HttpError(400, `${field} must be ${maximum} characters or fewer.`);
  }
  return cleaned;
}

function moneyPaise(value, field, { allowZero = true } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new HttpError(400, `${field} must be a valid amount.`);
  const paise = Math.round(number * 100);
  if (Math.abs(number * 100 - paise) > 0.000_001) {
    throw new HttpError(400, `${field} cannot have more than two decimal places.`);
  }
  if (paise < 0 || (!allowZero && paise === 0)) {
    throw new HttpError(400, `${field} must be ${allowZero ? "zero or more" : "greater than zero"}.`);
  }
  if (paise > 100_000_000_000) {
    throw new HttpError(400, `${field} is above the supported clinic billing limit.`);
  }
  return paise;
}

function normalizeLineItem(item, index) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new HttpError(400, `Charge ${index + 1} is invalid.`);
  }
  const description = cleanText(item.description, `Charge ${index + 1} description`, 120, {
    required: true,
  });
  const quantity = Number(item.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
    throw new HttpError(400, `Charge ${index + 1} quantity must be a whole number from 1 to 999.`);
  }
  const unitPricePaise = moneyPaise(item.unitPrice, `Charge ${index + 1} rate`);
  const amountPaise = quantity * unitPricePaise;
  return {
    description,
    quantity,
    unitPrice: unitPricePaise / 100,
    amount: amountPaise / 100,
    amountPaise,
  };
}

export function normalizeInvoiceCreateRequest(body = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Enter valid invoice details.");
  }
  const requestId = String(body.requestId ?? "").trim();
  const patientId = String(body.patientId ?? "").trim();
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    throw new HttpError(400, "Start a fresh invoice request and try again.");
  }
  if (!validDocumentId(patientId)) throw new HttpError(400, "Select a valid active patient.");
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50) {
    throw new HttpError(400, "Add between 1 and 50 invoice charges.");
  }

  const normalizedLineItems = body.items.map(normalizeLineItem);
  const normalizedItems = normalizedLineItems.map((item) => ({
    description: item.description,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    amount: item.amount,
  }));
  const subtotalPaise = normalizedLineItems.reduce((sum, item) => sum + item.amountPaise, 0);
  const discountPaise = moneyPaise(body.discount, "Discount");
  if (discountPaise > subtotalPaise) {
    throw new HttpError(400, "Discount cannot be greater than the subtotal.");
  }
  const totalPaise = subtotalPaise - discountPaise;
  if (totalPaise <= 0) {
    throw new HttpError(400, "The invoice total must be greater than zero.");
  }

  let initialPayment = null;
  if (body.initialPayment !== undefined && body.initialPayment !== null) {
    if (typeof body.initialPayment !== "object" || Array.isArray(body.initialPayment)) {
      throw new HttpError(400, "Enter valid initial payment details.");
    }
    const amountPaise = moneyPaise(
      body.initialPayment.amount,
      "Initial payment",
      { allowZero: false },
    );
    const method = String(body.initialPayment.method ?? "").trim();
    if (!MANUAL_METHODS.has(method)) {
      throw new HttpError(400, "Select cash, UPI, card, or bank transfer for the initial payment.");
    }
    const reference = cleanText(
      String(body.initialPayment.reference ?? ""),
      "Payment reference",
      100,
    );
    if (amountPaise > totalPaise) {
      throw new HttpError(400, "Initial payment cannot be greater than the invoice total.");
    }
    initialPayment = { amount: amountPaise / 100, amountPaise, method, reference };
  }

  return {
    requestId,
    patientId,
    items: normalizedItems,
    subtotal: subtotalPaise / 100,
    subtotalPaise,
    discount: discountPaise / 100,
    discountPaise,
    total: totalPaise / 100,
    totalPaise,
    notes: cleanText(String(body.notes ?? ""), "Billing note", 500),
    initialPayment,
  };
}

export function invoiceCreateRequestMaterial(actorUid, requestId) {
  return ["asher-invoice-request-v1", String(actorUid || ""), String(requestId || "")].join("\n");
}

export function invoiceCreatePayloadMaterial(request) {
  return JSON.stringify({
    patientId: request.patientId,
    items: request.items,
    subtotal: request.subtotal,
    discount: request.discount,
    total: request.total,
    notes: request.notes,
    initialPayment: request.initialPayment
      ? {
          amount: request.initialPayment.amount,
          method: request.initialPayment.method,
          reference: request.initialPayment.reference,
        }
      : null,
  });
}

export function replayInvoiceCreateResult(operation, {
  actorUid,
  requestId,
  requestFingerprint,
}) {
  if (!operation) return null;
  if (
    operation.actorUid !== actorUid
    || operation.requestId !== requestId
    || operation.requestFingerprint !== requestFingerprint
  ) {
    throw new HttpError(409, "This invoice request was already used for different details. Start a fresh request.");
  }
  if (operation.status !== "committed" || !operation.result?.invoice) {
    throw new HttpError(409, "This invoice is still being completed. Try again in a moment.");
  }
  return operation.result;
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function invoiceNumber(now, invoiceId) {
  return `ASH-${clinicClock(now).date.replaceAll("-", "")}-${invoiceId.slice(0, 8).toUpperCase()}`;
}

export async function createBillingInvoice(env, body, actor) {
  const request = normalizeInvoiceCreateRequest(body);
  if (
    !actor
    || !validDocumentId(actor.uid)
    || !["admin", "reception"].includes(actor.role)
    || typeof actor.staffUpdateTime !== "string"
  ) {
    throw new HttpError(403, "Only active administrators and reception staff can create invoices.");
  }

  const requestKey = await sha256Hex(invoiceCreateRequestMaterial(actor.uid, request.requestId));
  const requestPath = `billingInvoiceRequests/${requestKey}`;
  const requestFingerprint = await sha256Hex(invoiceCreatePayloadMaterial(request));

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const existingOperation = await getDocument(env, requestPath);
    const replay = replayInvoiceCreateResult(existingOperation?.data, {
      actorUid: actor.uid,
      requestId: request.requestId,
      requestFingerprint,
    });
    if (replay) return { ...replay, alreadyProcessed: true };

    const patientPath = `patients/${request.patientId}`;
    const patient = assertActivePatientDocument(
      await getDocument(env, patientPath),
      {
        missingMessage: "The selected patient record no longer exists.",
        archivedMessage: "The selected patient is archived. Restore the chart before creating an invoice.",
      },
    );
    const patientName = cleanText(patient.data.fullName, "Patient name", 100, { required: true });
    const patientPhone = cleanText(String(patient.data.phone ?? ""), "Patient phone", 20);
    const patientNumber = cleanText(
      String(patient.data.patientNumber || request.patientId),
      "Patient number",
      40,
      { required: true },
    );

    const now = new Date();
    const invoiceId = crypto.randomUUID().replaceAll("-", "");
    const number = invoiceNumber(now, invoiceId);
    const paidPaise = request.initialPayment?.amountPaise ?? 0;
    const balancePaise = request.totalPaise - paidPaise;
    const paymentStatus = paidPaise === 0 ? "unpaid" : balancePaise === 0 ? "paid" : "partial";
    const paymentId = request.initialPayment
      ? `initial_${crypto.randomUUID().replaceAll("-", "")}`
      : "";
    const invoiceDocument = {
      invoiceNumber: number,
      patientId: request.patientId,
      patientNumber,
      patientName,
      patientPhone,
      items: request.items,
      subtotal: request.subtotal,
      discount: request.discount,
      total: request.total,
      amountPaid: paidPaise / 100,
      balance: balancePaise / 100,
      paymentStatus,
      paymentMethod: request.initialPayment?.method ?? "not_recorded",
      paymentReference: request.initialPayment?.reference ?? "",
      notes: request.notes,
      createdBy: actor.uid,
      createdAt: now,
      updatedAt: now,
      paidAt: balancePaise === 0 ? now : null,
    };
    const invoice = { id: invoiceId, ...invoiceDocument };
    const payment = request.initialPayment
      ? {
          id: paymentId,
          requestId: request.requestId,
          invoiceId,
          invoiceNumber: number,
          patientId: request.patientId,
          patientName,
          amount: request.initialPayment.amount,
          method: request.initialPayment.method,
          reference: request.initialPayment.reference,
          source: "manual",
          status: "received",
          createdBy: actor.uid,
          createdByName: cleanText(String(actor.displayName || actor.email || "Clinic staff"), "Staff name", 100),
          createdAt: now,
        }
      : null;
    const result = { invoice, payment };

    const writes = [
      verifyDocumentWrite(env, `staff/${actor.uid}`, actor.staffUpdateTime),
      verifyDocumentWrite(env, patientPath, patient.updateTime),
      createDocumentWrite(env, `invoices/${invoiceId}`, invoiceDocument),
    ];
    if (payment) {
      const paymentDocument = Object.fromEntries(
        Object.entries(payment).filter(([field]) => field !== "id"),
      );
      writes.push(createDocumentWrite(
        env,
        `invoices/${invoiceId}/payments/${paymentId}`,
        paymentDocument,
      ));
    }
    writes.push(
      createDocumentWrite(env, `billingAuditLogs/invoice_${requestKey}`, {
        eventType: payment ? "invoice.created_with_payment" : "invoice.created",
        requestId: request.requestId,
        invoiceId,
        invoiceNumber: number,
        paymentId,
        patientId: request.patientId,
        patientName,
        subtotal: request.subtotal,
        discount: request.discount,
        total: request.total,
        amountPaid: paidPaise / 100,
        balance: balancePaise / 100,
        method: payment?.method ?? "not_recorded",
        reference: payment?.reference ?? "",
        actorUid: actor.uid,
        actorName: cleanText(String(actor.displayName || actor.email || "Clinic staff"), "Staff name", 100),
        createdAt: now,
      }),
      createDocumentWrite(env, requestPath, {
        requestId: request.requestId,
        requestFingerprint,
        actorUid: actor.uid,
        status: "committed",
        result,
        createdAt: now,
      }),
    );

    try {
      await commitWrites(env, writes);
      return { ...result, alreadyProcessed: false };
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 409) throw error;
      const committedOperation = await getDocument(env, requestPath);
      const committedReplay = replayInvoiceCreateResult(committedOperation?.data, {
        actorUid: actor.uid,
        requestId: request.requestId,
        requestFingerprint,
      });
      if (committedReplay) return { ...committedReplay, alreadyProcessed: true };
      if (attempt === 1) throw error;
    }
  }

  throw new HttpError(409, "The invoice changed while it was being created. Try again.");
}
