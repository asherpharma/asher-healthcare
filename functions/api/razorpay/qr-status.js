import {
  assertBillingStaff,
  getDocument,
  requireActiveStaff,
} from "../../../server/razorpay/firebase.js";
import {
  assertSameOrigin,
  errorResponse,
  HttpError,
  json,
  readJson,
} from "../../../server/razorpay/http.js";
import { finalizeQrPayment, toPaise } from "../../../server/razorpay/payments.js";
import {
  fetchRazorpayQrCode,
  fetchRazorpayQrCodePayments,
} from "../../../server/razorpay/razorpay.js";

function validQrId(value) {
  return typeof value === "string"
    && value.startsWith("qr_")
    && /^[A-Za-z0-9_]+$/u.test(value)
    && value.length <= 100;
}

export async function onRequestPost(context) {
  try {
    assertSameOrigin(context.request);
    const staff = assertBillingStaff(
      await requireActiveStaff(context.request, context.env),
    );
    const body = await readJson(context.request);
    if (!validQrId(body.qrId)) {
      throw new HttpError(400, "This payment QR is not valid.");
    }

    const localQr = await getDocument(context.env, `paymentQrCodes/${body.qrId}`);
    if (!localQr) throw new HttpError(404, "This payment QR is not registered with the clinic.");
    if (localQr.data.status === "verified") {
      return json({
        status: "paid",
        paymentId: localQr.data.paymentId,
        invoiceId: localQr.data.invoiceId,
        invoiceNumber: localQr.data.invoiceNumber,
        amount: localQr.data.amount,
      });
    }

    const gatewayQr = await fetchRazorpayQrCode(context.env, body.qrId);
    if (Number(gatewayQr.payments_count_received || 0) > 0) {
      const collection = await fetchRazorpayQrCodePayments(context.env, body.qrId);
      const payment = collection.items?.find((item) =>
        item.status === "captured"
        && item.captured === true
        && item.currency === "INR"
        && item.amount === toPaise(localQr.data.amount),
      );
      if (payment) {
        const result = await finalizeQrPayment(context.env, {
          qrId: body.qrId,
          paymentId: payment.id,
          actorUid: staff.uid,
        });
        return json({ status: "paid", ...result });
      }
    }

    const expired = gatewayQr.status === "closed" || Number(localQr.data.closeBy || 0) * 1000 <= Date.now();
    return json({
      status: expired ? "expired" : "pending",
      expiresAt: Number(localQr.data.closeBy || 0) * 1000,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
