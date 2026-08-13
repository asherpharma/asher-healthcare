import {
  claimPortalInvitation,
  portalDashboard,
  requireActivePatient,
  verifyPatientFirebaseUser,
} from "../../../server/patients/portal-access.js";
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
    const body = await readJson(context.request, 2_000);
    const action = String(body?.action || "").trim();
    if (action === "claim") {
      const user = await verifyPatientFirebaseUser(context.request, context.env);
      return json(await claimPortalInvitation(context.env, user));
    }
    if (action === "dashboard") {
      const account = await requireActivePatient(context.request, context.env);
      return json(await portalDashboard(context.env, account));
    }
    throw new HttpError(400, "Choose a valid patient portal action.");
  } catch (error) {
    return errorResponse(error);
  }
}

export function onRequestGet() {
  return json({ error: "The patient portal accepts secure requests only." }, 405);
}

