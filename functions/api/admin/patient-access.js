import {
  adminPortalDirectory,
  provisionPortalAccount,
  resendPortalInvitation,
  revokePortalAccess,
} from "../../../server/patients/portal-access.js";
import { requireAdminStaff } from "../../../server/razorpay/firebase.js";
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
    const administrator = await requireAdminStaff(context.request, context.env);
    const body = await readJson(context.request, 20_000);
    const action = String(body?.action || "").trim();
    if (action === "list") {
      return json({ accounts: await adminPortalDirectory(context.env, administrator) });
    }
    if (action === "provision") {
      return json(await provisionPortalAccount(context.env, body, administrator), 201);
    }
    if (action === "revoke") {
      return json(await revokePortalAccess(context.env, body, administrator));
    }
    if (action === "resend") {
      return json(await resendPortalInvitation(context.env, body, administrator));
    }
    throw new HttpError(400, "Choose a valid patient portal access action.");
  } catch (error) {
    return errorResponse(error);
  }
}

export function onRequestGet() {
  return json({ error: "Patient portal access accepts secure requests only." }, 405);
}
