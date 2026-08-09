import { reconcileLabReportFinalization } from "../../../../server/labs/reconcile-finalization.js";
import { requireAdminStaff } from "../../../../server/razorpay/firebase.js";
import {
  assertSameOrigin,
  errorResponse,
  json,
  readJson,
} from "../../../../server/razorpay/http.js";

export async function onRequestPost(context) {
  try {
    assertSameOrigin(context.request);
    const administrator = await requireAdminStaff(context.request, context.env);
    const result = await reconcileLabReportFinalization(
      context.env,
      await readJson(context.request),
      administrator,
    );
    return json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
