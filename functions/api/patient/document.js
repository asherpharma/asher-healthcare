import { recordPortalDocumentAccess } from "../../../server/patients/portal-document-access.js";
import { requireActivePatient } from "../../../server/patients/portal-access.js";
import {
  assertSameOrigin,
  errorResponse,
  json,
  readJson,
} from "../../../server/razorpay/http.js";

export async function onRequestPost(context) {
  try {
    assertSameOrigin(context.request);
    const account = await requireActivePatient(context.request, context.env);
    return json(await recordPortalDocumentAccess(
      context.env,
      await readJson(context.request, 4_000),
      account,
    ));
  } catch (error) {
    return errorResponse(error);
  }
}

export function onRequestGet() {
  return json({ error: "Patient documents accept secure requests only." }, 405);
}

