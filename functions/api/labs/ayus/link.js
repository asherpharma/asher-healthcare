import {
  linkAyusLabNumber,
  readAyusLabLink,
} from "../../../../server/labs/ayus-link.js";
import { requireActiveStaff } from "../../../../server/razorpay/firebase.js";
import {
  assertSameOrigin,
  errorResponse,
  json,
  readJson,
} from "../../../../server/razorpay/http.js";

export async function onRequestGet(context) {
  try {
    assertSameOrigin(context.request);
    const staff = await requireActiveStaff(context.request, context.env);
    const labOrderId = new URL(context.request.url).searchParams.get("labOrderId") || "";
    return json(await readAyusLabLink(context.env, labOrderId, staff));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function onRequestPost(context) {
  try {
    assertSameOrigin(context.request);
    const staff = await requireActiveStaff(context.request, context.env);
    const result = await linkAyusLabNumber(
      context.env,
      await readJson(context.request),
      staff,
    );
    return json(result, result.alreadyLinked ? 200 : 201);
  } catch (error) {
    return errorResponse(error);
  }
}
