import { recordLabReportAccess } from "../../../server/labs/report-access.js";
import { requireActiveStaff } from "../../../server/razorpay/firebase.js";
import {
  fetchLabReportObject,
  patientReportStreamResponse,
} from "../../../server/storage/report-objects.js";
import {
  assertSameOrigin,
  errorResponse,
  readJson,
} from "../../../server/razorpay/http.js";

export async function onRequestPost(context) {
  try {
    assertSameOrigin(context.request);
    const staff = await requireActiveStaff(context.request, context.env);
    const result = await recordLabReportAccess(
      context.env,
      await readJson(context.request),
      staff,
    );
    const reportObject = await fetchLabReportObject(
      context.env,
      result.storagePath,
      result.patientId,
    );
    return patientReportStreamResponse(reportObject, result.action);
  } catch (error) {
    return errorResponse(error);
  }
}
