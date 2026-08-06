import { reverseManualPayment } from "../../../server/billing/reverse-payment.js";
import { requireAdminStaff } from "../../../server/razorpay/firebase.js";
import {
  assertSameOrigin,
  errorResponse,
  json,
  readJson,
} from "../../../server/razorpay/http.js";

export async function onRequestPost(context) {
  try {
    assertSameOrigin(context.request);
    const administrator = await requireAdminStaff(context.request, context.env);
    const reversal = await reverseManualPayment(
      context.env,
      await readJson(context.request),
      administrator,
    );
    return json({ reversal });
  } catch (error) {
    return errorResponse(error);
  }
}
