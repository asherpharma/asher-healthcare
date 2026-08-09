import { HttpError, requireEnvironment } from "../razorpay/http.js";
import { serviceAccountAccessToken } from "../razorpay/firebase.js";

const MAX_REPORT_BYTES = 10 * 1024 * 1024;
// OAuth scope expresses the API capability; IAM independently constrains the
// writer to get/delete pending objects and create permanent objects by prefix.
const STORAGE_SCOPE = "https://www.googleapis.com/auth/devstorage.full_control";
const ALLOWED_CONTENT_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

let cachedStorageToken = null;
let cachedStorageTokenExpiry = 0;
let cachedCleanupToken = null;
let cachedCleanupTokenExpiry = 0;

function bytesToBase64Url(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
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

function textToBase64Url(value) {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function configuredBucket(env) {
  const bucket = String(
    env?.FIREBASE_STORAGE_BUCKET || env?.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "",
  ).trim().replace(/^gs:\/\//u, "");
  if (
    bucket.length < 3
    || bucket.length > 222
    || !/^[a-z0-9][a-z0-9._-]*[a-z0-9]$/u.test(bucket)
  ) {
    throw new HttpError(503, "Secure report storage is not configured.");
  }
  return bucket;
}

function stagedPath(value) {
  const path = typeof value === "string" ? value.trim() : "";
  if (!/^pending-reports\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{8,100}-report[.](?:pdf|jpg|jpeg|png|webp)$/u.test(path)) {
    throw new HttpError(409, "The staged report location is invalid.");
  }
  return path;
}

function permanentPath(value) {
  const path = typeof value === "string" ? value.trim() : "";
  if (!/^lab-reports\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,128}[.](?:pdf|jpg|png|webp)$/u.test(path)) {
    throw new HttpError(409, "The permanent report location is invalid.");
  }
  return path;
}

async function createStorageAssertion(env, emailField, privateKeyField) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = textToBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = textToBase64Url(JSON.stringify({
    iss: env[emailField],
    scope: STORAGE_SCOPE,
    aud: "https://oauth2.googleapis.com/token",
    iat: issuedAt,
    exp: issuedAt + 3600,
  }));
  const unsignedToken = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyBytes(env[privateKeyField]),
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

async function storageWriterAccessToken(env, fetchImpl = fetch) {
  requireEnvironment(env, [
    "FIREBASE_REPORT_WRITER_CLIENT_EMAIL",
    "FIREBASE_REPORT_WRITER_PRIVATE_KEY",
  ]);
  if (cachedStorageToken && Date.now() < cachedStorageTokenExpiry - 60_000) {
    return cachedStorageToken;
  }

  const response = await safeFetch(fetchImpl, "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: await createStorageAssertion(
        env,
        "FIREBASE_REPORT_WRITER_CLIENT_EMAIL",
        "FIREBASE_REPORT_WRITER_PRIVATE_KEY",
      ),
    }),
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new HttpError(503, "Secure report storage could not be authenticated.");
  }
  if (!response.ok || !result.access_token) {
    throw new HttpError(503, "Secure report storage could not be authenticated.");
  }
  cachedStorageToken = result.access_token;
  cachedStorageTokenExpiry = Date.now() + Number(result.expires_in || 3600) * 1000;
  return cachedStorageToken;
}

async function storageCleanupAccessToken(env, fetchImpl = fetch) {
  requireEnvironment(env, [
    "FIREBASE_REPORT_CLEANUP_CLIENT_EMAIL",
    "FIREBASE_REPORT_CLEANUP_PRIVATE_KEY",
  ]);
  if (cachedCleanupToken && Date.now() < cachedCleanupTokenExpiry - 60_000) {
    return cachedCleanupToken;
  }

  const response = await safeFetch(fetchImpl, "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: await createStorageAssertion(
        env,
        "FIREBASE_REPORT_CLEANUP_CLIENT_EMAIL",
        "FIREBASE_REPORT_CLEANUP_PRIVATE_KEY",
      ),
    }),
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new HttpError(503, "Secure report cleanup could not be authenticated.");
  }
  if (!response.ok || !result.access_token) {
    throw new HttpError(503, "Secure report cleanup could not be authenticated.");
  }
  cachedCleanupToken = result.access_token;
  cachedCleanupTokenExpiry = Date.now() + Number(result.expires_in || 3600) * 1000;
  return cachedCleanupToken;
}

function objectUrl(bucket, storagePath, query = "") {
  const base = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(storagePath)}`;
  return query ? `${base}?${query}` : base;
}

function normalizeContentType(value) {
  return String(value || "").split(";", 1)[0].trim().toLowerCase();
}

async function safeFetch(fetchImpl, url, options) {
  try {
    return await fetchImpl(url, options);
  } catch {
    throw new HttpError(503, "Secure report storage is temporarily unavailable.");
  }
}

async function readObject(
  env,
  storagePath,
  {
    fetchImpl,
    accessTokenProvider,
    notFoundMessage = "The staged report file could not be found. Choose it again.",
  },
) {
  const bucket = configuredBucket(env);
  const token = await accessTokenProvider(env, fetchImpl);
  const headers = { Authorization: `Bearer ${token}` };
  const metadataResponse = await safeFetch(
    fetchImpl,
    objectUrl(bucket, storagePath, "fields=name,size,contentType,generation,metadata"),
    { headers },
  );
  if (metadataResponse.status === 404) {
    throw new HttpError(404, notFoundMessage);
  }
  if (!metadataResponse.ok) {
    throw new HttpError(503, "Secure report storage is temporarily unavailable.");
  }
  let metadata;
  try {
    metadata = await metadataResponse.json();
  } catch {
    throw new HttpError(503, "Secure report storage returned invalid metadata.");
  }
  const size = Number(metadata?.size);
  const generation = String(metadata?.generation || "");
  if (
    metadata?.name !== storagePath
    || !Number.isSafeInteger(size)
    || size <= 0
    || size > MAX_REPORT_BYTES
    || !/^\d+$/u.test(generation)
  ) {
    throw new HttpError(409, "The staged report file metadata is invalid.");
  }

  const mediaResponse = await safeFetch(
    fetchImpl,
    objectUrl(
      bucket,
      storagePath,
      new URLSearchParams({ alt: "media", generation }).toString(),
    ),
    { headers },
  );
  if (!mediaResponse.ok) {
    throw new HttpError(503, "The staged report file could not be read securely.");
  }
  const bytes = new Uint8Array(await mediaResponse.arrayBuffer());
  if (bytes.byteLength !== size) {
    throw new HttpError(409, "The staged report file changed during verification.");
  }
  return {
    bytes,
    size,
    contentType: normalizeContentType(metadata.contentType),
    generation,
    metadata: metadata.metadata && typeof metadata.metadata === "object"
      ? metadata.metadata
      : {},
  };
}

function sameBytes(left, right) {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export async function fetchStagedReportObject(
  env,
  storagePath,
  {
    fetchImpl = fetch,
    accessTokenProvider = storageWriterAccessToken,
  } = {},
) {
  return readObject(env, stagedPath(storagePath), { fetchImpl, accessTokenProvider });
}

export async function fetchImmutableReportObject(
  env,
  storagePath,
  {
    fetchImpl = fetch,
    accessTokenProvider = serviceAccountAccessToken,
  } = {},
) {
  return readObject(env, permanentPath(storagePath), {
    fetchImpl,
    accessTokenProvider,
    notFoundMessage: "The prepared permanent report object does not exist.",
  });
}

/**
 * Creates the deterministic permanent object with an ifGenerationMatch=0
 * precondition. An exact already-existing object is accepted as an idempotent
 * recovery after an interrupted database commit; different bytes are a hard
 * integrity conflict.
 */
export async function createImmutableReportObject(
  env,
  storagePath,
  { bytes, contentType },
  {
    fetchImpl = fetch,
    accessTokenProvider = storageWriterAccessToken,
    permanentReadAccessTokenProvider = serviceAccountAccessToken,
  } = {},
) {
  const path = permanentPath(storagePath);
  if (
    !(bytes instanceof Uint8Array)
    || bytes.byteLength <= 0
    || bytes.byteLength > MAX_REPORT_BYTES
    || !ALLOWED_CONTENT_TYPES.has(contentType)
  ) {
    throw new HttpError(409, "The verified report object is invalid.");
  }
  const bucket = configuredBucket(env);
  const token = await accessTokenProvider(env, fetchImpl);
  const query = new URLSearchParams({
    uploadType: "media",
    name: path,
    ifGenerationMatch: "0",
  });
  const response = await safeFetch(
    fetchImpl,
    `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?${query}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": contentType,
        "X-Content-Type-Options": "nosniff",
      },
      body: bytes,
    },
  );

  if (response.status === 409 || response.status === 412) {
    // The finalizer credential intentionally has no permanent-object read
    // permission. Idempotent recovery uses the separate get-only delivery
    // credential, preserving least privilege for the writer account.
    const existing = await readObject(env, path, {
      fetchImpl,
      accessTokenProvider: permanentReadAccessTokenProvider,
    });
    if (existing.contentType !== contentType || !sameBytes(existing.bytes, bytes)) {
      throw new HttpError(409, "A different report is already attached to this laboratory order.");
    }
    return { generation: existing.generation, created: false };
  }
  if (!response.ok) {
    throw new HttpError(503, "The verified report could not be stored securely.");
  }
  let metadata;
  try {
    metadata = await response.json();
  } catch {
    throw new HttpError(503, "The verified report storage response was invalid.");
  }
  const generation = String(metadata?.generation || "");
  if (
    metadata?.name !== path
    || Number(metadata?.size) !== bytes.byteLength
    || normalizeContentType(metadata?.contentType) !== contentType
    || !/^\d+$/u.test(generation)
  ) {
    throw new HttpError(503, "The verified report storage response was invalid.");
  }
  return { generation, created: true };
}

export async function deleteStagedReportObject(
  env,
  storagePath,
  generation,
  {
    fetchImpl = fetch,
    accessTokenProvider = storageWriterAccessToken,
  } = {},
) {
  const path = stagedPath(storagePath);
  if (!/^\d+$/u.test(String(generation || ""))) {
    throw new HttpError(409, "The staged report generation is invalid.");
  }
  const bucket = configuredBucket(env);
  const token = await accessTokenProvider(env, fetchImpl);
  const response = await safeFetch(
    fetchImpl,
    objectUrl(bucket, path, new URLSearchParams({ ifGenerationMatch: generation }).toString()),
    { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
  );
  if (response.status !== 404 && response.status !== 412 && !response.ok) {
    throw new HttpError(503, "The temporary report copy could not be removed.");
  }
  return response.status !== 412;
}

export async function deleteImmutableReportObject(
  env,
  storagePath,
  generation,
  {
    fetchImpl = fetch,
    accessTokenProvider = storageCleanupAccessToken,
    allowMissing = false,
  } = {},
) {
  const path = permanentPath(storagePath);
  if (!/^\d+$/u.test(String(generation || ""))) {
    throw new HttpError(409, "The permanent report generation is invalid.");
  }
  const bucket = configuredBucket(env);
  const token = await accessTokenProvider(env, fetchImpl);
  const response = await safeFetch(
    fetchImpl,
    objectUrl(bucket, path, new URLSearchParams({ ifGenerationMatch: generation }).toString()),
    { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
  );
  if (response.status === 404 && allowMissing) return { deleted: false, missing: true };
  if (response.status === 404) {
    throw new HttpError(404, "The prepared permanent report object does not exist.");
  }
  if (response.status === 409 || response.status === 412) {
    throw new HttpError(409, "The permanent report generation changed and was not deleted.");
  }
  if (!response.ok) {
    throw new HttpError(503, "The verified permanent report object could not be discarded.");
  }
  return { deleted: true, missing: false };
}

export const REPORT_FINALIZER_STORAGE = Object.freeze({
  fetchStagedReportObject,
  fetchImmutableReportObject,
  createImmutableReportObject,
  deleteStagedReportObject,
});

export const REPORT_RECONCILIATION_STORAGE = Object.freeze({
  fetchImmutableReportObject,
  deleteImmutableReportObject,
  deleteStagedReportObject,
});
