import { recordPatientReportAccess } from "../../../server/patients/report-access.js";
import { requireActiveStaff } from "../../../server/razorpay/firebase.js";
import {
  assertSameOrigin,
  errorResponse,
  readJson,
} from "../../../server/razorpay/http.js";
import {
  fetchPatientReportObject,
  patientReportStreamResponse,
} from "../../../server/storage/report-objects.js";

export async function onRequestPost(context) {
  try {
    assertSameOrigin(context.request);
    const staff = await requireActiveStaff(context.request, context.env);
    const result = await recordPatientReportAccess(
      context.env,
      await readJson(context.request),
      staff,
    );
    const reportObject = await fetchPatientReportObject(
      context.env,
      result.storagePath,
      result.patientId,
    );
    return patientReportStreamResponse(reportObject, result.action);
  } catch (error) {
    return errorResponse(error);
  }
}
