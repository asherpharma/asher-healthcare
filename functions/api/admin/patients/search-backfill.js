import { requireAdminStaff } from "../../../../server/razorpay/firebase.js";
import {
  assertSameOrigin,
  errorResponse,
  json,
  readJson,
} from "../../../../server/razorpay/http.js";
import { backfillPatientSearchBatch } from "../../../../server/patients/search-backfill.js";

export async function onRequestPost(context) {
  try {
    assertSameOrigin(context.request);
    const administrator = await requireAdminStaff(context.request, context.env);
    const body = await readJson(context.request);
    const result = await backfillPatientSearchBatch(
      context.env,
      administrator,
      String(body?.pageToken || ""),
    );
    return json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
