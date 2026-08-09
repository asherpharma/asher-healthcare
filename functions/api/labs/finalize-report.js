import { finalizeLabReport } from "../../../server/labs/finalize-report.js";
import { requireActiveStaff } from "../../../server/razorpay/firebase.js";
import {
  assertSameOrigin,
  errorResponse,
  json,
  readJson,
} from "../../../server/razorpay/http.js";

export async function onRequestPost(context) {
  try {
    assertSameOrigin(context.request);
    const staff = await requireActiveStaff(context.request, context.env);
    const result = await finalizeLabReport(
      context.env,
      await readJson(context.request),
      staff,
    );
    return json(result, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
