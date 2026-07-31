import { requireAdminStaff } from "../../../server/razorpay/firebase.js";
import {
  assertSameOrigin,
  errorResponse,
  HttpError,
  json,
  readJson,
} from "../../../server/razorpay/http.js";
import { initiateRefund } from "../../../server/razorpay/refunds.js";

export async function onRequestPost(context) {
  try {
    assertSameOrigin(context.request);
    const admin = await requireAdminStaff(context.request, context.env);
    const body = await readJson(context.request);
    if (body.confirmed !== true) {
      throw new HttpError(400, "Confirm the refund after reviewing its amount and reason.");
    }

    const refund = await initiateRefund(context.env, {
      requestId: body.requestId,
      invoiceId: body.invoiceId,
      paymentDocumentId: body.paymentDocumentId,
      amount: body.amount,
      reason: body.reason,
      admin,
    });
    return json({ refund });
  } catch (error) {
    return errorResponse(error);
  }
}
