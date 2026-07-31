import {
  commitWrites,
  createDocumentWrite,
  getDocument,
  updateDocumentWrite,
} from "./firebase.js";
import { HttpError } from "./http.js";
import {
  captureRazorpayPayment,
  fetchRazorpayPayment,
} from "./razorpay.js";

export function toPaise(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100);
}

export function validDocumentId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(value);
}

export async function finalizePayment(env, { orderId, paymentId, actorUid }) {
  const orderPath = `paymentOrders/${orderId}`;
  let paymentOrder = await getDocument(env, orderPath);
  if (!paymentOrder) throw new HttpError(404, "The Razorpay order is not registered with this clinic.");

  if (paymentOrder.data.status === "verified") {
    if (paymentOrder.data.paymentId !== paymentId) {
      throw new HttpError(409, "This Razorpay order was already completed with another payment.");
    }
    return {
      alreadyProcessed: true,
      invoiceId: paymentOrder.data.invoiceId,
      invoiceNumber: paymentOrder.data.invoiceNumber,
      amount: paymentOrder.data.amount,
      appliedAmount: paymentOrder.data.appliedAmount ?? paymentOrder.data.amount,
      overpaymentAmount: paymentOrder.data.overpaymentAmount ?? 0,
    };
  }

  let gatewayPayment = await fetchRazorpayPayment(env, paymentId);
  if (gatewayPayment.order_id !== orderId) {
    throw new HttpError(400, "The payment does not belong to this Razorpay order.");
  }
  if (
    gatewayPayment.amount !== paymentOrder.data.amountPaise
    || gatewayPayment.currency !== "INR"
  ) {
    throw new HttpError(400, "The captured payment amount does not match the clinic invoice.");
  }

  if (gatewayPayment.status === "authorized") {
    gatewayPayment = await captureRazorpayPayment(
      env,
      paymentId,
      paymentOrder.data.amountPaise,
    );
  }
  if (gatewayPayment.status !== "captured" || gatewayPayment.captured !== true) {
    throw new HttpError(409, "The payment is not captured yet. Retry verification in a moment.");
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const invoiceId = paymentOrder.data.invoiceId;
    const invoicePath = `invoices/${invoiceId}`;
    const invoice = await getDocument(env, invoicePath);
    if (!invoice) throw new HttpError(404, "The invoice linked to this payment no longer exists.");

    const paidPaise = Number(paymentOrder.data.amountPaise);
    const currentBalancePaise = Math.max(0, toPaise(invoice.data.balance));
    const appliedPaise = Math.min(paidPaise, currentBalancePaise);
    const overpaymentPaise = Math.max(0, paidPaise - appliedPaise);
    const newBalancePaise = Math.max(0, currentBalancePaise - appliedPaise);
    const totalPaise = toPaise(invoice.data.total);
    const newAmountPaidPaise = Math.max(0, totalPaise - newBalancePaise);
    const now = new Date();
    const paymentPath = `invoices/${invoiceId}/payments/${paymentId}`;
    const invoiceUpdate = {
      amountPaid: newAmountPaidPaise / 100,
      balance: newBalancePaise / 100,
      paymentStatus: newBalancePaise === 0 ? "paid" : "partial",
      paymentMethod: "online",
      paymentReference: paymentId,
      updatedAt: now,
      ...(newBalancePaise === 0 ? { paidAt: now } : {}),
    };
    const invoiceFields = [
      "amountPaid",
      "balance",
      "paymentStatus",
      "paymentMethod",
      "paymentReference",
      "updatedAt",
      ...(newBalancePaise === 0 ? ["paidAt"] : []),
    ];
    const paymentRecord = {
      invoiceId,
      invoiceNumber: paymentOrder.data.invoiceNumber,
      patientId: invoice.data.patientId,
      patientName: invoice.data.patientName,
      amount: paidPaise / 100,
      appliedAmount: appliedPaise / 100,
      overpaymentAmount: overpaymentPaise / 100,
      method: "online",
      reference: paymentId,
      source: "gateway",
      status: "received",
      gatewayPaymentId: paymentId,
      gatewayOrderId: orderId,
      createdBy: actorUid,
      createdAt: now,
    };
    const paymentOrderUpdate = {
      status: "verified",
      paymentId,
      appliedAmount: appliedPaise / 100,
      overpaymentAmount: overpaymentPaise / 100,
      verifiedBy: actorUid,
      verifiedAt: now,
    };

    try {
      await commitWrites(env, [
        updateDocumentWrite(
          env,
          invoicePath,
          invoiceUpdate,
          invoiceFields,
          invoice.updateTime,
        ),
        createDocumentWrite(env, paymentPath, paymentRecord),
        updateDocumentWrite(
          env,
          orderPath,
          paymentOrderUpdate,
          Object.keys(paymentOrderUpdate),
          paymentOrder.updateTime,
        ),
      ]);
      return {
        alreadyProcessed: false,
        invoiceId,
        invoiceNumber: paymentOrder.data.invoiceNumber,
        amount: paidPaise / 100,
        appliedAmount: appliedPaise / 100,
        overpaymentAmount: overpaymentPaise / 100,
      };
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 409 || attempt === 1) {
        throw error;
      }
      paymentOrder = await getDocument(env, orderPath);
      if (paymentOrder?.data.status === "verified" && paymentOrder.data.paymentId === paymentId) {
        return {
          alreadyProcessed: true,
          invoiceId: paymentOrder.data.invoiceId,
          invoiceNumber: paymentOrder.data.invoiceNumber,
          amount: paymentOrder.data.amount,
          appliedAmount: paymentOrder.data.appliedAmount ?? paymentOrder.data.amount,
          overpaymentAmount: paymentOrder.data.overpaymentAmount ?? 0,
        };
      }
    }
  }

  throw new HttpError(409, "Payment was captured but the invoice update needs to be retried.");
}

export async function finalizeQrPayment(env, { qrId, paymentId, actorUid }) {
  const qrPath = `paymentQrCodes/${qrId}`;
  let paymentQr = await getDocument(env, qrPath);
  if (!paymentQr) {
    throw new HttpError(404, "This payment QR is not registered with the clinic.");
  }

  if (paymentQr.data.status === "verified") {
    if (paymentQr.data.paymentId !== paymentId) {
      throw new HttpError(409, "This payment QR was already completed with another payment.");
    }
    return {
      alreadyProcessed: true,
      invoiceId: paymentQr.data.invoiceId,
      invoiceNumber: paymentQr.data.invoiceNumber,
      paymentId,
      amount: paymentQr.data.amount,
      appliedAmount: paymentQr.data.appliedAmount ?? paymentQr.data.amount,
      overpaymentAmount: paymentQr.data.overpaymentAmount ?? 0,
    };
  }

  let gatewayPayment = await fetchRazorpayPayment(env, paymentId);
  if (
    gatewayPayment.amount !== paymentQr.data.amountPaise
    || gatewayPayment.currency !== "INR"
  ) {
    throw new HttpError(400, "The QR payment amount does not match the clinic invoice.");
  }

  if (gatewayPayment.status === "authorized") {
    gatewayPayment = await captureRazorpayPayment(
      env,
      paymentId,
      paymentQr.data.amountPaise,
    );
  }
  if (gatewayPayment.status !== "captured" || gatewayPayment.captured !== true) {
    throw new HttpError(409, "The QR payment is not captured yet. Retry in a moment.");
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const invoiceId = paymentQr.data.invoiceId;
    const invoicePath = `invoices/${invoiceId}`;
    const invoice = await getDocument(env, invoicePath);
    if (!invoice) {
      throw new HttpError(404, "The invoice linked to this payment no longer exists.");
    }

    const paidPaise = Number(paymentQr.data.amountPaise);
    const currentBalancePaise = Math.max(0, toPaise(invoice.data.balance));
    const appliedPaise = Math.min(paidPaise, currentBalancePaise);
    const overpaymentPaise = Math.max(0, paidPaise - appliedPaise);
    const newBalancePaise = Math.max(0, currentBalancePaise - appliedPaise);
    const totalPaise = toPaise(invoice.data.total);
    const newAmountPaidPaise = Math.max(0, totalPaise - newBalancePaise);
    const now = new Date();
    const paymentPath = `invoices/${invoiceId}/payments/${paymentId}`;
    const invoiceUpdate = {
      amountPaid: newAmountPaidPaise / 100,
      balance: newBalancePaise / 100,
      paymentStatus: newBalancePaise === 0 ? "paid" : "partial",
      paymentMethod: "online",
      paymentReference: paymentId,
      updatedAt: now,
      ...(newBalancePaise === 0 ? { paidAt: now } : {}),
    };
    const invoiceFields = [
      "amountPaid",
      "balance",
      "paymentStatus",
      "paymentMethod",
      "paymentReference",
      "updatedAt",
      ...(newBalancePaise === 0 ? ["paidAt"] : []),
    ];
    const paymentRecord = {
      invoiceId,
      invoiceNumber: paymentQr.data.invoiceNumber,
      patientId: invoice.data.patientId,
      patientName: invoice.data.patientName,
      amount: paidPaise / 100,
      appliedAmount: appliedPaise / 100,
      overpaymentAmount: overpaymentPaise / 100,
      method: "online",
      reference: paymentId,
      source: "gateway",
      status: "received",
      gatewayPaymentId: paymentId,
      gatewayQrId: qrId,
      createdBy: actorUid,
      createdAt: now,
    };
    const qrUpdate = {
      status: "verified",
      paymentId,
      appliedAmount: appliedPaise / 100,
      overpaymentAmount: overpaymentPaise / 100,
      verifiedBy: actorUid,
      verifiedAt: now,
    };

    try {
      await commitWrites(env, [
        updateDocumentWrite(
          env,
          invoicePath,
          invoiceUpdate,
          invoiceFields,
          invoice.updateTime,
        ),
        createDocumentWrite(env, paymentPath, paymentRecord),
        updateDocumentWrite(
          env,
          qrPath,
          qrUpdate,
          Object.keys(qrUpdate),
          paymentQr.updateTime,
        ),
      ]);
      return {
        alreadyProcessed: false,
        invoiceId,
        invoiceNumber: paymentQr.data.invoiceNumber,
        paymentId,
        amount: paidPaise / 100,
        appliedAmount: appliedPaise / 100,
        overpaymentAmount: overpaymentPaise / 100,
      };
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 409 || attempt === 1) {
        throw error;
      }
      paymentQr = await getDocument(env, qrPath);
      if (paymentQr?.data.status === "verified" && paymentQr.data.paymentId === paymentId) {
        return {
          alreadyProcessed: true,
          invoiceId: paymentQr.data.invoiceId,
          invoiceNumber: paymentQr.data.invoiceNumber,
          paymentId,
          amount: paymentQr.data.amount,
          appliedAmount: paymentQr.data.appliedAmount ?? paymentQr.data.amount,
          overpaymentAmount: paymentQr.data.overpaymentAmount ?? 0,
        };
      }
    }
  }

  throw new HttpError(409, "QR payment was captured but the invoice update needs to be retried.");
}
