import {
  assertActivePatientDocument,
  commitWrites,
  createDocumentWrite,
  documentName,
  getDocument,
  updateDocumentWrite,
  verifyDocumentWrite,
} from "../razorpay/firebase.js";
import { HttpError } from "../razorpay/http.js";
import { validDocumentId } from "../razorpay/payments.js";
import { doctorCanEditPatient } from "../patients/profile.js";
import { externalLabProvider, publicExternalLabProvider } from "./providers.js";
import {
  labReportDocumentPath,
  legacyLabReportDocumentPath,
} from "./report-identity.js";

const PROVIDER_ID = "ayuslab";
const REFERENCE_PATTERN = /^[A-Z0-9](?:[A-Z0-9._/ -]{0,62}[A-Z0-9])?$/u;
const REPORT_ATTACHMENT_FIELDS = Object.freeze([
  "reportFileName",
  "reportStoragePath",
  "reportContentType",
  "reportSize",
]);

function cleanText(value, maximumLength) {
  return typeof value === "string" ? value.trim().slice(0, maximumLength) : "";
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return bytesToHex(new Uint8Array(digest));
}

export function normalizeAyusLabNumber(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (raw.length < 2 || raw.length > 64 || /[\u0000-\u001F\u007F]/u.test(raw)) {
    throw new HttpError(400, "Enter the Ayus Lab No exactly as printed, without line breaks or control characters.");
  }
  const normalized = raw
    .normalize("NFKC")
    .toLocaleUpperCase("en-IN")
    .replace(/\s+/gu, " ");
  if (normalized.length < 2 || !REFERENCE_PATTERN.test(normalized)) {
    throw new HttpError(
      400,
      "Enter the Ayus Lab No exactly as printed, using letters, numbers, spaces, hyphens, dots, slashes, or underscores.",
    );
  }
  return normalized;
}

export function normalizeAyusLinkRequest(body = {}) {
  const labOrderId = cleanText(body.labOrderId, 128);
  if (!validDocumentId(labOrderId)) {
    throw new HttpError(400, "Choose a valid laboratory order.");
  }

  const ayusLabNumber = normalizeAyusLabNumber(body.ayusLabNumber);
  const replacementReason = cleanText(body.replacementReason, 300);
  if (body.replacementReason != null && replacementReason.length > 0 && replacementReason.length < 8) {
    throw new HttpError(400, "Add a replacement reason between 8 and 300 characters.");
  }
  return { labOrderId, ayusLabNumber, replacementReason };
}

export function assertAyusLinkAccess(staff, patient) {
  if (!staff || !["admin", "doctor", "reception"].includes(staff.role)) {
    throw new HttpError(403, "This staff account cannot link an external laboratory record.");
  }
  if (staff.role !== "admin" && staff.labReportOperator !== true) {
    throw new HttpError(403, "An administrator must grant external laboratory access first.");
  }
  if (
    staff.role === "doctor"
    && !doctorCanEditPatient(staff, patient)
  ) {
    throw new HttpError(403, "Doctors can link reports only for patients currently assigned to them.");
  }
  return staff;
}

function deleteDocumentWrite(env, path, updateTime) {
  // Reuse the central path/update-time validator before constructing a delete.
  verifyDocumentWrite(env, path, updateTime);
  return {
    delete: documentName(env, path),
    currentDocument: { updateTime },
  };
}

function verifyMissingDocumentWrite(env, path) {
  return {
    verify: documentName(env, path),
    currentDocument: { exists: false },
  };
}

function safeStaff(authenticatedStaff, staffDocument) {
  const role = String(staffDocument?.data?.role || "");
  if (
    !authenticatedStaff
    || !validDocumentId(authenticatedStaff.uid)
    || !staffDocument
    || staffDocument.data.active !== true
    || !["admin", "doctor", "reception"].includes(role)
  ) {
    throw new HttpError(403, "This staff account is no longer active.");
  }
  return {
    uid: authenticatedStaff.uid,
    role,
    displayName: cleanText(
      staffDocument.data.displayName
        || authenticatedStaff.displayName
        || authenticatedStaff.email
        || "Clinic staff",
      100,
    ),
    doctorName: cleanText(staffDocument.data.doctorName, 100),
    labReportOperator: role === "admin" || staffDocument.data.labReportOperator === true,
  };
}

function linkResponse(link, { alreadyLinked = false } = {}) {
  return {
    provider: publicExternalLabProvider(PROVIDER_ID),
    link: link
      ? {
          labOrderId: String(link.labOrderId || ""),
          ayusLabNumber: String(link.providerLabNumber || ""),
          linkedAt: link.linkedAt || null,
          updatedAt: link.updatedAt || null,
          version: Number(link.version || 1),
        }
      : null,
    alreadyLinked,
  };
}

async function referenceIdentity(ayusLabNumber) {
  const digest = await sha256Hex(
    `asher-external-lab-reference-v1\n${PROVIDER_ID}\n${ayusLabNumber}`,
  );
  return {
    digest,
    fingerprint: digest.slice(0, 16),
    path: `externalLabReferenceKeys/${digest}`,
  };
}

function linkDocumentId(labOrderId) {
  return `${PROVIDER_ID}_${labOrderId}`;
}

function hasImmutableReportAttachment(order) {
  return REPORT_ATTACHMENT_FIELDS.some((field) => Object.hasOwn(order || {}, field));
}

function assertExistingLinkIntegrity(existingLink, { input, patientId }) {
  const link = existingLink?.data;
  if (
    !link
    || link.providerId !== PROVIDER_ID
    || link.labOrderId !== input.labOrderId
    || link.patientId !== patientId
    || link.status !== "linked"
    || typeof link.providerLabNumber !== "string"
    || !Number.isSafeInteger(Number(link.version))
    || Number(link.version) < 1
  ) {
    throw new HttpError(
      409,
      "This external laboratory link needs administrator review before it can be used.",
    );
  }
  return link;
}

function assertReferenceReservation(reservation, reference, { input, linkId }) {
  if (
    !reservation
    || reservation.data.providerId !== PROVIDER_ID
    || reservation.data.labOrderId !== input.labOrderId
    || reservation.data.externalLabLinkId !== linkId
  ) {
    throw new HttpError(
      409,
      "This Ayus Lab No needs administrator review before it can be used.",
    );
  }
  if (
    typeof reservation.updateTime !== "string"
    || reservation.updateTime.length === 0
    || reference.path.length === 0
  ) {
    throw new HttpError(409, "This Ayus Lab No has an invalid uniqueness reservation.");
  }
  return reservation;
}

function auditRecord({
  actor,
  input,
  linkId,
  order,
  operation,
  now,
}) {
  return {
    eventType: operation === "replaced"
      ? "external_lab.reference_replaced"
      : "external_lab.reference_linked",
    category: "external_lab",
    providerId: PROVIDER_ID,
    workflowMode: externalLabProvider(PROVIDER_ID).workflowMode,
    externalLabLinkId: linkId,
    labOrderId: input.labOrderId,
    patientId: String(order.patientId || ""),
    operation,
    // A fixed code keeps the immutable audit useful without persisting a
    // free-form note that could accidentally contain a patient name, phone,
    // or the old/new provider Lab No.
    replacementReasonCode: operation === "replaced" ? "administrator_correction" : "",
    actorUid: actor.uid,
    actorName: actor.displayName,
    actorRole: actor.role,
    createdAt: now,
  };
}

const DEFAULT_DATABASE = Object.freeze({ getDocument, commitWrites });

/**
 * Atomically links an Ayus Lab No to one Asher lab order. The raw provider
 * reference lives only in a server-owned collection; browser clients cannot
 * query it under the deployed default-deny rules. Audit events contain only a
 * one-way fingerprint, never the raw reference or any provider credential.
 */
export async function linkAyusLabNumber(
  env,
  body,
  authenticatedStaff,
  database = DEFAULT_DATABASE,
) {
  const input = normalizeAyusLinkRequest(body);
  const provider = externalLabProvider(PROVIDER_ID);
  const staffPath = `staff/${authenticatedStaff?.uid || "invalid"}`;
  const staffDocument = validDocumentId(authenticatedStaff?.uid)
    ? await database.getDocument(env, staffPath)
    : null;
  const actor = safeStaff(authenticatedStaff, staffDocument);

  const orderPath = `labOrders/${input.labOrderId}`;
  const orderDocument = await database.getDocument(env, orderPath);
  if (!orderDocument) throw new HttpError(404, "This laboratory order could not be found.");
  if (orderDocument.data.status === "cancelled") {
    throw new HttpError(409, "A cancelled laboratory order cannot be linked.");
  }
  const patientId = String(orderDocument.data.patientId || "").trim();
  if (!validDocumentId(patientId)) {
    throw new HttpError(409, "This laboratory order is not linked to a valid patient record.");
  }
  const patientPath = `patients/${patientId}`;
  const patientDocument = assertActivePatientDocument(
    await database.getDocument(env, patientPath),
    {
      missingMessage: "The patient record linked to this laboratory order no longer exists.",
      archivedMessage: "The patient record linked to this laboratory order is archived. Restore it before linking an external result.",
    },
  );
  assertAyusLinkAccess(actor, patientDocument.data);

  const linkId = linkDocumentId(input.labOrderId);
  const linkPath = `externalLabLinks/${linkId}`;
  const existingLink = await database.getDocument(env, linkPath);
  const isReplacement = Boolean(existingLink);
  const sameReference = existingLink?.data?.providerLabNumber === input.ayusLabNumber;
  if (isReplacement && !sameReference && actor.role !== "admin") {
    throw new HttpError(403, "Only an administrator can replace an existing Ayus Lab No.");
  }
  if (isReplacement && !sameReference && input.replacementReason.length < 8) {
    throw new HttpError(400, "Add a replacement reason between 8 and 300 characters.");
  }

  const nextReference = await referenceIdentity(input.ayusLabNumber);
  const nextReservation = await database.getDocument(env, nextReference.path);

  if (existingLink) {
    const validatedLink = assertExistingLinkIntegrity(existingLink, { input, patientId });
    if (sameReference) {
      if (validatedLink.referenceFingerprint !== nextReference.fingerprint) {
        throw new HttpError(409, "This external laboratory link has an invalid reference fingerprint.");
      }
      assertReferenceReservation(nextReservation, nextReference, { input, linkId });
      return linkResponse(validatedLink, { alreadyLinked: true });
    }
  }

  const reportPath = labReportDocumentPath(patientId, input.labOrderId);
  const legacyReportPath = legacyLabReportDocumentPath(patientId, input.labOrderId);
  const reportDocument = await database.getDocument(env, reportPath);
  const legacyReportDocument = await database.getDocument(env, legacyReportPath);
  if (
    hasImmutableReportAttachment(orderDocument.data)
    || reportDocument
    || legacyReportDocument
  ) {
    throw new HttpError(
      409,
      "An immutable report is already attached. Its Ayus Lab No cannot be added or changed.",
    );
  }

  if (
    nextReservation
    && (
      nextReservation.data.providerId !== provider.id
      || nextReservation.data.labOrderId !== input.labOrderId
      || nextReservation.data.externalLabLinkId !== linkId
    )
  ) {
    throw new HttpError(409, "This Ayus Lab No is already linked to another laboratory order.");
  }

  let previousReference = null;
  let previousReservation = null;
  if (isReplacement) {
    previousReference = await referenceIdentity(existingLink.data.providerLabNumber);
    if (existingLink.data.referenceFingerprint !== previousReference.fingerprint) {
      throw new HttpError(409, "This external laboratory link has an invalid reference fingerprint.");
    }
    previousReservation = await database.getDocument(env, previousReference.path);
    assertReferenceReservation(previousReservation, previousReference, { input, linkId });
  } else if (nextReservation) {
    // A reference reservation without its deterministic link is an integrity
    // conflict, not a condition that should be silently repaired by a browser.
    throw new HttpError(409, "This Ayus Lab No needs administrator review before it can be linked.");
  }

  const now = new Date();
  const version = isReplacement ? Number(existingLink.data.version || 1) + 1 : 1;
  const link = {
    providerId: provider.id,
    workflowMode: provider.workflowMode,
    labOrderId: input.labOrderId,
    patientId,
    providerLabNumber: input.ayusLabNumber,
    referenceFingerprint: nextReference.fingerprint,
    status: "linked",
    version,
    linkedBy: isReplacement ? String(existingLink.data.linkedBy || actor.uid) : actor.uid,
    linkedAt: isReplacement ? existingLink.data.linkedAt || now : now,
    updatedBy: actor.uid,
    updatedAt: now,
  };
  const auditId = crypto.randomUUID();
  const writes = [
    verifyDocumentWrite(env, staffPath, staffDocument.updateTime),
    verifyDocumentWrite(env, orderPath, orderDocument.updateTime),
    verifyDocumentWrite(env, patientPath, patientDocument.updateTime),
    // Close the narrow race where a report document could appear after the
    // preflight read without changing the lab-order document itself.
    verifyMissingDocumentWrite(env, reportPath),
    // Preserve the same fail-closed guarantee for reports finalized before
    // the reserved lab-* document identity migration.
    verifyMissingDocumentWrite(env, legacyReportPath),
  ];

  if (isReplacement) {
    if (previousReference.path !== nextReference.path) {
      writes.push(deleteDocumentWrite(
        env,
        previousReference.path,
        previousReservation.updateTime,
      ));
      writes.push(nextReservation
        ? verifyDocumentWrite(env, nextReference.path, nextReservation.updateTime)
        : createDocumentWrite(env, nextReference.path, {
            providerId: provider.id,
            externalLabLinkId: linkId,
            labOrderId: input.labOrderId,
            createdAt: now,
          }));
    }
    writes.push(updateDocumentWrite(
      env,
      linkPath,
      link,
      Object.keys(link),
      existingLink.updateTime,
    ));
  } else {
    writes.push(
      createDocumentWrite(env, nextReference.path, {
        providerId: provider.id,
        externalLabLinkId: linkId,
        labOrderId: input.labOrderId,
        createdAt: now,
      }),
      createDocumentWrite(env, linkPath, link),
    );
  }

  writes.push(createDocumentWrite(
    env,
    `auditLogs/${auditId}`,
    auditRecord({
      actor,
      input,
      linkId,
      order: orderDocument.data,
      operation: isReplacement ? "replaced" : "linked",
      now,
    }),
  ));

  await database.commitWrites(env, writes);
  return linkResponse(link);
}

export async function readAyusLabLink(
  env,
  labOrderId,
  authenticatedStaff,
  database = DEFAULT_DATABASE,
) {
  if (!validDocumentId(labOrderId)) {
    throw new HttpError(400, "Choose a valid laboratory order.");
  }
  const staffPath = `staff/${authenticatedStaff?.uid || "invalid"}`;
  const staffDocument = validDocumentId(authenticatedStaff?.uid)
    ? await database.getDocument(env, staffPath)
    : null;
  const actor = safeStaff(authenticatedStaff, staffDocument);
  const order = await database.getDocument(env, `labOrders/${labOrderId}`);
  if (!order) throw new HttpError(404, "This laboratory order could not be found.");
  if (order.data.status === "cancelled") {
    throw new HttpError(409, "A cancelled laboratory order cannot expose an external Lab No.");
  }
  const patientId = String(order.data.patientId || "").trim();
  if (!validDocumentId(patientId)) {
    throw new HttpError(409, "This laboratory order is not linked to a valid patient record.");
  }
  const patientDocument = assertActivePatientDocument(
    await database.getDocument(env, `patients/${patientId}`),
    {
      missingMessage: "The patient record linked to this laboratory order no longer exists.",
      archivedMessage: "The patient record linked to this laboratory order is archived.",
    },
  );
  assertAyusLinkAccess(actor, patientDocument.data);

  const link = await database.getDocument(
    env,
    `externalLabLinks/${linkDocumentId(labOrderId)}`,
  );
  if (link && (
    link.data.providerId !== PROVIDER_ID
    || link.data.labOrderId !== labOrderId
    || link.data.patientId !== patientId
  )) {
    throw new HttpError(409, "This external laboratory link needs administrator review.");
  }
  return linkResponse(link?.data || null);
}
