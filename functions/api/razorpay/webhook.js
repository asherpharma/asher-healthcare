import { errorResponse, HttpError, json, requireEnvironment } from "../../../server/razorpay/http.js";
import { finalizePayment, finalizeQrPayment } from "../../../server/razorpay/payments.js";
import { verifyWebhookSignature } from "../../../server/razorpay/razorpay.js";

export async function onRequestPost(context) {
  try {
    requireEnvironment(context.env, ["RAZORPAY_WEBHOOK_SECRET"]);
    const signature = context.request.headers.get("X-Razorpay-Signature") || "";
    const rawBody = await context.request.text();
    if (!signature || rawBody.length > 100_000) {
      throw new HttpError(400, "Invalid Razorpay webhook.");
    }
    if (!await verifyWebhookSignature(context.env, rawBody, signature)) {
      throw new HttpError(400, "Invalid Razorpay webhook signature.");
    }

    const event = JSON.parse(rawBody);
    if (event.event === "qr_code.credited") {
      const payment = event.payload?.payment?.entity;
      const qrCode = event.payload?.qr_code?.entity;
      if (!payment?.id || !qrCode?.id) {
        throw new HttpError(400, "The QR webhook did not include a payment and QR code.");
      }
      const result = await finalizeQrPayment(context.env, {
        qrId: qrCode.id,
        paymentId: payment.id,
        actorUid: "razorpay:webhook",
      });
      return json({ received: true, ...result });
    }

    if (event.event !== "payment.captured") {
      return json({ received: true, ignored: true });
    }
    const payment = event.payload?.payment?.entity;
    if (!payment?.id) {
      throw new HttpError(400, "The webhook did not include a payment.");
    }
    if (!payment.order_id) {
      return json({ received: true, ignored: true });
    }

    const result = await finalizePayment(context.env, {
      orderId: payment.order_id,
      paymentId: payment.id,
      actorUid: "razorpay:webhook",
    });
    return json({ received: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
