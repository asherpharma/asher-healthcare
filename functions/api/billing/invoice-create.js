import { createBillingInvoice } from "../../../server/billing/invoice-create.js";
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

export async function onRequestPost(context) {
  try {
    assertSameOrigin(context.request);
    const authenticated = await requireActiveStaff(context.request, context.env);
    const staffPath = `staff/${authenticated.uid}`;
    const staffDocument = await getDocument(context.env, staffPath);
    if (!staffDocument || staffDocument.data.active !== true) {
      throw new HttpError(403, "This staff account is no longer active.");
    }
    const actor = assertBillingStaff({
      uid: authenticated.uid,
      email: authenticated.email,
      displayName: String(
        staffDocument.data.displayName || authenticated.displayName || authenticated.email || "Clinic staff",
      ),
      role: staffDocument.data.role,
      staffUpdateTime: staffDocument.updateTime,
    });
    const result = await createBillingInvoice(
      context.env,
      await readJson(context.request),
      actor,
    );
    return json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
