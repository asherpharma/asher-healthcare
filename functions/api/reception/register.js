import {
  commitWrites,
  createDocumentWrite,
  getDocument,
  requireActiveStaff,
  updateDocumentWrite,
  verifyDocumentWrite,
} from "../../../server/razorpay/firebase.js";
import {
  assertSameOrigin,
  errorResponse,
  HttpError,
  json,
  readJson,
} from "../../../server/razorpay/http.js";
import {
  maximumQueueTokenForDay,
  patientsForDateOfBirth,
} from "../../../server/reception/firestore-query.js";
import {
  createReceptionInvoiceNumber,
  exactReceptionPatientIdentity,
  queueTokenLabel,
  receptionIdentityMaterial,
  receptionPayloadMaterial,
  receptionRequestMaterial,
  validateReceptionRegistration,
} from "../../../server/reception/workflow.js";

const MAX_COUNTER_ATTEMPTS = 5;

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function patientResponse(patientId, patientNumber, registration) {
  return {
    id: patientId,
    patientNumber,
    fullName: registration.fullName,
    phone: registration.phone,
    dateOfBirth: registration.dateOfBirth,
    gender: registration.gender,
    doctorName: registration.doctorName,
  };
}

function replayableResult(requestDocument, requestFingerprint) {
  if (!requestDocument) return null;
  if (requestDocument.data.requestFingerprint !== requestFingerprint) {
    throw new HttpError(409, "This reception request was already used for different patient details. Start a new request.");
  }
  if (requestDocument.data.status !== "committed" || !requestDocument.data.result) {
    throw new HttpError(409, "This patient arrival is still being completed. Please try again.");
  }
  return requestDocument.data.result;
}

async function replayResponse(env, requestPath, requestFingerprint) {
  const result = replayableResult(
    await getDocument(env, requestPath),
    requestFingerprint,
  );
  return result ? json({ ...result, replayed: true }) : null;
}

function invoiceResponse(invoiceId, invoiceNumber, patientId, patientNumber, registration, notes) {
  const item = {
    description: registration.consultationLabel,
    quantity: 1,
    unitPrice: registration.fee,
    amount: registration.fee,
  };
  return {
    id: invoiceId,
    patientId,
    patientNumber,
    invoiceNumber,
    patientName: registration.fullName,
    patientPhone: registration.phone,
    items: [item],
    subtotal: registration.fee,
    discount: 0,
    total: registration.fee,
    amountPaid: 0,
    balance: registration.fee,
    paymentStatus: "unpaid",
    paymentMethod: "not_recorded",
    paymentReference: "",
    notes,
  };
}

export async function onRequestPost(context) {
  try {
    assertSameOrigin(context.request);
    const staff = await requireActiveStaff(context.request, context.env);
    if (!['admin', 'reception'].includes(staff.role)) {
      throw new HttpError(403, "Express Reception is available only to administrators and reception staff.");
    }

    const body = await readJson(context.request);
    const now = new Date();
    const registration = validateReceptionRegistration(body, now);
    const requestKey = await sha256Hex(receptionRequestMaterial(staff.uid, registration.requestId));
    const requestPath = `receptionRequests/${requestKey}`;
    const requestFingerprint = await sha256Hex(receptionPayloadMaterial(registration));
    const replay = await replayResponse(context.env, requestPath, requestFingerprint);
    if (replay) return replay;

    const isNewPatient = !registration.patientId;
    const patientId = registration.patientId || crypto.randomUUID().replaceAll("-", "");
    const invoiceId = crypto.randomUUID().replaceAll("-", "");
    const appointmentId = crypto.randomUUID().replaceAll("-", "");
    const auditId = crypto.randomUUID().replaceAll("-", "");
    const invoiceNumber = createReceptionInvoiceNumber(now, invoiceId);
    const identityKey = await sha256Hex(receptionIdentityMaterial(registration));
    const identityPath = `patientIdentityKeys/${identityKey}`;
    const queueCounterPath = `queueCounters/${registration.doctorId}/days/${registration.clinicDate}`;
    const notes = isNewPatient
      ? "Created automatically during Express Reception registration."
      : "Created from Express Reception for an existing patient.";

    const legacyExactMatches = (await patientsForDateOfBirth(
      context.env,
      registration.dateOfBirth,
    )).filter((candidate) => exactReceptionPatientIdentity(candidate.data, registration));
    if (isNewPatient) {
      const activeLegacyMatch = legacyExactMatches.find((candidate) => candidate.data.archived !== true);
      if (activeLegacyMatch) {
        throw new HttpError(
          409,
          `An exact matching patient chart already exists (${activeLegacyMatch.data.patientNumber || "existing patient"}). Select that chart instead.`,
        );
      }
      if (legacyExactMatches.length > 0) {
        throw new HttpError(409, "An exact matching patient chart is archived. Ask an administrator to restore it instead of creating a duplicate.");
      }
    } else {
      const otherActiveMatch = legacyExactMatches.find((candidate) => (
        candidate.id !== patientId && candidate.data.archived !== true
      ));
      if (otherActiveMatch) {
        throw new HttpError(
          409,
          `Another active chart has the same identity (${otherActiveMatch.data.patientNumber || "existing patient"}). Ask an administrator to merge or archive the duplicate before check-in.`,
        );
      }
    }

    for (let attempt = 1; attempt <= MAX_COUNTER_ATTEMPTS; attempt += 1) {
      const patientDocument = isNewPatient
        ? null
        : await getDocument(context.env, `patients/${patientId}`);
      if (!isNewPatient) {
        if (!patientDocument) throw new HttpError(404, "The selected patient record no longer exists.");
        if (patientDocument.data.archived === true) {
          throw new HttpError(409, "The selected patient record is archived. Restore it before check-in.");
        }
        if (!exactReceptionPatientIdentity(patientDocument.data, registration)) {
          throw new HttpError(409, "The selected patient details changed. Search and select the chart again.");
        }
      }

      const existingIdentity = await getDocument(context.env, identityPath);
      let identityReservationRebind = null;
      if (existingIdentity) {
        if (isNewPatient) {
          throw new HttpError(409, "An exact matching patient chart already exists. Select the existing chart instead.");
        }
        if (existingIdentity.data.patientId !== patientId) {
          const reservedPatientId = String(existingIdentity.data.patientId || "");
          const reservedPatient = /^[A-Za-z0-9_-]{1,128}$/u.test(reservedPatientId)
            ? await getDocument(context.env, `patients/${reservedPatientId}`)
            : null;
          if (!reservedPatient || reservedPatient.data.archived !== true) {
            throw new HttpError(409, "These identity details are reserved by another active patient chart. Select the correct chart or ask an administrator to review the duplicate.");
          }
          identityReservationRebind = {
            previousPatientId: reservedPatientId,
            previousPatientUpdateTime: reservedPatient.updateTime,
          };
        }
      }

      const counter = await getDocument(context.env, queueCounterPath);
      const existingMaximum = await maximumQueueTokenForDay(
        context.env,
        registration.doctorId,
        registration.clinicDate,
      );
      const migrationSeed = Math.max(Number(counter?.data?.lastToken || 0), existingMaximum);
      const queueToken = migrationSeed + 1;
      if (!Number.isInteger(queueToken) || queueToken < 1 || queueToken > 999) {
        throw new HttpError(409, "The doctor’s daily queue is full. Ask an administrator to open a new queue.");
      }

      // Twelve random hexadecimal characters provide a far wider collision
      // margin than the legacy seven-character display identifier.
      const patientNumber = String(patientDocument?.data?.patientNumber || `ASH-${patientId.slice(0, 12).toUpperCase()}`);
      const item = {
        description: registration.consultationLabel,
        quantity: 1,
        unitPrice: registration.fee,
        amount: registration.fee,
      };
      const result = {
        patient: patientResponse(patientId, patientNumber, registration),
        invoice: invoiceResponse(
          invoiceId,
          invoiceNumber,
          patientId,
          patientNumber,
          registration,
          notes,
        ),
        appointment: {
          id: appointmentId,
          status: "checked_in",
          queueToken,
          queueLabel: queueTokenLabel(queueToken, registration.doctorId),
          doctorId: registration.doctorId,
          preferredDate: registration.clinicDate,
          preferredTime: registration.clinicTime,
        },
        consultationLabel: registration.consultationLabel,
      };
      const writes = [];

      if (isNewPatient) {
        writes.push(
          createDocumentWrite(context.env, `patients/${patientId}`, {
            patientNumber,
            fullName: registration.fullName,
            phone: registration.phone,
            normalizedName: registration.normalizedName,
            normalizedPhone: registration.normalizedPhone,
            dateOfBirth: registration.dateOfBirth,
            gender: registration.gender,
            doctorId: registration.doctorId,
            doctorName: registration.doctorName,
            caseType: registration.caseType,
            specialty: registration.specialty,
            consultationFee: registration.fee,
            registrationInvoiceId: invoiceId,
            registrationInvoiceNumber: invoiceNumber,
            lastInvoiceId: invoiceId,
            lastInvoiceNumber: invoiceNumber,
            lastVisitAt: now,
            address: "",
            allergies: "",
            medicalHistory: "",
            archived: false,
            createdBy: staff.uid,
            createdAt: now,
            updatedAt: now,
          }),
          createDocumentWrite(context.env, identityPath, {
            patientId,
            version: 2,
            createdBy: staff.uid,
            createdAt: now,
          }),
        );
      } else {
        writes.push(updateDocumentWrite(
          context.env,
          `patients/${patientId}`,
          {
            patientNumber,
            doctorId: registration.doctorId,
            doctorName: registration.doctorName,
            caseType: registration.caseType,
            specialty: registration.specialty,
            consultationFee: registration.fee,
            lastInvoiceId: invoiceId,
            lastInvoiceNumber: invoiceNumber,
            lastVisitAt: now,
            updatedAt: now,
          },
          [
            "patientNumber",
            "doctorId",
            "doctorName",
            "caseType",
            "specialty",
            "consultationFee",
            "lastInvoiceId",
            "lastInvoiceNumber",
            "lastVisitAt",
            "updatedAt",
          ],
          patientDocument.updateTime,
        ));
        if (!existingIdentity) {
          writes.push(createDocumentWrite(context.env, identityPath, {
            patientId,
            version: 2,
            createdBy: staff.uid,
            createdAt: now,
          }));
        } else if (identityReservationRebind) {
          // Rebinding is safe only while the former canonical chart remains
          // archived. A concurrent restore changes its update time and aborts
          // this entire arrival commit.
          writes.push(
            verifyDocumentWrite(
              context.env,
              `patients/${identityReservationRebind.previousPatientId}`,
              identityReservationRebind.previousPatientUpdateTime,
            ),
            updateDocumentWrite(
              context.env,
              identityPath,
              {
                patientId,
                version: 2,
                reboundFromPatientId: identityReservationRebind.previousPatientId,
                reboundBy: staff.uid,
                reboundAt: now,
              },
              [
                "patientId",
                "version",
                "reboundFromPatientId",
                "reboundBy",
                "reboundAt",
              ],
              existingIdentity.updateTime,
            ),
          );
        }
      }

      writes.push(
        createDocumentWrite(context.env, `invoices/${invoiceId}`, {
          invoiceNumber,
          patientId,
          patientNumber,
          patientName: registration.fullName,
          patientPhone: registration.phone,
          items: [item],
          subtotal: registration.fee,
          discount: 0,
          total: registration.fee,
          amountPaid: 0,
          balance: registration.fee,
          paymentStatus: "unpaid",
          paymentMethod: "not_recorded",
          paymentReference: "",
          notes,
          appointmentId,
          createdBy: staff.uid,
          createdAt: now,
          updatedAt: now,
          paidAt: null,
        }),
        createDocumentWrite(context.env, `appointments/${appointmentId}`, {
          patientId,
          patientNumber,
          patientName: registration.fullName,
          phone: registration.phone,
          doctorId: registration.doctorId,
          doctorName: registration.doctorName,
          preferredDate: registration.clinicDate,
          preferredTime: registration.clinicTime,
          reason: registration.consultationLabel,
          status: "checked_in",
          queueToken,
          source: "walk-in",
          privacyAccepted: false,
          consent: {
            status: "not-captured",
            method: "none",
            capturedAt: null,
            capturedBy: null,
          },
          invoiceId,
          createdBy: staff.uid,
          createdAt: now,
          checkedInAt: now,
          updatedAt: now,
        }),
        counter
          ? updateDocumentWrite(
              context.env,
              queueCounterPath,
              {
                lastToken: queueToken,
                appointmentId,
                updatedAt: now,
              },
              ["lastToken", "appointmentId", "updatedAt"],
              counter.updateTime,
            )
          : createDocumentWrite(context.env, queueCounterPath, {
              doctorId: registration.doctorId,
              date: registration.clinicDate,
              lastToken: queueToken,
              appointmentId,
              updatedAt: now,
            }),
        createDocumentWrite(context.env, `auditLogs/${auditId}`, {
          eventType: "reception.arrival_created",
          category: "reception_workflow",
          patientId,
          patientNumber,
          patientName: registration.fullName,
          patientCreated: isNewPatient,
          duplicateAcknowledged: registration.duplicateAcknowledged,
          identityReboundFromPatientId: identityReservationRebind?.previousPatientId || "",
          invoiceId,
          invoiceNumber,
          appointmentId,
          queueToken,
          doctorId: registration.doctorId,
          doctorName: registration.doctorName,
          caseType: registration.caseType,
          fee: registration.fee,
          actorUid: staff.uid,
          actorName: staff.displayName,
          actorRole: staff.role,
          createdAt: now,
        }),
        createDocumentWrite(context.env, requestPath, {
          status: "committed",
          requestId: registration.requestId,
          requestFingerprint,
          actorUid: staff.uid,
          result,
          createdAt: now,
          committedAt: now,
        }),
      );

      try {
        await commitWrites(context.env, writes);
        return json({ ...result, replayed: false }, 201);
      } catch (error) {
        if (!(error instanceof HttpError) || error.status !== 409) {
          throw error;
        }
        const committedReplay = await replayResponse(context.env, requestPath, requestFingerprint);
        if (committedReplay) return committedReplay;
        if (attempt === MAX_COUNTER_ATTEMPTS) throw error;

        const identityAfterConflict = await getDocument(context.env, identityPath);
        if (identityAfterConflict) {
          if (isNewPatient) {
            throw new HttpError(409, "An exact matching patient chart already exists. Select the existing chart instead.");
          }
          if (identityAfterConflict.data.patientId !== patientId) {
            const reservedPatientId = String(identityAfterConflict.data.patientId || "");
            const reservedPatient = /^[A-Za-z0-9_-]{1,128}$/u.test(reservedPatientId)
              ? await getDocument(context.env, `patients/${reservedPatientId}`)
              : null;
            if (!reservedPatient || reservedPatient.data.archived !== true) {
              throw new HttpError(409, "These identity details are reserved by another active patient chart. Select the correct chart or ask an administrator to review the duplicate.");
            }
          }
        }
      }
    }

    throw new HttpError(409, "The queue changed while this patient was being checked in. Please try again.");
  } catch (error) {
    return errorResponse(error);
  }
}
