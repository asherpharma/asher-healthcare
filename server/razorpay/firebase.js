import { HttpError, requireEnvironment } from "./http.js";

let cachedAccessToken = null;
let cachedAccessTokenExpiry = 0;

function bytesToBase64Url(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function textToBase64Url(value) {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function privateKeyBytes(pem) {
  const normalized = pem
    .replaceAll("\\n", "\n")
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/gu, "");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

async function createServiceAccountAssertion(env) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = textToBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = textToBase64Url(JSON.stringify({
    iss: env.FIREBASE_CLIENT_EMAIL,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: issuedAt,
    exp: issuedAt + 3600,
  }));
  const unsignedToken = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyBytes(env.FIREBASE_PRIVATE_KEY),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsignedToken),
  );
  return `${unsignedToken}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

async function serviceAccountAccessToken(env) {
  requireEnvironment(env, [
    "FIREBASE_PROJECT_ID",
    "FIREBASE_CLIENT_EMAIL",
    "FIREBASE_PRIVATE_KEY",
  ]);

  if (cachedAccessToken && Date.now() < cachedAccessTokenExpiry - 60_000) {
    return cachedAccessToken;
  }

  const assertion = await createServiceAccountAssertion(env);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const result = await response.json();
  if (!response.ok || !result.access_token) {
    throw new HttpError(503, "The clinic database service account could not be authenticated.");
  }

  cachedAccessToken = result.access_token;
  cachedAccessTokenExpiry = Date.now() + Number(result.expires_in || 3600) * 1000;
  return cachedAccessToken;
}

function encodeValue(value) {
  if (value === null) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };

  switch (typeof value) {
    case "string":
      return { stringValue: value };
    case "boolean":
      return { booleanValue: value };
    case "number":
      if (!Number.isFinite(value)) throw new HttpError(500, "A database number was invalid.");
      return Number.isInteger(value)
        ? { integerValue: String(value) }
        : { doubleValue: value };
    case "object":
      return { mapValue: { fields: encodeFields(value) } };
    default:
      throw new HttpError(500, "A database value could not be encoded.");
  }
}

function encodeFields(data) {
  return Object.fromEntries(
    Object.entries(data)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, encodeValue(value)]),
  );
}

function decodeValue(value = {}) {
  if ("nullValue" in value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("referenceValue" in value) return value.referenceValue;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(decodeValue);
  if ("mapValue" in value) return decodeFields(value.mapValue.fields || {});
  return undefined;
}

function decodeFields(fields = {}) {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]),
  );
}

function documentPath(env, path = "") {
  const encodedPath = path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const base = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/databases/(default)/documents`;
  return encodedPath ? `${base}/${encodedPath}` : base;
}

export function documentName(env, path) {
  return `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`;
}

async function firestoreRequest(env, url, options = {}) {
  const accessToken = await serviceAccountAccessToken(env);
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (response.status === 404) return null;
  const result = await response.json();
  if (!response.ok) {
    console.error("Firestore REST error", response.status, result?.error?.status);
    throw new HttpError(
      response.status === 409 || response.status === 412 ? 409 : 503,
      response.status === 409 || response.status === 412
        ? "This billing record changed during payment. Please retry verification."
        : "The clinic database could not complete this payment.",
    );
  }
  return result;
}

export async function getDocument(env, path) {
  const result = await firestoreRequest(env, documentPath(env, path));
  if (!result) return null;
  return {
    data: decodeFields(result.fields || {}),
    name: result.name,
    updateTime: result.updateTime,
  };
}

export async function commitWrites(env, writes) {
  return firestoreRequest(
    env,
    `${documentPath(env)}:commit`,
    { method: "POST", body: JSON.stringify({ writes }) },
  );
}

export function createDocumentWrite(env, path, data) {
  return {
    update: {
      name: documentName(env, path),
      fields: encodeFields(data),
    },
    currentDocument: { exists: false },
  };
}

export function updateDocumentWrite(env, path, data, fieldPaths, updateTime) {
  return {
    update: {
      name: documentName(env, path),
      fields: encodeFields(data),
    },
    updateMask: { fieldPaths },
    currentDocument: { updateTime },
  };
}

export async function requireActiveStaff(request, env) {
  requireEnvironment(env, ["FIREBASE_WEB_API_KEY"]);
  const authorization = request.headers.get("Authorization") || "";
  const idToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!idToken) throw new HttpError(401, "Sign in to the staff portal before taking a payment.");

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_WEB_API_KEY)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    },
  );
  const result = await response.json();
  const firebaseUser = result.users?.[0];
  if (!response.ok || !firebaseUser?.localId) {
    throw new HttpError(401, "Your staff session has expired. Sign in again.");
  }

  const staff = await getDocument(env, `staff/${firebaseUser.localId}`);
  const role = staff?.data?.role;
  if (
    !staff
    || staff.data.active !== true
    || !["admin", "doctor", "reception"].includes(role)
  ) {
    throw new HttpError(403, "This account is not authorized to collect clinic payments.");
  }

  return {
    uid: firebaseUser.localId,
    email: firebaseUser.email || "",
    role,
  };
}
