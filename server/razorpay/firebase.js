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
    scope: [
      "https://www.googleapis.com/auth/datastore",
      "https://www.googleapis.com/auth/identitytoolkit",
    ].join(" "),
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

export async function serviceAccountAccessToken(env) {
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
        ? "This clinic record changed. Please refresh and try again."
        : "The secure clinic database could not complete this request.",
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

export function assertActivePatientDocument(patientDocument, {
  missingStatus = 409,
  missingMessage = "The selected patient record no longer exists.",
  archivedStatus = 409,
  archivedMessage = "The selected patient record is archived. Restore it before continuing.",
} = {}) {
  if (!patientDocument) {
    throw new HttpError(missingStatus, missingMessage);
  }
  if (patientDocument.data?.archived === true) {
    throw new HttpError(archivedStatus, archivedMessage);
  }
  return patientDocument;
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

export function verifyDocumentWrite(env, path, updateTime) {
  const segments = typeof path === "string" ? path.split("/") : [];
  const validPath = (
    typeof path === "string"
    && path === path.trim()
    && path.length > 0
    && path.length <= 1_500
    && segments.length % 2 === 0
    && segments.every((segment) => (
      segment.length > 0
      && segment !== "."
      && segment !== ".."
      && !/[\u0000-\u001f\u007f]/u.test(segment)
    ))
  );
  const validUpdateTime = (
    typeof updateTime === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(updateTime)
    && !Number.isNaN(Date.parse(updateTime))
  );

  if (!validPath || !validUpdateTime) {
    throw new HttpError(500, "A secure database write precondition was invalid.");
  }

  return {
    verify: documentName(env, path),
    currentDocument: { updateTime },
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
    displayName: staff.data.displayName || firebaseUser.displayName || firebaseUser.email || "Clinic staff",
    role,
    staffUpdateTime: staff.updateTime,
  };
}

export function assertBillingStaff(staff) {
  if (!staff || !["admin", "reception"].includes(staff.role)) {
    throw new HttpError(403, "Only clinic administrators and reception staff can manage payments.");
  }
  return staff;
}

export async function requireAdminStaff(request, env) {
  const staff = await requireActiveStaff(request, env);
  if (staff.role !== "admin") {
    throw new HttpError(403, "Only a clinic administrator can perform this action.");
  }
  return staff;
}

async function identityToolkitRequest(env, path, body) {
  requireEnvironment(env, ["FIREBASE_PROJECT_ID", "FIREBASE_WEB_API_KEY"]);
  const accessToken = await serviceAccountAccessToken(env);
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/${path}?key=${encodeURIComponent(env.FIREBASE_WEB_API_KEY)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  const result = await response.json();
  if (!response.ok) {
    const code = String(result?.error?.message || "");
    if (code.includes("EMAIL_EXISTS")) {
      throw new HttpError(409, "A sign-in account already exists for this email address.");
    }
    if (code.includes("WEAK_PASSWORD")) {
      throw new HttpError(503, "The secure staff credential could not be generated. Please try again.");
    }
    if (code.includes("EMAIL_NOT_FOUND") || code.includes("USER_NOT_FOUND")) {
      throw new HttpError(409, "This staff sign-in account no longer exists.");
    }
    if (code.includes("TOO_MANY_ATTEMPTS_TRY_LATER")) {
      throw new HttpError(429, "Too many invitation emails were requested. Please wait and try again.");
    }
    if (
      code.includes("UNAUTHORIZED_DOMAIN")
      || code.includes("INVALID_CONTINUE_URI")
      || code.includes("MISSING_CONTINUE_URI")
    ) {
      throw new HttpError(503, "The secure staff invitation link is not configured correctly.");
    }
    console.error("Identity Toolkit error", response.status, code);
    throw new HttpError(503, "The secure staff account service could not complete this request.");
  }
  return result;
}

export function createRandomPassword() {
  const randomBytes = crypto.getRandomValues(new Uint8Array(32));
  return `${bytesToBase64Url(randomBytes)}-aA1!`;
}

export function createAuthUser(env, { displayName, email, password }) {
  return identityToolkitRequest(
    env,
    `projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/accounts`,
    {
      displayName,
      email,
      password,
      emailVerified: false,
      disabled: false,
    },
  );
}

export function deleteAuthUser(env, localId) {
  return identityToolkitRequest(
    env,
    `projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/accounts:delete`,
    { localId },
  );
}

export function sendPasswordResetEmail(env, email, continueUrl) {
  return identityToolkitRequest(
    env,
    "accounts:sendOobCode",
    {
      requestType: "PASSWORD_RESET",
      email,
      continueUrl,
      canHandleCodeInApp: false,
      targetProjectId: env.FIREBASE_PROJECT_ID,
    },
  );
}
