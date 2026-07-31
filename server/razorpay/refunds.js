import {
  commitWrites,
  createDocumentWrite,
  getDocument,
  updateDocumentWrite,
} from "./firebase.js";
import { HttpError } from "./http.js";
import { toPaise, validDocumentId } from "./payments.js";
import { createRazorpayRefund } from "./razorpay.js";

function validGatewayId(value, prefix) {
  return typeof value === "string"
    && value.startsWith(prefix)
    && /^[A-Za-z0-9_]+$/u.test(value)
    && value.length <= 100;
}

function safeText(value, maximum = 300) {
  return String(value || "").trim().slice(0, maximum);
}

function refundReference(refund) {
  const acquirer = refund?.acquirer_data || {};
  return safeText(acquirer.arn || acquirer.rrn || acquirer.utr || "", 100);
}

export function refundOperationResult(operation) {
  return {
    requestId: operation.requestId,
    refundId: operation.refundId || "",
    invoiceId: operation.invoiceId,
    invoiceNumber: operation.invoiceNumber,
    paymentId: operation.gatewayPaymentId,
    amount: Number(operation.amount || 0),
    status: operation.status,
    reference: operation.reference || "",
    message: operation.status === "processed"
      ? "Razorpay accepted and processed the refund."
      : operation.status === "failed"
        ? "Razorpay could not process this refund."
        : operation.status === "initiating"
          ? "The refund request is being securely reconciled with Razorpay."
          : "Razorpay accepted the refund and processing is pending.",
  };
}

async function markInitiationFailed(env, requestId, message) {
  const operationPath = `refundOperations/${requestId}`;
  const operation = await getDocument(env, operationPath);
  if (!operation || operation.data.status !== "initiating") return;

  const paymentPath = `invoices/${operation.data.invoiceId}/payments/${operation.data.paymentDocumentId}`;
  const payment = await getDocument(env, paymentPath);
  if (!payment) return;

  const now = new Date();
  await commitWrites(env, [
    updateDocumentWrite(
      env,
      operationPath,
      {
        status: "failed",
        errorMessage: safeText(message, 300),
        failedAt: now,
        updatedAt: now,
      },
      ["status", "errorMessage", "failedAt", "updatedAt"],
      operation.updateTime,
    ),
    updateDocumentWrite(
      env,
      paymentPath,
      {
        refundStatus: "failed",
        activeRefundOperationId: "",
        lastRefundError: safeText(message, 300),
        updatedAt: now,
      },
      ["refundStatus", "activeRefundOperationId", "lastRefundError", "updatedAt"],
      payment.updateTime,
    ),
  ]);
}

export async function reconcileRefund(env, { requestId, refund, actorUid }) {
  if (!validDocumentId(requestId)) throw new HttpError(400, "The refund request is invalid.");
  if (!validGatewayId(refund?.id, "rfnd_") || !validGatewayId(refund?.payment_id, "pay_")) {
    throw new HttpError(400, "Razorpay returned an invalid refund record.");
  }
  if (!Number.isInteger(refund.amount) || refund.amount <= 0 || refund.currency !== "INR") {
    throw new HttpError(400, "Razorpay returned an invalid refund amount.");
  }
  if (!["pending", "processed", "failed"].includes(refund.status)) {
    throw new HttpError(409, "Razorpay has not assigned a final refund state yet.");
  }

  const operationPath = `refundOperations/${requestId}`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const operation = await getDocument(env, operationPath);
    if (!operation) throw new HttpError(404, "This refund operation is not registered with the clinic.");
    if (operation.data.status === "processed") return refundOperationResult(operation.data);
    if (operation.data.gatewayPaymentId !== refund.payment_id || Number(operation.data.amountPaise) !== refund.amount) {
      throw new HttpError(409, "The Razorpay refund does not match the clinic request.");
    }

    const invoicePath = `invoices/${operation.data.invoiceId}`;
    const paymentPath = `invoices/${operation.data.invoiceId}/payments/${operation.data.paymentDocumentId}`;
    const [invoice, payment] = await Promise.all([
      getDocument(env, invoicePath),
      getDocument(env, paymentPath),
    ]);
    if (!invoice || !payment) throw new HttpError(404, "The invoice or payment linked to this refund no longer exists.");

    const now = new Date();
    const reference = refundReference(refund);
    const commonOperation = {
      refundId: refund.id,
      status: refund.status,
      reference,
      speedRequested: safeText(refund.speed_requested || "normal", 20),
      speedProcessed: safeText(refund.speed_processed || "", 20),
      updatedAt: now,
    };
    const commonOperationFields = [
      "refundId",
      "status",
      "reference",
      "speedRequested",
      "speedProcessed",
      "updatedAt",
    ];

    try {
      if (refund.status === "pending") {
        await commitWrites(env, [
          updateDocumentWrite(
            env,
            operationPath,
            commonOperation,
            commonOperationFields,
            operation.updateTime,
          ),
          updateDocumentWrite(
            env,
            paymentPath,
            {
              refundStatus: "pending",
              activeRefundOperationId: requestId,
              lastRefundId: refund.id,
              lastRefundAt: now,
              updatedAt: now,
            },
            ["refundStatus", "activeRefundOperationId", "lastRefundId", "lastRefundAt", "updatedAt"],
            payment.updateTime,
          ),
        ]);
        return refundOperationResult({ ...operation.data, ...commonOperation });
      }

      if (refund.status === "failed") {
        const errorMessage = "Razorpay reported that the refund failed.";
        const operationUpdate = {
          ...commonOperation,
          errorMessage,
          failedAt: now,
        };
        await commitWrites(env, [
          updateDocumentWrite(
            env,
            operationPath,
            operationUpdate,
            [...commonOperationFields, "errorMessage", "failedAt"],
            operation.updateTime,
          ),
          updateDocumentWrite(
            env,
            paymentPath,
            {
              refundStatus: "failed",
              activeRefundOperationId: "",
              lastRefundId: refund.id,
              lastRefundAt: now,
              lastRefundError: errorMessage,
              updatedAt: now,
            },
            ["refundStatus", "activeRefundOperationId", "lastRefundId", "lastRefundAt", "lastRefundError", "updatedAt"],
            payment.updateTime,
          ),
        ]);
        return refundOperationResult({ ...operation.data, ...operationUpdate });
      }

      const refundAmount = refund.amount / 100;
      const paymentAmount = Number(payment.data.amount || 0);
      const priorRefunded = Number(payment.data.refundedAmount || 0);
      const newRefundedAmount = Math.min(paymentAmount, priorRefunded + refundAmount);
      const appliedAmount = Number(payment.data.appliedAmount ?? paymentAmount);
      const priorRefundedApplied = Number(payment.data.refundedAppliedAmount || 0);
      const overpaymentAmount = Math.max(0, paymentAmount - appliedAmount);
      const accountingRefund = Math.min(
        Number(invoice.data.amountPaid || 0),
        Math.max(0, appliedAmount - priorRefundedApplied),
        Math.max(0, newRefundedAmount - overpaymentAmount)
          - Math.max(0, priorRefunded - overpaymentAmount),
      );
      const newAmountPaid = Math.max(0, Number(invoice.data.amountPaid || 0) - accountingRefund);
      const newBalance = Math.max(0, Number(invoice.data.total || 0) - newAmountPaid);
      const invoicePaymentStatus = newBalance === 0 ? "paid" : newAmountPaid === 0 ? "unpaid" : "partial";
      const paymentStatus = newRefundedAmount >= paymentAmount ? "refunded" : "received";
      const operationUpdate = {
        ...commonOperation,
        processedBy: actorUid,
        processedAt: now,
        accountingRefundAmount: accountingRefund,
      };

      await commitWrites(env, [
        updateDocumentWrite(
          env,
          invoicePath,
          {
            amountPaid: newAmountPaid,
            balance: newBalance,
            paymentStatus: invoicePaymentStatus,
            paymentMethod: newAmountPaid === 0 ? "not_recorded" : invoice.data.paymentMethod,
            paymentReference: newAmountPaid === 0 ? "" : String(invoice.data.paymentReference || ""),
            paidAt: newBalance === 0 ? invoice.data.paidAt || now : null,
            updatedAt: now,
          },
          ["amountPaid", "balance", "paymentStatus", "paymentMethod", "paymentReference", "paidAt", "updatedAt"],
          invoice.updateTime,
        ),
        updateDocumentWrite(
          env,
          paymentPath,
          {
            status: paymentStatus,
            refundedAmount: newRefundedAmount,
            refundedAppliedAmount: priorRefundedApplied + accountingRefund,
            refundStatus: "processed",
            activeRefundOperationId: "",
            lastRefundId: refund.id,
            lastRefundAt: now,
            lastRefundError: "",
            updatedAt: now,
          },
          [
            "status",
            "refundedAmount",
            "refundedAppliedAmount",
            "refundStatus",
            "activeRefundOperationId",
            "lastRefundId",
            "lastRefundAt",
            "lastRefundError",
            "updatedAt",
          ],
          payment.updateTime,
        ),
        updateDocumentWrite(
          env,
          operationPath,
          operationUpdate,
          [...commonOperationFields, "processedBy", "processedAt", "accountingRefundAmount"],
          operation.updateTime,
        ),
        createDocumentWrite(env, `billingAuditLogs/${requestId}`, {
          eventType: "payment.refunded",
          invoiceId: operation.data.invoiceId,
          invoiceNumber: operation.data.invoiceNumber,
          paymentId: operation.data.paymentDocumentId,
          gatewayPaymentId: operation.data.gatewayPaymentId,
          refundId: refund.id,
          patientId: operation.data.patientId,
          patientName: operation.data.patientName,
          amount: refundAmount,
          accountingRefundAmount: accountingRefund,
          reason: operation.data.reason,
          reference,
          actorUid: operation.data.createdBy,
          actorName: operation.data.createdByName,
          processedBy: actorUid,
          createdAt: now,
        }),
      ]);
      return refundOperationResult({ ...operation.data, ...operationUpdate });
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 409 || attempt === 1) throw error;
    }
  }

  throw new HttpError(409, "The refund changed while it was being reconciled. Try again.");
}

export async function initiateRefund(env, {
  requestId,
  invoiceId,
  paymentDocumentId,
  amount,
  reason,
  admin,
}) {
  if (!validDocumentId(requestId) || !validDocumentId(invoiceId) || !validDocumentId(paymentDocumentId)) {
    throw new HttpError(400, "Select a valid Razorpay payment to refund.");
  }
  const cleanReason = safeText(reason, 300);
  if (cleanReason.length < 5) throw new HttpError(400, "Enter a clear refund reason of at least 5 characters.");

  const operationPath = `refundOperations/${requestId}`;
  const existing = await getDocument(env, operationPath);
  if (existing) return refundOperationResult(existing.data);

  const invoicePath = `invoices/${invoiceId}`;
  const paymentPath = `invoices/${invoiceId}/payments/${paymentDocumentId}`;
  const [invoice, payment] = await Promise.all([
    getDocument(env, invoicePath),
    getDocument(env, paymentPath),
  ]);
  if (!invoice || !payment) throw new HttpError(404, "The invoice or payment could not be found.");
  if (payment.data.invoiceId !== invoiceId || payment.data.source !== "gateway") {
    throw new HttpError(400, "Only verified Razorpay payments can be refunded online.");
  }
  const gatewayPaymentId = payment.data.gatewayPaymentId || payment.data.reference || paymentDocumentId;
  if (!validGatewayId(gatewayPaymentId, "pay_")) throw new HttpError(400, "This payment has no valid Razorpay reference.");
  if (payment.data.activeRefundOperationId) {
    throw new HttpError(409, "A refund is already being processed for this payment.");
  }

  const amountPaise = toPaise(amount);
  const capturedPaise = toPaise(payment.data.amount);
  const refundedPaise = toPaise(payment.data.refundedAmount || 0);
  const refundablePaise = Math.max(0, capturedPaise - refundedPaise);
  if (amountPaise <= 0 || amountPaise > refundablePaise) {
    throw new HttpError(400, "Enter a refund amount above zero and not above the refundable balance.");
  }

  const now = new Date();
  const operation = {
    requestId,
    refundId: "",
    invoiceId,
    invoiceNumber: invoice.data.invoiceNumber,
    paymentDocumentId,
    gatewayPaymentId,
    patientId: invoice.data.patientId,
    patientName: invoice.data.patientName,
    amount: amountPaise / 100,
    amountPaise,
    currency: "INR",
    reason: cleanReason,
    status: "initiating",
    reference: "",
    speedRequested: "normal",
    speedProcessed: "",
    createdBy: admin.uid,
    createdByName: safeText(admin.displayName || admin.email || "Clinic administrator", 100),
    createdAt: now,
    updatedAt: now,
  };

  await commitWrites(env, [
    createDocumentWrite(env, operationPath, operation),
    updateDocumentWrite(
      env,
      paymentPath,
      {
        refundStatus: "initiating",
        activeRefundOperationId: requestId,
        refundRequestedAmount: amountPaise / 100,
        refundRequestedAt: now,
        refundRequestedBy: admin.uid,
        updatedAt: now,
      },
      [
        "refundStatus",
        "activeRefundOperationId",
        "refundRequestedAmount",
        "refundRequestedAt",
        "refundRequestedBy",
        "updatedAt",
      ],
      payment.updateTime,
    ),
  ]);

  let gatewayRefund;
  try {
    gatewayRefund = await createRazorpayRefund(env, gatewayPaymentId, {
      amount: amountPaise,
      speed: "normal",
      receipt: `ASH-RF-${requestId.replaceAll("-", "").slice(0, 24)}`,
      notes: {
        request_id: requestId,
        invoice_id: invoiceId,
        invoice_number: safeText(invoice.data.invoiceNumber, 40),
        reason: cleanReason.slice(0, 256),
      },
    });
  } catch (error) {
    // Only release the payment lock after a definite gateway rejection. A
    // timeout or 5xx response is ambiguous: Razorpay may have accepted the
    // refund, so the status endpoint must reconcile it before another attempt.
    if (error instanceof HttpError && error.status === 400) {
      try {
        await markInitiationFailed(env, requestId, error.message);
      } catch (reconciliationError) {
        console.error("Refund failure reconciliation error", reconciliationError);
      }
    }
    throw error;
  }

  return reconcileRefund(env, {
    requestId,
    refund: gatewayRefund,
    actorUid: admin.uid,
  });
}
