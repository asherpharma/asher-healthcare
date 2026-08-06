import {
  commitWrites,
  createDocumentWrite,
  documentName,
  getDocument,
  requireActiveStaff,
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
  receptionIdentityMaterial,
} from "../../../../server/reception/workflow.js";
import {
  canonicalPatientIdentity,
  validatePatientProfileUpdate,
} from "../../../../server/patients/profile.js";

function validPatientId(value) {
  return /^[A-Za-z0-9_-]{1,128}$/u.test(value);
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function verifyAbsentDocumentWrite(env, path) {
  return {
    verify: documentName(env, path),
    currentDocument: { exists: false },
  };
}

function deleteDocumentWrite(env, path, updateTime) {
  return {
    delete: documentName(env, path),
    currentDocument: { updateTime },
  };
}

function responsePatient(patientId, patient, updates, includeClinical) {
  const merged = { ...patient, ...updates };
  const result = {
    id: patientId,
    patientNumber: String(merged.patientNumber || patientId),
    fullName: String(merged.fullName || "Patient"),
    phone: String(merged.phone || ""),
    dateOfBirth: String(merged.dateOfBirth || ""),
    gender: String(merged.gender || ""),
    doctorId: String(merged.doctorId || ""),
    doctorName: String(merged.doctorName || ""),
    caseType: String(merged.caseType || ""),
    specialty: String(merged.specialty || ""),
    consultationFee: Number(merged.consultationFee || 0),
    address: String(merged.address || ""),
  };
  if (!includeClinical) return result;
  return {
    ...result,
    allergies: String(merged.allergies || ""),
    medicalHistory: String(merged.medicalHistory || ""),
  };
}

export async function onRequestPost(context) {
  try {
    assertSameOrigin(context.request);
    const authenticatedStaff = await requireActiveStaff(context.request, context.env);
    const staffPath = `staff/${authenticatedStaff.uid}`;
    const staffDocument = await getDocument(context.env, staffPath);
    const latestRole = String(staffDocument?.data?.role || "");
    if (
      !staffDocument
      || staffDocument.data.active !== true
      || !["admin", "reception", "doctor"].includes(latestRole)
    ) {
      throw new HttpError(403, "This staff account is no longer active.");
    }
    const actor = {
      ...authenticatedStaff,
      role: latestRole,
      displayName: String(
        staffDocument.data.displayName
        || authenticatedStaff.displayName
        || authenticatedStaff.email
        || "Clinic staff",
      ),
      doctorName: String(staffDocument.data.doctorName || "").trim(),
    };

    const body = await readJson(context.request);
    const patientId = String(body?.patientId || "").trim();
    if (!validPatientId(patientId)) {
      throw new HttpError(400, "Choose a valid patient record.");
    }

    const patientPath = `patients/${patientId}`;
    const patientDocument = await getDocument(context.env, patientPath);
    if (!patientDocument) throw new HttpError(404, "This patient record could not be found.");

    const now = new Date();
    const validated = validatePatientProfileUpdate(body, actor, patientDocument.data, now);
    const oldIdentity = canonicalPatientIdentity(patientDocument.data);
    const newIdentity = validated.identity;
    const oldIdentityKey = oldIdentity
      ? await sha256Hex(receptionIdentityMaterial(oldIdentity))
      : "";
    const newIdentityKey = await sha256Hex(receptionIdentityMaterial(newIdentity));

    const otherActiveMatch = (await patientsForDateOfBirth(context.env, newIdentity.dateOfBirth))
      .filter((candidate) => candidate.id !== patientId)
      .find((candidate) => (
        candidate.data.archived !== true
        && exactReceptionPatientIdentity(candidate.data, newIdentity)
      ));
    if (otherActiveMatch) {
      throw new HttpError(
        409,
        `Another active chart has the same identity (${otherActiveMatch.data.patientNumber || "existing patient"}). Review that chart before saving.`,
      );
    }

    const identityWrites = [];
    let oldIdentityRetainedForPatientId = "";
    if (oldIdentityKey && oldIdentityKey !== newIdentityKey) {
      const oldPath = `patientIdentityKeys/${oldIdentityKey}`;
      const oldReservation = await getDocument(context.env, oldPath);
      if (!oldReservation) {
        // Preserve the observed absence until the patient and new identity key
        // are committed, preventing a concurrent stale reservation from racing.
        identityWrites.push(verifyAbsentDocumentWrite(context.env, oldPath));
      } else if (oldReservation.data.patientId === patientId) {
        identityWrites.push(deleteDocumentWrite(
          context.env,
          oldPath,
          oldReservation.updateTime,
        ));
      } else {
        // The old key belongs to another record, so never delete it. Its
        // update-time precondition still makes the observed ownership part of
        // the same atomic decision.
        oldIdentityRetainedForPatientId = String(oldReservation.data.patientId || "");
        identityWrites.push(verifyDocumentWrite(
          context.env,
          oldPath,
          oldReservation.updateTime,
        ));
      }
    }

    const newPath = `patientIdentityKeys/${newIdentityKey}`;
    const newReservation = await getDocument(context.env, newPath);
    let identityReboundFromPatientId = "";
    if (!newReservation) {
      identityWrites.push(createDocumentWrite(context.env, newPath, {
        patientId,
        version: 2,
        createdBy: actor.uid,
        createdAt: now,
      }));
    } else if (newReservation.data.patientId === patientId) {
      identityWrites.push(verifyDocumentWrite(
        context.env,
        newPath,
        newReservation.updateTime,
      ));
    } else {
      const reservedPatientId = String(newReservation.data.patientId || "");
      const reservedPatient = validPatientId(reservedPatientId)
        ? await getDocument(context.env, `patients/${reservedPatientId}`)
        : null;
      if (!reservedPatient || reservedPatient.data.archived !== true) {
        throw new HttpError(
          409,
          "This identity is reserved by another active or unresolved patient chart. Ask an administrator to review it.",
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
          newPath,
          {
            patientId,
            version: 2,
            reboundFromPatientId: reservedPatientId,
            reboundBy: actor.uid,
            reboundAt: now,
          },
          [
            "patientId",
            "version",
            "reboundFromPatientId",
            "reboundBy",
            "reboundAt",
          ],
          newReservation.updateTime,
        ),
      );
    }

    const patientUpdates = { ...validated.updates, updatedAt: now };
    const patientFieldPaths = [...Object.keys(validated.updates), "updatedAt"];
    const auditId = crypto.randomUUID();
    await commitWrites(context.env, [
      // The service account bypasses Firestore rules, so authorization must
      // remain unchanged until the patient and audit writes commit.
      verifyDocumentWrite(
        context.env,
        staffPath,
        staffDocument.updateTime,
      ),
      updateDocumentWrite(
        context.env,
        patientPath,
        patientUpdates,
        patientFieldPaths,
        patientDocument.updateTime,
      ),
      ...identityWrites,
      createDocumentWrite(context.env, `auditLogs/${auditId}`, {
        eventType: "patient.profile_updated",
        category: "patient_profile",
        patientId,
        patientNumber: String(patientDocument.data.patientNumber || patientId),
        patientName: String(patientUpdates.fullName || patientDocument.data.fullName || "Patient"),
        actorUid: actor.uid,
        actorName: actor.displayName,
        actorRole: actor.role,
        changedFields: validated.changedFields,
        identityChanged: Boolean(oldIdentityKey && oldIdentityKey !== newIdentityKey),
        oldIdentityWasCanonical: Boolean(oldIdentityKey),
        identityReboundFromPatientId,
        oldIdentityRetainedForPatientId,
        createdAt: now,
      }),
    ]);

    return json({
      patient: responsePatient(
        patientId,
        patientDocument.data,
        validated.updates,
        validated.canEditClinical,
      ),
      changedFields: validated.changedFields,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
