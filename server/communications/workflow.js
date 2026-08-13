import {
  commitWrites,
  createDocumentWrite,
  getDocument,
  serviceAccountAccessToken,
  updateDocumentWrite,
  verifyDocumentWrite,
} from "../razorpay/firebase.js";
import { HttpError } from "../razorpay/http.js";

const ALLOWED_ROLES = new Set(["admin", "reception"]);
// Email stays intentionally disabled until the patient demographic workflow
// can verify and audit email addresses. Do not accept arbitrary destinations.
const CARE_CHANNELS = new Set(["whatsapp"]);
const CONSENT_METHODS = new Set(["patient-verbal", "guardian-verbal", "written-form"]);
const OUTBOX_ACTIONS = new Set(["mark_delivered", "mark_failed", "cancel"]);
const ACTIONABLE_APPOINTMENT_STATUSES = new Set(["requested", "confirmed"]);
const RECALL_TASK_TYPES = new Set(["follow_up", "vaccination", "lab", "callback"]);
const CONSENT_VERSION = "care-reminders-v1";
const TEMPLATE_VERSION = "neutral-care-reminder-v1";
const MAX_CANDIDATES = 200;
const MAX_RECENT_OUTBOX = 100;
const OUTBOX_RETENTION_DAYS = 30;

function cleanText(value, maximum = 200) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function documentId(name = "") {
  return decodeURIComponent(String(name).split("/").at(-1) || "");
}

function validDocumentId(value) {
  return /^[A-Za-z0-9_-]{1,128}$/u.test(String(value || ""));
}

function decodeValue(value = {}) {
  if ("nullValue" in value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(decodeValue);
  if ("mapValue" in value) return decodeFields(value.mapValue.fields || {});
  return undefined;
}

function decodeFields(fields = {}) {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]),
  );
}

function filter(fieldPath, op, value) {
  return { fieldFilter: { field: { fieldPath }, op, value } };
}

async function runQuery(env, structuredQuery, errorMessage) {
  const accessToken = await serviceAccountAccessToken(env);
  const project = encodeURIComponent(env.FIREBASE_PROJECT_ID);
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents:runQuery`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ structuredQuery }),
    },
  );
  const result = await response.json();
  if (!response.ok || !Array.isArray(result)) {
    const queryError = Array.isArray(result)
      ? result.find((row) => row?.error)?.error
      : result?.error;
    console.error("Communications query failed", response.status, queryError?.status);
    throw new HttpError(503, errorMessage);
  }
  return result.flatMap((row) => {
    if (!row?.document?.name) return [];
    return [{
      id: documentId(row.document.name),
      ...decodeFields(row.document.fields || {}),
    }];
  });
}

function clinicDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const read = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

function nextDate(value) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function patientAgeAt(dateOfBirth, now = new Date()) {
  const value = cleanText(dateOfBirth, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || !(now instanceof Date) || Number.isNaN(now.getTime())) {
    return null;
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    return null;
  }
  const today = clinicDate(now);
  if (value > today) return null;
  const [currentYear, currentMonth, currentDay] = today.split("-").map(Number);
  let age = currentYear - year;
  if (currentMonth < month || (currentMonth === month && currentDay < day)) age -= 1;
  return age;
}

export function normalizeCommunicationPhone(value) {
  const digits = cleanText(value, 30).replace(/\D/gu, "");
  let national = digits;
  if (national.startsWith("0091")) national = national.slice(4);
  else if (national.length === 12 && national.startsWith("91")) national = national.slice(2);
  if (national.length === 11 && national.startsWith("0")) national = national.slice(1);
  return /^[6-9]\d{9}$/u.test(national) ? `+91${national}` : "";
}

export function normalizeCommunicationEmail(value) {
  const email = cleanText(value, 254).toLocaleLowerCase("en-IN");
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) ? email : "";
}

export function assertCommunicationStaff(staff) {
  if (!staff || !ALLOWED_ROLES.has(staff.role)) {
    throw new HttpError(
      403,
      "Only clinic administrators and reception staff can manage patient reminders.",
    );
  }
  return staff;
}

export function communicationStaffPrecondition(env, staff) {
  if (!staff?.uid || !staff.staffUpdateTime) {
    throw new HttpError(401, "Your staff session must be refreshed before managing reminders.");
  }
  return verifyDocumentWrite(env, `staff/${staff.uid}`, staff.staffUpdateTime);
}

async function assertCurrentCommunicationStaff(env, staff) {
  assertCommunicationStaff(staff);
  const current = await getDocument(env, `staff/${staff.uid}`);
  if (
    !current
    || current.updateTime !== staff.staffUpdateTime
    || current.data.active !== true
    || !ALLOWED_ROLES.has(String(current.data.role || ""))
  ) {
    throw new HttpError(403, "This staff access changed. Sign in again before opening patient reminders.");
  }
  return current;
}

export function validateConsentGrant(body, patient, now = new Date()) {
  const patientId = cleanText(body?.patientId, 128);
  const purpose = cleanText(body?.purpose, 20);
  const channel = cleanText(body?.channel, 20);
  const method = cleanText(body?.method, 40);
  const recipient = channel === "whatsapp"
    ? normalizeCommunicationPhone(body?.recipient)
    : normalizeCommunicationEmail(body?.recipient);
  const proxyName = cleanText(body?.proxyName, 100);
  const proxyRelationship = cleanText(body?.proxyRelationship, 60);
  const consentReference = cleanText(body?.consentReference, 80);

  if (!validDocumentId(patientId) || patientId !== patient?.id) {
    throw new HttpError(400, "Select a valid active patient record.");
  }
  if (purpose !== "care") {
    throw new HttpError(400, "Marketing permission must be recorded separately from care reminders.");
  }
  if (!CARE_CHANNELS.has(channel)) throw new HttpError(400, "WhatsApp is the only verified care-reminder channel currently available.");
  if (!CONSENT_METHODS.has(method)) throw new HttpError(400, "Record how permission was received.");
  if (!recipient) throw new HttpError(400, `Enter a valid ${channel === "email" ? "email address" : "mobile number"}.`);

  if (channel === "whatsapp" && recipient !== normalizeCommunicationPhone(patient.phone)) {
    throw new HttpError(409, "The WhatsApp number must match the active patient record.");
  }
  const age = patientAgeAt(patient.dateOfBirth, now);
  if (method === "patient-verbal" && age === null) {
    throw new HttpError(
      400,
      "A valid patient date of birth is required for patient verbal consent. Record a named guardian or a clinic-held written form instead.",
    );
  }
  if (method === "patient-verbal" && age < 18) {
    throw new HttpError(
      400,
      "A minor cannot provide patient verbal reminder consent. Record a named parent or guardian, or a clinic-held written form.",
    );
  }
  if (method === "guardian-verbal" && (proxyName.length < 2 || proxyRelationship.length < 2)) {
    throw new HttpError(400, "Record the parent or guardian name and relationship.");
  }
  if (method === "written-form" && !/^[A-Za-z0-9][A-Za-z0-9._/-]{2,79}$/u.test(consentReference)) {
    throw new HttpError(
      400,
      "Record the clinic-held written consent form reference using letters, numbers, dots, slashes, hyphens, or underscores.",
    );
  }

  return {
    patientId,
    purpose,
    channel,
    method,
    recipient,
    proxyName: method === "guardian-verbal" ? proxyName : "",
    proxyRelationship: method === "guardian-verbal" ? proxyRelationship : "",
    consentReference: method === "written-form" ? consentReference : "",
  };
}

function consentField(purpose, channel) {
  return `${purpose}${channel[0].toUpperCase()}${channel.slice(1)}`;
}

function preferenceState(preference, channel) {
  const value = preference?.[consentField("care", channel)];
  if (!value || value.status !== "granted") return { status: value?.status || "not-recorded" };
  return {
    status: "granted",
    recipient: String(value.recipient || ""),
    method: String(value.method || ""),
    consentVersion: String(value.consentVersion || ""),
    eventId: String(value.eventId || ""),
    capturedAt: String(value.capturedAt || ""),
  };
}

function maskedRecipient(value, channel) {
  const recipient = String(value || "");
  if (channel === "email") {
    const [name, domain] = recipient.split("@");
    if (!name || !domain) return "";
    return `${name.slice(0, 2)}***@${domain}`;
  }
  const digits = recipient.replace(/\D/gu, "");
  return digits.length >= 4 ? `••••••${digits.slice(-4)}` : "";
}

function dueAppointmentQuery(date) {
  return {
    from: [{ collectionId: "appointments" }],
    where: filter("preferredDate", "EQUAL", { stringValue: date }),
    select: { fields: [
      "patientId", "patientName", "phone", "doctorId", "preferredDate",
      "preferredTime", "status", "source",
    ].map((fieldPath) => ({ fieldPath })) },
    limit: 150,
  };
}

function dueTaskQuery(today) {
  return {
    from: [{ collectionId: "staffTasks" }],
    where: filter("dueDate", "LESS_THAN_OR_EQUAL", { stringValue: today }),
    orderBy: [{ field: { fieldPath: "dueDate" }, direction: "ASCENDING" }],
    select: { fields: [
      "patientId", "patientName", "type", "status", "dueDate", "dueTime",
    ].map((fieldPath) => ({ fieldPath })) },
    limit: 200,
  };
}

function recentOutboxQuery() {
  return {
    from: [{ collectionId: "communicationOutbox" }],
    orderBy: [{ field: { fieldPath: "createdAt" }, direction: "DESCENDING" }],
    select: { fields: [
      "patientId", "sourceType", "sourceId", "purpose", "channel", "recipient",
      "templateId", "templateVersion", "scheduledFor", "status", "deliveryMode",
      "createdAt", "updatedAt", "expiresAt", "lastOpenedAt", "deliveredAt",
      "failureCode",
    ].map((fieldPath) => ({ fieldPath })) },
    limit: MAX_RECENT_OUTBOX,
  };
}

async function mapLimit(values, limit, mapper) {
  const results = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return results;
}

function sourceDueAt(source) {
  const date = String(source.preferredDate || source.dueDate || "");
  const time = String(source.preferredTime || source.dueTime || "09:00");
  return `${date}T${/^\d{2}:\d{2}$/u.test(time) ? time : "09:00"}:00+05:30`;
}

function sourceCandidate(source, sourceType, patient, preference, now) {
  const whatsapp = preferenceState(preference, "whatsapp");
  return {
    key: `${sourceType}:${source.id}`,
    sourceType,
    sourceId: source.id,
    patientId: patient.id,
    patientNumber: String(patient.patientNumber || ""),
    patientName: String(patient.fullName || source.patientName || "Patient"),
    dueAt: sourceDueAt(source),
    kind: sourceType === "appointment" ? "appointment_reminder" : "follow_up_recall",
    dueLabel: sourceType === "appointment"
      ? `${String(source.preferredDate || "")} · ${String(source.preferredTime || "")}`
      : `${String(source.dueDate || "")} · ${String(source.dueTime || "")}`,
    patientVerbalEligible: (patientAgeAt(patient.dateOfBirth, now) ?? -1) >= 18,
    channels: {
      whatsapp: {
        ...whatsapp,
        maskedRecipient: maskedRecipient(whatsapp.recipient, "whatsapp"),
        suggestedRecipient: normalizeCommunicationPhone(patient.phone),
      },
    },
  };
}

function isActivePatient(document) {
  return document && document.data?.archived !== true;
}

export function projectCommunicationDesk({
  appointments = [],
  tasks = [],
  patientDocuments = new Map(),
  preferences = new Map(),
  outbox = [],
  now = new Date(),
}) {
  const sources = [
    ...appointments
      .filter((item) => ACTIONABLE_APPOINTMENT_STATUSES.has(String(item.status || "")))
      .map((item) => ({ source: item, sourceType: "appointment" })),
    ...tasks
      .filter((item) => item.status === "open" && RECALL_TASK_TYPES.has(String(item.type || "")))
      .map((item) => ({ source: item, sourceType: "task" })),
  ].slice(0, MAX_CANDIDATES);

  let unlinked = 0;
  let archived = 0;
  const candidates = sources.flatMap(({ source, sourceType }) => {
    const patientId = String(source.patientId || "");
    if (!validDocumentId(patientId)) {
      unlinked += 1;
      return [];
    }
    const patientDocument = patientDocuments.get(patientId);
    if (!isActivePatient(patientDocument)) {
      archived += 1;
      return [];
    }
    return [sourceCandidate(
      source,
      sourceType,
      { id: patientId, ...patientDocument.data },
      preferences.get(patientId)?.data,
      now,
    )];
  });

  const activePatientNames = new Map(
    Array.from(patientDocuments.entries())
      .filter(([, patient]) => isActivePatient(patient))
      .map(([id, patient]) => [id, String(patient.data.fullName || "Patient")]),
  );
  const visibleOutbox = outbox.flatMap((entry) => {
    const patientName = activePatientNames.get(String(entry.patientId || ""));
    if (!patientName) return [];
    return [{
      id: entry.id,
      patientId: String(entry.patientId || ""),
      patientName,
      sourceType: String(entry.sourceType || ""),
      purpose: String(entry.purpose || "care"),
      channel: String(entry.channel || ""),
      maskedRecipient: maskedRecipient(entry.recipient, entry.channel),
      scheduledFor: String(entry.scheduledFor || ""),
      status: String(entry.status || "ready"),
      deliveryMode: String(entry.deliveryMode || "manual_fallback"),
      createdAt: String(entry.createdAt || ""),
      updatedAt: String(entry.updatedAt || ""),
      expiresAt: String(entry.expiresAt || ""),
      lastOpenedAt: String(entry.lastOpenedAt || ""),
      deliveredAt: String(entry.deliveredAt || ""),
      failureCode: String(entry.failureCode || ""),
    }];
  });

  return {
    providerMode: "manual_fallback",
    candidates,
    outbox: visibleOutbox,
    excluded: { unlinked, archived },
    summary: {
      due: candidates.length,
      consentReady: candidates.filter((item) => (
        item.channels.whatsapp.status === "granted"
      )).length,
      readyToOpen: visibleOutbox.filter((item) => ["ready", "opened", "failed"].includes(item.status)).length,
      delivered: visibleOutbox.filter((item) => item.status === "delivered").length,
    },
  };
}

async function loadPatientDocuments(env, patientIds) {
  const unique = Array.from(new Set(patientIds.filter(validDocumentId))).slice(0, MAX_CANDIDATES);
  const documents = await mapLimit(unique, 8, async (patientId) => ({
    patientId,
    patient: await getDocument(env, `patients/${patientId}`),
    preference: await getDocument(env, `communicationPreferences/${patientId}`),
  }));
  return {
    patients: new Map(documents.map(({ patientId, patient }) => [patientId, patient])),
    preferences: new Map(documents.map(({ patientId, preference }) => [patientId, preference])),
  };
}

export async function communicationDeskForStaff(env, staff, now = new Date()) {
  await assertCurrentCommunicationStaff(env, staff);
  const today = clinicDate(now);
  const [todayAppointments, tomorrowAppointments, tasks, outbox] = await Promise.all([
    runQuery(env, dueAppointmentQuery(today), "Appointment reminders could not be loaded."),
    runQuery(env, dueAppointmentQuery(nextDate(today)), "Appointment reminders could not be loaded."),
    runQuery(env, dueTaskQuery(today), "Patient recalls could not be loaded."),
    runQuery(env, recentOutboxQuery(), "The communication outbox could not be loaded."),
  ]);
  const appointments = [...todayAppointments, ...tomorrowAppointments];
  const patientIds = [
    ...appointments.map((item) => String(item.patientId || "")),
    ...tasks.map((item) => String(item.patientId || "")),
    ...outbox.map((item) => String(item.patientId || "")),
  ];
  const { patients, preferences } = await loadPatientDocuments(env, patientIds);
  const desk = {
    generatedAt: now.toISOString(),
    ...projectCommunicationDesk({
      appointments,
      tasks,
      patientDocuments: patients,
      preferences,
      outbox,
      now,
    }),
  };
  await commitWrites(env, [
    communicationStaffPrecondition(env, staff),
    createDocumentWrite(env, `communicationDeliveryEvents/${crypto.randomUUID().replaceAll("-", "")}`, {
      eventType: "desk_viewed",
      category: "communications",
      actorUid: staff.uid,
      actorName: staff.displayName,
      actorRole: staff.role,
      candidateCount: desk.summary.due,
      outboxCount: desk.outbox.length,
      occurredAt: now,
    }),
  ]);
  return desk;
}

async function consentEventId(patientId, channel, now) {
  const material = `${patientId}\n${channel}\n${now.toISOString()}\n${crypto.randomUUID()}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

async function captureConsent(env, staff, body, now) {
  const patientId = cleanText(body?.patientId, 128);
  if (!validDocumentId(patientId)) throw new HttpError(400, "Select a valid patient record.");
  const patientDocument = await getDocument(env, `patients/${patientId}`);
  if (!isActivePatient(patientDocument)) throw new HttpError(409, "This patient record is not active.");
  const grant = validateConsentGrant(body, { id: patientId, ...patientDocument.data }, now);
  const preference = await getDocument(env, `communicationPreferences/${patientId}`);
  const eventId = await consentEventId(patientId, grant.channel, now);
  const state = {
    status: "granted",
    recipient: grant.recipient,
    method: grant.method,
    consentVersion: CONSENT_VERSION,
    eventId,
    capturedAt: now,
    capturedBy: staff.uid,
    proxyName: grant.proxyName,
    proxyRelationship: grant.proxyRelationship,
    consentReference: grant.consentReference,
    revokedAt: null,
    revokedBy: "",
  };
  const preferencePath = `communicationPreferences/${patientId}`;
  const field = consentField(grant.purpose, grant.channel);
  const writes = [
    communicationStaffPrecondition(env, staff),
    createDocumentWrite(env, `communicationConsentEvents/${eventId}`, {
      eventType: "granted",
      patientId,
      purpose: grant.purpose,
      channel: grant.channel,
      recipient: grant.recipient,
      consentVersion: CONSENT_VERSION,
      method: grant.method,
      proxyName: grant.proxyName,
      proxyRelationship: grant.proxyRelationship,
      consentReference: grant.consentReference,
      actorUid: staff.uid,
      actorName: staff.displayName,
      occurredAt: now,
    }),
  ];
  writes.unshift(verifyDocumentWrite(env, `patients/${patientId}`, patientDocument.updateTime));
  if (preference) {
    writes.unshift(updateDocumentWrite(
      env,
      preferencePath,
      { [field]: state, updatedAt: now, updatedBy: staff.uid },
      [field, "updatedAt", "updatedBy"],
      preference.updateTime,
    ));
  } else {
    writes.unshift(createDocumentWrite(env, preferencePath, {
      schemaVersion: 1,
      patientId,
      [field]: state,
      updatedAt: now,
      updatedBy: staff.uid,
    }));
  }
  await commitWrites(env, writes);
  return { status: "granted", channel: grant.channel, maskedRecipient: maskedRecipient(grant.recipient, grant.channel) };
}

async function revokeConsent(env, staff, body, now) {
  const patientId = cleanText(body?.patientId, 128);
  const channel = cleanText(body?.channel, 20);
  if (!validDocumentId(patientId) || !CARE_CHANNELS.has(channel)) {
    throw new HttpError(400, "Choose a valid patient and communication channel.");
  }
  const preference = await getDocument(env, `communicationPreferences/${patientId}`);
  const field = consentField("care", channel);
  const current = preference?.data?.[field];
  if (!preference || current?.status !== "granted") {
    throw new HttpError(409, "This channel does not have active care-reminder permission.");
  }
  const eventId = await consentEventId(patientId, channel, now);
  const state = {
    ...current,
    status: "revoked",
    eventId,
    revokedAt: now,
    revokedBy: staff.uid,
    revocationReason: cleanText(body?.reason || "patient-request", 80),
  };
  await commitWrites(env, [
    communicationStaffPrecondition(env, staff),
    updateDocumentWrite(
      env,
      `communicationPreferences/${patientId}`,
      { [field]: state, updatedAt: now, updatedBy: staff.uid },
      [field, "updatedAt", "updatedBy"],
      preference.updateTime,
    ),
    createDocumentWrite(env, `communicationConsentEvents/${eventId}`, {
      eventType: "revoked",
      patientId,
      purpose: "care",
      channel,
      recipient: String(current.recipient || ""),
      consentVersion: String(current.consentVersion || CONSENT_VERSION),
      method: "patient-request",
      actorUid: staff.uid,
      actorName: staff.displayName,
      occurredAt: now,
      reason: state.revocationReason,
    }),
  ]);
  return { status: "revoked", channel };
}

async function digestKey(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validateActionSource(sourceType, source, patientId, now) {
  if (!source || String(source.data?.patientId || "") !== patientId) {
    throw new HttpError(409, "The reminder source no longer matches this patient.");
  }
  if (sourceType === "appointment") {
    if (!ACTIONABLE_APPOINTMENT_STATUSES.has(String(source.data.status || ""))) {
      throw new HttpError(409, "This appointment no longer needs a reminder.");
    }
    const today = clinicDate(now);
    if (![today, nextDate(today)].includes(String(source.data.preferredDate || ""))) {
      throw new HttpError(409, "This appointment is outside the reminder window.");
    }
    return;
  }
  if (sourceType === "task") {
    if (
      source.data.status !== "open"
      || !RECALL_TASK_TYPES.has(String(source.data.type || ""))
      || String(source.data.dueDate || "") > clinicDate(now)
    ) {
      throw new HttpError(409, "This follow-up is no longer due.");
    }
    return;
  }
  throw new HttpError(400, "Choose a valid reminder source.");
}

async function prepareOutbox(env, staff, body, now) {
  const patientId = cleanText(body?.patientId, 128);
  const sourceType = cleanText(body?.sourceType, 20);
  const sourceId = cleanText(body?.sourceId, 128);
  const channel = cleanText(body?.channel, 20);
  if (!validDocumentId(patientId) || !validDocumentId(sourceId) || !CARE_CHANNELS.has(channel)) {
    throw new HttpError(400, "Choose a valid reminder and approved channel.");
  }
  const [patient, preference, source] = await Promise.all([
    getDocument(env, `patients/${patientId}`),
    getDocument(env, `communicationPreferences/${patientId}`),
    getDocument(env, `${sourceType === "appointment" ? "appointments" : "staffTasks"}/${sourceId}`),
  ]);
  if (!isActivePatient(patient)) throw new HttpError(409, "This patient record is not active.");
  validateActionSource(sourceType, source, patientId, now);
  const consent = preference?.data?.[consentField("care", channel)];
  if (!consent || consent.status !== "granted" || !consent.recipient) {
    throw new HttpError(409, "Record the patient’s care-reminder permission for this channel first.");
  }
  if (
    channel === "whatsapp"
    && normalizeCommunicationPhone(consent.recipient) !== normalizeCommunicationPhone(patient.data.phone)
  ) {
    throw new HttpError(409, "The approved WhatsApp number no longer matches the patient record. Reconfirm permission.");
  }
  const dedupeKey = await digestKey([
    "communication-outbox-v1", patientId, sourceType, sourceId, channel, TEMPLATE_VERSION,
  ].join("\n"));
  const baseOutboxId = `care_${dedupeKey.slice(0, 40)}`;
  const previousOutbox = await getDocument(env, `communicationOutbox/${baseOutboxId}`);
  if (previousOutbox && ["ready", "opened"].includes(String(previousOutbox.data.status || ""))) {
    return { outboxId: baseOutboxId, status: previousOutbox.data.status, channel, existing: true };
  }
  if (previousOutbox?.data.status === "delivered") {
    throw new HttpError(409, "This reminder was already marked delivered.");
  }
  const outboxId = previousOutbox
    ? `${baseOutboxId}_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`
    : baseOutboxId;
  const eventId = crypto.randomUUID().replaceAll("-", "");
  const expiresAt = new Date(now.getTime() + OUTBOX_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  await commitWrites(env, [
    communicationStaffPrecondition(env, staff),
    verifyDocumentWrite(env, `patients/${patientId}`, patient.updateTime),
    verifyDocumentWrite(env, `communicationPreferences/${patientId}`, preference.updateTime),
    verifyDocumentWrite(
      env,
      `${sourceType === "appointment" ? "appointments" : "staffTasks"}/${sourceId}`,
      source.updateTime,
    ),
    createDocumentWrite(env, `communicationOutbox/${outboxId}`, {
      patientId,
      sourceType,
      sourceId,
      purpose: "care",
      channel,
      recipient: String(consent.recipient),
      templateId: sourceType === "appointment" ? "appointment-reminder" : "follow-up-recall",
      templateVersion: TEMPLATE_VERSION,
      scheduledFor: new Date(sourceDueAt(source.data)),
      status: "ready",
      deliveryMode: "manual_fallback",
      dedupeKey,
      consentSnapshot: {
        eventId: String(consent.eventId || ""),
        consentVersion: String(consent.consentVersion || ""),
        method: String(consent.method || ""),
        capturedAt: consent.capturedAt || null,
      },
      createdBy: staff.uid,
      createdAt: now,
      updatedAt: now,
      expiresAt,
      lastOpenedAt: null,
      deliveredAt: null,
      failureCode: "",
    }),
    createDocumentWrite(env, `communicationDeliveryEvents/${eventId}`, {
      outboxId,
      patientId,
      eventType: "prepared",
      channel,
      deliveryMode: "manual_fallback",
      actorUid: staff.uid,
      actorName: staff.displayName,
      occurredAt: now,
    }),
  ]);
  return { outboxId, status: "ready", channel };
}

function neutralFallback(channel, recipient) {
  const portal = "https://asherhealthcare.in/portal";
  const body = [
    "Hello. This is Asher Women & Child Healthcare.",
    "You have a clinic reminder.",
    `Please call 90192 63709 or open ${portal} for details.`,
    "To stop care reminders, please call the clinic and our staff will record your request.",
  ].join("\n\n");
  if (channel === "email") {
    return `mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent("A reminder from Asher Healthcare")}&body=${encodeURIComponent(body)}`;
  }
  return `https://wa.me/${recipient.replace(/\D/gu, "")}?text=${encodeURIComponent(body)}`;
}

async function verifyOutboxConsent(env, outbox, now) {
  if (!outbox) throw new HttpError(404, "This outbox item no longer exists.");
  if (["delivered", "cancelled", "expired"].includes(String(outbox.data.status || ""))) {
    throw new HttpError(409, "This outbox item is already closed.");
  }
  if (Date.parse(String(outbox.data.expiresAt || "")) <= now.getTime()) {
    throw new HttpError(409, "This outbox item expired. Prepare a new reminder.");
  }
  const patientId = String(outbox.data.patientId || "");
  const channel = String(outbox.data.channel || "");
  const [patient, preference] = await Promise.all([
    getDocument(env, `patients/${patientId}`),
    getDocument(env, `communicationPreferences/${patientId}`),
  ]);
  if (!isActivePatient(patient)) throw new HttpError(409, "This patient record is not active.");
  const current = preference?.data?.[consentField("care", channel)];
  if (
    !current
    || current.status !== "granted"
    || String(current.recipient || "") !== String(outbox.data.recipient || "")
    || String(current.eventId || "") !== String(outbox.data.consentSnapshot?.eventId || "")
    || String(current.consentVersion || "") !== String(outbox.data.consentSnapshot?.consentVersion || "")
  ) {
    throw new HttpError(409, "Care-reminder permission changed. This item cannot be opened.");
  }
  return { outbox, patient, preference };
}

async function openManualFallback(env, staff, body, now) {
  const outboxId = cleanText(body?.outboxId, 128);
  if (!validDocumentId(outboxId)) throw new HttpError(400, "Choose a valid outbox item.");
  const verified = await verifyOutboxConsent(
    env,
    await getDocument(env, `communicationOutbox/${outboxId}`),
    now,
  );
  const { outbox, patient, preference } = verified;
  const sourceType = String(outbox.data.sourceType || "");
  const sourceId = String(outbox.data.sourceId || "");
  if (!validDocumentId(sourceId) || !["appointment", "task"].includes(sourceType)) {
    throw new HttpError(409, "This outbox item has an invalid reminder source.");
  }
  const sourcePath = `${sourceType === "appointment" ? "appointments" : "staffTasks"}/${sourceId}`;
  const source = await getDocument(env, sourcePath);
  validateActionSource(sourceType, source, String(outbox.data.patientId || ""), now);
  const eventId = crypto.randomUUID().replaceAll("-", "");
  await commitWrites(env, [
    communicationStaffPrecondition(env, staff),
    verifyDocumentWrite(env, `patients/${outbox.data.patientId}`, patient.updateTime),
    verifyDocumentWrite(
      env,
      `communicationPreferences/${outbox.data.patientId}`,
      preference.updateTime,
    ),
    verifyDocumentWrite(env, sourcePath, source.updateTime),
    updateDocumentWrite(
      env,
      `communicationOutbox/${outboxId}`,
      { status: "opened", lastOpenedAt: now, updatedAt: now, failureCode: "" },
      ["status", "lastOpenedAt", "updatedAt", "failureCode"],
      outbox.updateTime,
    ),
    createDocumentWrite(env, `communicationDeliveryEvents/${eventId}`, {
      outboxId,
      patientId: String(outbox.data.patientId || ""),
      eventType: "manual_opened",
      channel: String(outbox.data.channel || ""),
      deliveryMode: "manual_fallback",
      actorUid: staff.uid,
      actorName: staff.displayName,
      occurredAt: now,
    }),
  ]);
  return {
    outboxId,
    status: "opened",
    channel: outbox.data.channel,
    fallbackUrl: neutralFallback(String(outbox.data.channel), String(outbox.data.recipient)),
    notice: "Opening the app does not prove delivery. Mark delivered only after the message is sent.",
  };
}

async function updateOutboxStatus(env, staff, body, now) {
  const action = cleanText(body?.action, 30);
  const outboxId = cleanText(body?.outboxId, 128);
  if (!OUTBOX_ACTIONS.has(action) || !validDocumentId(outboxId)) {
    throw new HttpError(400, "Choose a valid outbox action.");
  }
  const outbox = await getDocument(env, `communicationOutbox/${outboxId}`);
  if (!outbox) throw new HttpError(404, "This outbox item no longer exists.");
  if (["delivered", "cancelled", "expired"].includes(String(outbox.data.status || ""))) {
    throw new HttpError(409, "This outbox item is already closed.");
  }
  if (action === "mark_delivered" && outbox.data.status !== "opened") {
    throw new HttpError(409, "Open the messaging app before marking this item delivered.");
  }
  const status = action === "mark_delivered" ? "delivered" : action === "mark_failed" ? "failed" : "cancelled";
  const failureCode = action === "mark_failed"
    ? cleanText(body?.failureCode, 40)
    : "";
  if (action === "mark_failed" && !["not_reached", "wrong_recipient", "technical_issue"].includes(failureCode)) {
    throw new HttpError(400, "Choose why the reminder could not be delivered.");
  }
  const eventId = crypto.randomUUID().replaceAll("-", "");
  await commitWrites(env, [
    communicationStaffPrecondition(env, staff),
    updateDocumentWrite(
      env,
      `communicationOutbox/${outboxId}`,
      {
        status,
        updatedAt: now,
        deliveredAt: status === "delivered" ? now : null,
        failureCode,
      },
      ["status", "updatedAt", "deliveredAt", "failureCode"],
      outbox.updateTime,
    ),
    createDocumentWrite(env, `communicationDeliveryEvents/${eventId}`, {
      outboxId,
      patientId: String(outbox.data.patientId || ""),
      eventType: status,
      channel: String(outbox.data.channel || ""),
      deliveryMode: "manual_fallback",
      failureCode,
      actorUid: staff.uid,
      actorName: staff.displayName,
      occurredAt: now,
    }),
  ]);
  return { outboxId, status };
}

export async function handleCommunicationAction(env, staff, body, now = new Date()) {
  assertCommunicationStaff(staff);
  const action = cleanText(body?.action, 30);
  if (action === "grant_consent") return captureConsent(env, staff, body, now);
  if (action === "revoke_consent") return revokeConsent(env, staff, body, now);
  if (action === "prepare") return prepareOutbox(env, staff, body, now);
  if (action === "open_manual") return openManualFallback(env, staff, body, now);
  if (OUTBOX_ACTIONS.has(action)) return updateOutboxStatus(env, staff, body, now);
  throw new HttpError(400, "Choose a valid communication action.");
}

export const communicationPolicy = Object.freeze({
  consentVersion: CONSENT_VERSION,
  templateVersion: TEMPLATE_VERSION,
  outboxRetentionDays: OUTBOX_RETENTION_DAYS,
  providerMode: "manual_fallback",
});
