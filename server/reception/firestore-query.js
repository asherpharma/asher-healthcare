import { serviceAccountAccessToken } from "../razorpay/firebase.js";
import { HttpError } from "../razorpay/http.js";

function decodeValue(value = {}) {
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("booleanValue" in value) return value.booleanValue;
  if ("nullValue" in value) return null;
  return undefined;
}

function decodeFields(fields = {}) {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]),
  );
}

async function runStructuredQuery(env, structuredQuery, errorMessage) {
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
    console.error("Reception Firestore query failed", response.status, result?.error?.status);
    throw new HttpError(503, errorMessage);
  }
  return result;
}

export async function patientsForDateOfBirth(env, dateOfBirth) {
  const result = await runStructuredQuery(
    env,
    {
      from: [{ collectionId: "patients" }],
      where: {
        fieldFilter: {
          field: { fieldPath: "dateOfBirth" },
          op: "EQUAL",
          value: { stringValue: dateOfBirth },
        },
      },
      select: {
        fields: [
          { fieldPath: "fullName" },
          { fieldPath: "phone" },
          { fieldPath: "dateOfBirth" },
          { fieldPath: "gender" },
          { fieldPath: "patientNumber" },
          { fieldPath: "archived" },
        ],
      },
      limit: 1000,
    },
    "The patient register could not be checked for duplicates. Please try again.",
  );

  return result.flatMap((row) => {
    if (!row?.document?.name) return [];
    const encodedId = row.document.name.split("/").at(-1) || "";
    return [{
      id: decodeURIComponent(encodedId),
      data: decodeFields(row.document.fields || {}),
      updateTime: row.document.updateTime,
    }];
  });
}

export async function maximumQueueTokenForDay(env, doctorId, date) {
  const result = await runStructuredQuery(
    env,
    {
      from: [{ collectionId: "appointments" }],
      where: {
        fieldFilter: {
          field: { fieldPath: "preferredDate" },
          op: "EQUAL",
          value: { stringValue: date },
        },
      },
      select: {
        fields: [
          { fieldPath: "doctorId" },
          { fieldPath: "queueToken" },
        ],
      },
      limit: 1000,
    },
    "The clinic queue could not be prepared. Please try again.",
  );

  return result.reduce((maximum, row) => {
    const data = decodeFields(row?.document?.fields || {});
    if (data.doctorId !== doctorId || !Number.isInteger(data.queueToken)) return maximum;
    return Math.max(maximum, Number(data.queueToken));
  }, 0);
}
