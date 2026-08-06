import {
  assertActivePatientDocument,
  commitWrites,
  createDocumentWrite,
  getDocument,
  updateDocumentWrite,
  verifyDocumentWrite,
} from "../razorpay/firebase.js";
import { HttpError } from "../razorpay/http.js";
import { toPaise, validDocumentId } from "../razorpay/payments.js";

const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MANUAL_METHODS = new Set(["cash", "upi", "card", "bank_transfer"]);

function cleanText(value, maximumLength) {
  const text = String(value ?? "").trim();
  if (text.length > maximumLength) {
    throw new HttpError(400, `Keep the correction reason within ${maximumLength} characters.`);
  }
  return text;
}

export function normalizeManualPaymentReversalRequest(body = {}) {
  const requestId = String(body.requestId ?? "").trim().toLowerCase();
  const invoiceId = String(body.invoiceId ?? "").trim();
  const paymentId = String(body.paymentId ?? "").trim();
  const reason = cleanText(body.reason, 300);

  if (!REQUEST_ID_PATTERN.test(requestId)) {
    throw new HttpError(400, "Start a fresh payment correction and try again.");
  }
  if (!validDocumentId(invoiceId) || !validDocumentId(paymentId)) {
    throw new HttpError(400, "Choose a valid manual payment to correct.");
  }
  if (reason.length < 5) {
    throw new HttpError(400, "Enter a clear correction reason of at least 5 characters.");
  }

  return { requestId, invoiceId, paymentId, reason };
}

export function manualPaymentReversalMaterial(actorUid, requestId) {
  return [
    "asher-manual-payment-reversal-v1",
    String(actorUid || ""),
    String(requestId || "").toLowerCase(),
  ].join("\n");
}

export function calculateManualPaymentReversal(invoice = {}, payment = {}) {
  if (payment.source !== "manual") {
    throw new HttpError(400, "Razorpay payments must be corrected through the refund workflow.");
  }
  if (!MANUAL_METHODS.has(payment.method)) {
    throw new HttpError(409, "This manual payment method needs administrator review before correction.");
  }
  if (payment.status !== "received") {
    throw new HttpError(409, "This manual payment was already corrected.");
  }
  if (toPaise(payment.refundedAmount || 0) !== 0) {
    throw new HttpError(409, "This payment ledger needs administrator review before correction.");
  }

  const total = Number(invoice.total);
  const amountPaid = Number(invoice.amountPaid);
  const balance = Number(invoice.balance);
  const paymentAmount = Number(payment.amount);
  const totalPaise = toPaise(total);
  const amountPaidPaise = toPaise(amountPaid);
  const balancePaise = toPaise(balance);
  const paymentPaise = toPaise(paymentAmount);

  if (
    !Number.isFinite(total)
    || !Number.isFinite(amountPaid)
    || !Number.isFinite(balance)
    || !Number.isFinite(paymentAmount)
    || totalPaise <= 0
    || amountPaidPaise <= 0
    || balancePaise < 0
    || paymentPaise <= 0
    || amountPaidPaise > totalPaise
    || balancePaise > totalPaise
    || totalPaise - amountPaidPaise !== balancePaise
    || paymentPaise > amountPaidPaise
  ) {
    throw new HttpError(409, "The invoice and payment totals need administrator review before correction.");
  }

  const nextAmountPaidPaise = amountPaidPaise - paymentPaise;
  const nextBalancePaise = totalPaise - nextAmountPaidPaise;
  return {
    reversedAmount: paymentPaise / 100,
    amountPaid: nextAmountPaidPaise / 100,
    balance: nextBalancePaise / 100,
    paymentStatus: nextAmountPaidPaise === 0 ? "unpaid" : "partial",
    // A reversal can make a different historical row the latest active
    // payment. Use a neutral summary rather than leaving the reversed method
    // and reference on the invoice; the immutable ledger remains authoritative.
    paymentMethod: "not_recorded",
    paymentReference: "",
    paidAt: null,
  };
}

function completedReversalResult(operation, { alreadyProcessed }) {
  return {
    requestId: operation.requestId,
    invoiceId: operation.invoiceId,
    invoiceNumber: operation.invoiceNumber,
    paymentId: operation.paymentId,
    amount: Number(operation.amount || 0),
    paymentStatus: operation.paymentStatus,
    alreadyProcessed,
  };
}

export function assertMatchingManualReversalReplay(operation, input, administrator) {
  const matches = (
    operation.status === "completed"
    && operation.requestId === input.requestId
    && operation.invoiceId === input.invoiceId
    && operation.paymentId === input.paymentId
    && operation.reason === input.reason
    && operation.actorUid === administrator.uid
  );
  if (!matches) {
    throw new HttpError(409, "This correction request has already been used. Start a fresh correction.");
  }
  return completedReversalResult(operation, { alreadyProcessed: true });
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function reverseManualPayment(env, body, administrator) {
  if (!administrator || administrator.role !== "admin" || !validDocumentId(administrator.uid)) {
    throw new HttpError(403, "Only a clinic administrator can correct a payment.");
  }
  const input = normalizeManualPaymentReversalRequest(body);
  const operationId = await sha256Hex(
    manualPaymentReversalMaterial(administrator.uid, input.requestId),
  );
  const operationPath = `billingReversalOperations/${operationId}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const existingOperation = await getDocument(env, operationPath);
    if (existingOperation) {
      return assertMatchingManualReversalReplay(
        existingOperation.data,
        input,
        administrator,
      );
    }

    const staffPath = `staff/${administrator.uid}`;
    const invoicePath = `invoices/${input.invoiceId}`;
    const paymentPath = `${invoicePath}/payments/${input.paymentId}`;
    const [staff, invoice, payment] = await Promise.all([
      getDocument(env, staffPath),
      getDocument(env, invoicePath),
      getDocument(env, paymentPath),
    ]);

    if (!staff || staff.data.active !== true || staff.data.role !== "admin") {
      throw new HttpError(403, "This administrator account is no longer active.");
    }
    if (!invoice || !payment) {
      throw new HttpError(404, "The invoice or manual payment could not be found.");
    }
    if (payment.data.invoiceId !== input.invoiceId) {
      throw new HttpError(409, "This payment does not belong to the selected invoice.");
    }

    const patientId = String(invoice.data.patientId || "").trim();
    if (!validDocumentId(patientId) || payment.data.patientId !== patientId) {
      throw new HttpError(409, "The invoice and payment patient links need administrator review.");
    }
    const patientPath = `patients/${patientId}`;
    const patient = assertActivePatientDocument(
      await getDocument(env, patientPath),
      {
        missingMessage: "The patient linked to this payment no longer exists.",
        archivedMessage: "Restore this patient before correcting a payment.",
      },
    );
    const next = calculateManualPaymentReversal(invoice.data, payment.data);
    const now = new Date();
    const auditId = `reversal_${operationId}`;
    const actorName = String(
      administrator.displayName || administrator.email || "Clinic administrator",
    ).trim().slice(0, 100);
    const invoiceNumber = String(invoice.data.invoiceNumber || "").trim().slice(0, 40);
    const patientName = String(
      invoice.data.patientName || patient.data.fullName || "Patient",
    ).trim().slice(0, 100);
    const operation = {
      operationId,
      requestId: input.requestId,
      status: "completed",
      invoiceId: input.invoiceId,
      invoiceNumber,
      paymentId: input.paymentId,
      patientId,
      patientName,
      amount: next.reversedAmount,
      paymentStatus: next.paymentStatus,
      reason: input.reason,
      actorUid: administrator.uid,
      actorName,
      completedAt: now,
      createdAt: now,
    };

    try {
      await commitWrites(env, [
        verifyDocumentWrite(env, staffPath, staff.updateTime),
        verifyDocumentWrite(env, patientPath, patient.updateTime),
        updateDocumentWrite(
          env,
          invoicePath,
          {
            amountPaid: next.amountPaid,
            balance: next.balance,
            paymentStatus: next.paymentStatus,
            paymentMethod: next.paymentMethod,
            paymentReference: next.paymentReference,
            paidAt: next.paidAt,
            updatedAt: now,
          },
          [
            "amountPaid",
            "balance",
            "paymentStatus",
            "paymentMethod",
            "paymentReference",
            "paidAt",
            "updatedAt",
          ],
          invoice.updateTime,
        ),
        updateDocumentWrite(
          env,
          paymentPath,
          {
            status: "reversed",
            reversedAt: now,
            reversedBy: administrator.uid,
            reversalReason: input.reason,
            auditLogId: auditId,
            reversalOperationId: operationId,
            updatedAt: now,
          },
          [
            "status",
            "reversedAt",
            "reversedBy",
            "reversalReason",
            "auditLogId",
            "reversalOperationId",
            "updatedAt",
          ],
          payment.updateTime,
        ),
        createDocumentWrite(env, `billingAuditLogs/${auditId}`, {
          eventType: "payment.reversed",
          requestId: input.requestId,
          operationId,
          invoiceId: input.invoiceId,
          invoiceNumber,
          paymentId: input.paymentId,
          patientId,
          patientName,
          amount: next.reversedAmount,
          method: payment.data.method,
          source: "manual",
          reason: input.reason,
          actorUid: administrator.uid,
          actorName,
          createdAt: now,
        }),
        createDocumentWrite(env, operationPath, operation),
      ]);
      return completedReversalResult(operation, { alreadyProcessed: false });
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 409 || attempt === 1) {
        throw error;
      }
    }
  }

  throw new HttpError(409, "The billing ledger changed while the payment was being corrected. Refresh and try again.");
}
