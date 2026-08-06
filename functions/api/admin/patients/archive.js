import {
  commitWrites,
  createDocumentWrite,
  getDocument,
  requireAdminStaff,
  updateDocumentWrite,
} from "../../../../server/razorpay/firebase.js";
import {
  assertSameOrigin,
  errorResponse,
  HttpError,
  json,
  readJson,
} from "../../../../server/razorpay/http.js";

function validPatientId(value) {
  return /^[A-Za-z0-9_-]{1,128}$/u.test(value);
}

export async function onRequestPost(context) {
  try {
    assertSameOrigin(context.request);
    const administrator = await requireAdminStaff(context.request, context.env);
    const body = await readJson(context.request);
    const patientId = String(body.patientId || "").trim();
    const reason = String(body.reason || "").trim();

    if (!validPatientId(patientId)) {
      throw new HttpError(400, "Choose a valid patient record.");
    }
    if (reason.length < 8 || reason.length > 300) {
      throw new HttpError(400, "Add a brief archive reason between 8 and 300 characters.");
    }

    const patientPath = `patients/${patientId}`;
    const patient = await getDocument(context.env, patientPath);
    if (!patient) {
      throw new HttpError(404, "This patient record could not be found.");
    }
    if (patient.data.archived === true) {
      throw new HttpError(409, "This patient record is already archived.");
    }

    const now = new Date();
    const auditId = crypto.randomUUID();
    await commitWrites(context.env, [
      updateDocumentWrite(
        context.env,
        patientPath,
        {
          archived: true,
          archivedAt: now,
          archivedBy: administrator.uid,
          archiveReason: reason,
          updatedAt: now,
        },
        ["archived", "archivedAt", "archivedBy", "archiveReason", "updatedAt"],
        patient.updateTime,
      ),
      createDocumentWrite(context.env, `auditLogs/${auditId}`, {
        eventType: "patient.archived",
        category: "patient_lifecycle",
        patientId,
        patientNumber: String(patient.data.patientNumber || patientId),
        patientName: String(patient.data.fullName || "Patient"),
        actorUid: administrator.uid,
        actorName: administrator.displayName,
        actorRole: administrator.role,
        reason,
        createdAt: now,
      }),
    ]);

    return json({ patientId, archived: true, archivedAt: now.toISOString() });
  } catch (error) {
    return errorResponse(error);
  }
}
