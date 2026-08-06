import { patientDirectoryForStaff } from "../../../../server/patients/directory.js";
import { requireActiveStaff } from "../../../../server/razorpay/firebase.js";
import {
  assertSameOrigin,
  errorResponse,
  json,
} from "../../../../server/razorpay/http.js";

export async function onRequestGet(context) {
  try {
    assertSameOrigin(context.request);
    const staff = await requireActiveStaff(context.request, context.env);
    const url = new URL(context.request.url);
    const includeArchived = url.searchParams.get("includeArchived") === "1";
    const patients = await patientDirectoryForStaff(context.env, staff, { includeArchived });
    return json({ patients });
  } catch (error) {
    return errorResponse(error);
  }
}
