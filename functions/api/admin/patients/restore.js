import {
  commitWrites,
  createDocumentWrite,
  getDocument,
  requireAdminStaff,
  updateDocumentWrite,
  verifyDocumentWrite,
} from "../../../../server/razorpay/firebase.js";
import {
  assertSameOrigin,
  errorResponse,
  HttpError,
  json,
  readJson,
} from "../../../../server/razorpay/http.js";
import { patientsForDateOfBirth } from "../../../../server/reception/firestore-query.js";
import {
  exactReceptionPatientIdentity,
  normalizeReceptionName,
  normalizeReceptionPhone,
  receptionIdentityMaterial,
} from "../../../../server/reception/workflow.js";

function validPatientId(value) {
  return /^[A-Za-z0-9_-]{1,128}$/u.test(value);
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function onRequestPost(context) {
  try {
    assertSameOrigin(context.request);
    const administrator = await requireAdminStaff(context.request, context.env);
    const body = await readJson(context.request);
    const patientId = String(body.patientId || "").trim();
    const reason = String(body.reason || "Restored by clinic administrator").trim();

    if (!validPatientId(patientId)) {
      throw new HttpError(400, "Choose a valid patient record.");
    }
    if (reason.length < 3 || reason.length > 300) {
      throw new HttpError(400, "Add a brief restore note of no more than 300 characters.");
    }

    const patientPath = `patients/${patientId}`;
    const patient = await getDocument(context.env, patientPath);
    if (!patient) {
      throw new HttpError(404, "This patient record could not be found.");
    }
    if (patient.data.archived !== true) {
      throw new HttpError(409, "This patient record is already active.");
    }

    const now = new Date();
    const auditId = crypto.randomUUID();
    const normalizedName = normalizeReceptionName(patient.data.fullName);
    const normalizedPhone = normalizeReceptionPhone(patient.data.phone);
    const dateOfBirth = String(patient.data.dateOfBirth || "");
    const gender = String(patient.data.gender || "").toLowerCase();
    const hasCanonicalIdentity = Boolean(
      normalizedName.length >= 2
      && normalizedPhone
      && /^\d{4}-\d{2}-\d{2}$/u.test(dateOfBirth)
      && ["female", "male", "other"].includes(gender),
    );
    const identityWrites = [];
    let identityReboundFromPatientId = "";

    if (hasCanonicalIdentity) {
      const registrationIdentity = {
        normalizedName,
        normalizedPhone,
        dateOfBirth,
        gender,
      };
      const otherActiveMatch = (await patientsForDateOfBirth(context.env, dateOfBirth))
        .filter((candidate) => candidate.id !== patientId)
        .find((candidate) => (
          candidate.data.archived !== true
          && exactReceptionPatientIdentity(candidate.data, registrationIdentity)
        ));
      if (otherActiveMatch) {
        throw new HttpError(
          409,
          `Another active chart has the same identity (${otherActiveMatch.data.patientNumber || "existing patient"}). Keep this duplicate archived or resolve it before restoring.`,
        );
      }

      const identityKey = await sha256Hex(receptionIdentityMaterial(registrationIdentity));
      const identityPath = `patientIdentityKeys/${identityKey}`;
      const identity = await getDocument(context.env, identityPath);
      if (!identity) {
        identityWrites.push(createDocumentWrite(context.env, identityPath, {
          patientId,
          version: 2,
          createdBy: administrator.uid,
          createdAt: now,
        }));
      } else if (identity.data.patientId !== patientId) {
        const reservedPatientId = String(identity.data.patientId || "");
        const reservedPatient = validPatientId(reservedPatientId)
          ? await getDocument(context.env, `patients/${reservedPatientId}`)
          : null;
        if (!reservedPatient || reservedPatient.data.archived !== true) {
          throw new HttpError(
            409,
            "This identity is reserved by another active or unresolved patient chart. Keep this duplicate archived and ask an administrator to review it.",
          );
        }
        identityReboundFromPatientId = reservedPatientId;
        identityWrites.push(
          verifyDocumentWrite(
            context.env,
            `patients/${reservedPatientId}`,
            reservedPatient.updateTime,
          ),
          updateDocumentWrite(
            context.env,
            identityPath,
            {
              patientId,
              version: 2,
              reboundFromPatientId: reservedPatientId,
              reboundBy: administrator.uid,
              reboundAt: now,
            },
            [
              "patientId",
              "version",
              "reboundFromPatientId",
              "reboundBy",
              "reboundAt",
            ],
            identity.updateTime,
          ),
        );
      } else {
        // Keep the canonical identity ownership stable throughout the restore.
        // Without this precondition, a concurrent restore could rebind the key
        // to another archived duplicate while this patient is being activated.
        identityWrites.push(
          verifyDocumentWrite(context.env, identityPath, identity.updateTime),
        );
      }
    }

    await commitWrites(context.env, [
      updateDocumentWrite(
        context.env,
        patientPath,
        {
          archived: false,
          archivedAt: null,
          archivedBy: "",
          archiveReason: "",
          restoredAt: now,
          restoredBy: administrator.uid,
          restoreReason: reason,
          updatedAt: now,
        },
        [
          "archived",
          "archivedAt",
          "archivedBy",
          "archiveReason",
          "restoredAt",
          "restoredBy",
          "restoreReason",
          "updatedAt",
        ],
        patient.updateTime,
      ),
      ...identityWrites,
      createDocumentWrite(context.env, `auditLogs/${auditId}`, {
        eventType: "patient.restored",
        category: "patient_lifecycle",
        patientId,
        patientNumber: String(patient.data.patientNumber || patientId),
        patientName: String(patient.data.fullName || "Patient"),
        actorUid: administrator.uid,
        actorName: administrator.displayName,
        actorRole: administrator.role,
        identityReboundFromPatientId,
        reason,
        createdAt: now,
      }),
    ]);

    return json({ patientId, archived: false, restoredAt: now.toISOString() });
  } catch (error) {
    return errorResponse(error);
  }
}
