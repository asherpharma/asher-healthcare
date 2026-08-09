import { labOrderDirectoryForStaff } from "../../../../server/labs/directory.js";
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
    const directory = await labOrderDirectoryForStaff(context.env, staff);
    return json(directory);
  } catch (error) {
    return errorResponse(error);
  }
}
