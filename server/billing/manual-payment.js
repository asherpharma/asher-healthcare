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

const MANUAL_METHODS = new Set(["cash", "upi", "card", "bank_transfer"]);
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function safeText(value, maximumLength) {
  return String(value ?? "").trim().slice(0, maximumLength);
}

export function normalizeManualPaymentRequest(body = {}) {
  const requestId = String(body.requestId ?? "").trim();
  const invoiceId = String(body.invoiceId ?? "").trim();
  const method = safeText(body.method, 32);
  const reference = String(body.reference ?? "").trim();
  const rawAmount = Number(body.amount);
  const amountPaise = toPaise(rawAmount);

  if (!REQUEST_ID_PATTERN.test(requestId)) {
    throw new HttpError(400, "Start a fresh payment attempt and try again.");
  }
  if (!validDocumentId(invoiceId)) {
    throw new HttpError(400, "Select a valid clinic invoice.");
  }
  if (!Number.isFinite(rawAmount) || amountPaise <= 0) {
    throw new HttpError(400, "Enter a payment amount greater than zero.");
  }
  if (Math.abs(rawAmount * 100 - amountPaise) > 0.000_001) {
    throw new HttpError(400, "Enter the payment amount with no more than two decimal places.");
  }
  if (!MANUAL_METHODS.has(method)) {
    throw new HttpError(400, "Select cash, UPI, card, or bank transfer.");
  }
  if (reference.length > 100) {
    throw new HttpError(400, "Keep the payment reference within 100 characters.");
  }

  return {
    requestId,
    invoiceId,
    amount: amountPaise / 100,
    amountPaise,
    method,
    reference,
  };
}

export function calculateManualPayment(invoice = {}, amountPaise) {
  const total = Number(invoice.total);
  const amountPaid = Number(invoice.amountPaid);
  const balance = Number(invoice.balance);
  const totalPaise = toPaise(invoice.total);
  const amountPaidPaise = toPaise(invoice.amountPaid);
  const balancePaise = toPaise(invoice.balance);

  if (
    !Number.isFinite(total)
    || !Number.isFinite(amountPaid)
    || !Number.isFinite(balance)
    || totalPaise <= 0
    || amountPaidPaise < 0
    || balancePaise < 0
    || amountPaidPaise > totalPaise
    || balancePaise > totalPaise
    || totalPaise - amountPaidPaise !== balancePaise
  ) {
    throw new HttpError(409, "This invoice total needs administrator review before another payment can be recorded.");
  }
  if (balancePaise === 0) {
    throw new HttpError(409, "This invoice is already paid.");
  }
  if (amountPaise > balancePaise) {
    throw new HttpError(400, "The payment cannot be greater than the current outstanding balance.");
  }

  const nextAmountPaidPaise = amountPaidPaise + amountPaise;
  const nextBalancePaise = balancePaise - amountPaise;
  return {
    amountPaid: nextAmountPaidPaise / 100,
    balance: nextBalancePaise / 100,
    paymentStatus: nextBalancePaise === 0 ? "paid" : "partial",
  };
}

function completedPaymentResult(payment, { alreadyProcessed }) {
  return {
    requestId: payment.requestId,
    paymentId: payment.requestId,
    invoiceId: payment.invoiceId,
    invoiceNumber: payment.invoiceNumber,
    patientId: payment.patientId,
    patientName: payment.patientName,
    amount: Number(payment.amount || 0),
    method: payment.method,
    reference: payment.reference || "",
    alreadyProcessed,
  };
}

function assertMatchingReplay(payment, input, staff) {
  const isSameOperation = (
    payment.requestId === input.requestId
    && payment.invoiceId === input.invoiceId
    && toPaise(payment.amount) === input.amountPaise
    && payment.method === input.method
    && String(payment.reference || "") === input.reference
    && payment.source === "manual"
    && payment.createdBy === staff.uid
  );
  if (!isSameOperation) {
    throw new HttpError(409, "This payment request has already been used. Start a fresh payment attempt.");
  }
  if (payment.status !== "received") {
    throw new HttpError(409, "This payment was later corrected. Start a fresh payment attempt if another payment is due.");
  }
  return completedPaymentResult(payment, { alreadyProcessed: true });
}

export async function recordManualPayment(env, body, staff) {
  if (
    !staff
    || !validDocumentId(staff.uid)
    || !["admin", "reception"].includes(staff.role)
    || typeof staff.staffUpdateTime !== "string"
    || staff.staffUpdateTime.length === 0
  ) {
    throw new HttpError(403, "This staff account is not authorized to record manual payments.");
  }
  const input = normalizeManualPaymentRequest(body);
  const paymentPath = `invoices/${input.invoiceId}/payments/${input.requestId}`;
  const auditPath = `billingAuditLogs/manual_${input.requestId}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const existingPayment = await getDocument(env, paymentPath);
    if (existingPayment) {
      return assertMatchingReplay(existingPayment.data, input, staff);
    }

    const invoicePath = `invoices/${input.invoiceId}`;
    const invoice = await getDocument(env, invoicePath);
    if (!invoice) throw new HttpError(404, "This invoice could not be found.");

    const patientId = String(invoice.data.patientId ?? "").trim();
    if (!validDocumentId(patientId)) {
      throw new HttpError(409, "This invoice is not linked to a valid patient record.");
    }
    const patientPath = `patients/${patientId}`;
    const patient = assertActivePatientDocument(
      await getDocument(env, patientPath),
      {
        missingMessage: "The patient record linked to this invoice no longer exists. Restore or correct it before recording payment.",
        archivedMessage: "The patient record linked to this invoice is archived. Restore it before recording payment.",
      },
    );
    const next = calculateManualPayment(invoice.data, input.amountPaise);
    const now = new Date();
    const invoiceUpdate = {
      ...next,
      paymentMethod: input.method,
      paymentReference: input.reference,
      updatedAt: now,
      paidAt: next.balance === 0 ? now : null,
    };
    const payment = {
      requestId: input.requestId,
      invoiceId: input.invoiceId,
      invoiceNumber: safeText(invoice.data.invoiceNumber, 40),
      patientId,
      patientName: safeText(invoice.data.patientName || patient.data.fullName, 100),
      amount: input.amount,
      method: input.method,
      reference: input.reference,
      source: "manual",
      status: "received",
      createdBy: staff.uid,
      createdByName: safeText(staff.displayName || staff.email || "Clinic staff", 100),
      createdAt: now,
    };

    try {
      await commitWrites(env, [
        verifyDocumentWrite(env, `staff/${staff.uid}`, staff.staffUpdateTime),
        verifyDocumentWrite(env, patientPath, patient.updateTime),
        updateDocumentWrite(
          env,
          invoicePath,
          invoiceUpdate,
          [
            "amountPaid",
            "balance",
            "paymentStatus",
            "paymentMethod",
            "paymentReference",
            "updatedAt",
            "paidAt",
          ],
          invoice.updateTime,
        ),
        createDocumentWrite(env, paymentPath, payment),
        createDocumentWrite(env, auditPath, {
          eventType: "payment.received_manual",
          requestId: input.requestId,
          invoiceId: input.invoiceId,
          invoiceNumber: payment.invoiceNumber,
          paymentId: input.requestId,
          patientId,
          patientName: payment.patientName,
          amount: input.amount,
          method: input.method,
          source: "manual",
          reference: input.reference,
          actorUid: staff.uid,
          actorName: payment.createdByName,
          createdAt: now,
        }),
      ]);
      return completedPaymentResult(payment, { alreadyProcessed: false });
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 409 || attempt === 1) {
        throw error;
      }
    }
  }

  throw new HttpError(409, "The invoice changed while payment was being recorded. Refresh and try again.");
}
