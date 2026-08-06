import { recordManualPayment } from "../../../server/billing/manual-payment.js";
import {
  assertBillingStaff,
  requireActiveStaff,
} from "../../../server/razorpay/firebase.js";
import {
  assertSameOrigin,
  errorResponse,
  json,
  readJson,
} from "../../../server/razorpay/http.js";

export async function onRequestPost(context) {
  try {
    assertSameOrigin(context.request);
    const staff = assertBillingStaff(
      await requireActiveStaff(context.request, context.env),
    );
    const payment = await recordManualPayment(
      context.env,
      await readJson(context.request),
      staff,
    );
    return json({ payment });
  } catch (error) {
    return errorResponse(error);
  }
}
