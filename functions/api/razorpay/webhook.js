import { errorResponse, HttpError, json, requireEnvironment } from "../../../server/razorpay/http.js";
import { finalizePayment } from "../../../server/razorpay/payments.js";
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
    if (event.event !== "payment.captured") {
      return json({ received: true, ignored: true });
    }
    const payment = event.payload?.payment?.entity;
    if (!payment?.id || !payment?.order_id) {
      throw new HttpError(400, "The webhook did not include a payment and order.");
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
