import { recordPortalReportAccess } from "../../../server/patients/portal-report-access.js";
import { requireActivePatient } from "../../../server/patients/portal-access.js";
import {
  assertSameOrigin,
  errorResponse,
  HttpError,
  json,
  readJson,
} from "../../../server/razorpay/http.js";
import {
  fetchLabReportObject,
  patientReportStreamResponse,
} from "../../../server/storage/report-objects.js";

export async function handlePatientReport(context, dependencies = {}) {
  const requireAccount = dependencies.requireAccount || requireActivePatient;
  const authorize = dependencies.authorize || recordPortalReportAccess;
  const fetchObject = dependencies.fetchObject || fetchLabReportObject;
  try {
    assertSameOrigin(context.request);
    const body = await readJson(context.request, 4_000);
    const account = await requireAccount(context.request, context.env);
    const initial = await authorize(
      context.env,
      body,
      account,
      { audit: false },
    );
    const report = await fetchObject(context.env, initial.storagePath, initial.patientId);
    const bufferedBody = await new Response(report.body).arrayBuffer();
    if (bufferedBody.byteLength !== Number(report.size)) {
      throw new HttpError(503, "This report file could not be verified completely.");
    }
    const finalAccount = await requireAccount(context.request, context.env);
    const finalAuthorization = await authorize(context.env, body, finalAccount);
    if (
      finalAuthorization.patientId !== initial.patientId
      || finalAuthorization.storagePath !== initial.storagePath
      || finalAuthorization.action !== initial.action
    ) throw new HttpError(404, "This patient document is not available.");
    return patientReportStreamResponse({ ...report, body: bufferedBody }, finalAuthorization.action);
  } catch (error) {
    return errorResponse(error);
  }
}

export function onRequestPost(context) {
  return handlePatientReport(context);
}

export function onRequestGet() {
  return json({ error: "Patient reports accept secure requests only." }, 405);
}
