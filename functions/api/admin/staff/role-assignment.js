import { requireAdminStaff } from "../../../../server/razorpay/firebase.js";
import {
  assertSameOrigin,
  errorResponse,
  json,
  readJson,
} from "../../../../server/razorpay/http.js";
import { setStaffRoleAssignment } from "../../../../server/staff/role-assignment.js";

export async function onRequestPost(context) {
  try {
    assertSameOrigin(context.request);
    const administrator = await requireAdminStaff(context.request, context.env);
    const body = await readJson(context.request);
    const result = await setStaffRoleAssignment(
      context.env,
      body,
      administrator,
    );
    return json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
