import { requireActiveStaff } from "../../../server/razorpay/firebase.js";
import {
  assertSameOrigin,
  errorResponse,
  HttpError,
  json,
  readJson,
} from "../../../server/razorpay/http.js";
import { finalizePayment } from "../../../server/razorpay/payments.js";
import { verifyCheckoutSignature } from "../../../server/razorpay/razorpay.js";

function validGatewayId(value, prefix) {
  return typeof value === "string"
    && value.startsWith(prefix)
    && /^[A-Za-z0-9_]+$/u.test(value)
    && value.length <= 100;
}

export async function onRequestPost(context) {
  try {
    assertSameOrigin(context.request);
    const staff = await requireActiveStaff(context.request, context.env);
    const body = await readJson(context.request);
    const orderId = body.razorpay_order_id;
    const paymentId = body.razorpay_payment_id;
    const signature = body.razorpay_signature;
    if (
      !validGatewayId(orderId, "order_")
      || !validGatewayId(paymentId, "pay_")
      || typeof signature !== "string"
      || !/^[a-f0-9]{64}$/iu.test(signature)
    ) {
      throw new HttpError(400, "Razorpay returned an invalid payment confirmation.");
    }

    const signatureIsValid = await verifyCheckoutSignature(
      context.env,
      orderId,
      paymentId,
      signature,
    );
    if (!signatureIsValid) {
      throw new HttpError(400, "The Razorpay payment signature could not be verified.");
    }

    const result = await finalizePayment(context.env, {
      orderId,
      paymentId,
      actorUid: staff.uid,
    });
    return json({ verified: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
