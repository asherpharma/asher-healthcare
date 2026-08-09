import { serviceAccountAccessToken } from "../razorpay/firebase.js";
import { HttpError } from "../razorpay/http.js";
import { validDocumentId } from "../razorpay/payments.js";

const MAX_REPORT_BYTES = 10 * 1024 * 1024;
const REPORT_CONTENT_TYPES = new Map([
  ["application/pdf", "pdf"],
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

function configuredBucket(env) {
  const bucket = String(
    env?.FIREBASE_STORAGE_BUCKET || env?.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "",
  ).trim().replace(/^gs:\/\//u, "");
  if (
    bucket.length < 3
    || bucket.length > 222
    || !/^[a-z0-9][a-z0-9._-]*[a-z0-9]$/u.test(bucket)
  ) {
    throw new HttpError(
      503,
      "Secure report storage is not configured. Please contact the clinic administrator.",
    );
  }
  return bucket;
}

function validateNamespacedReportPath(storagePath, patientId, namespaces) {
  const path = typeof storagePath === "string" ? storagePath.trim() : "";
  if (!validDocumentId(patientId)) {
    throw new HttpError(409, "This report is not linked to a valid patient record.");
  }

  const prefix = namespaces
    .map((namespace) => `${namespace}/${patientId}/`)
    .find((candidate) => path.startsWith(candidate)) || "";
  const fileName = path.startsWith(prefix) ? path.slice(prefix.length) : "";
  if (
    !prefix
    || path.length > 1_500
    || !fileName
    || fileName.length > 220
    || fileName.includes("..")
    || fileName.includes("/")
    || /[\u0000-\u001f\u007f]/u.test(path)
    || !/^[A-Za-z0-9][A-Za-z0-9._-]*[.](pdf|jpg|jpeg|png|webp)$/u.test(fileName)
  ) {
    throw new HttpError(409, "This report file is not stored in a secure patient location.");
  }
  return path;
}

/** Browser-created clinical reports may only point into the generic namespace. */
export function validatePatientReportPath(storagePath, patientId) {
  return validateNamespacedReportPath(storagePath, patientId, ["reports"]);
}

/**
 * New finalized lab reports use the server-only lab-reports namespace. The
 * legacy reports namespace remains readable so records finalized before this
 * migration do not disappear from the lab-order workflow.
 */
export function validateLabReportPath(storagePath, patientId) {
  return validateNamespacedReportPath(
    storagePath,
    patientId,
    ["lab-reports", "reports"],
  );
}

function storageObjectUrl(bucket, storagePath, query = "") {
  const base = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(storagePath)}`;
  return query ? `${base}?${query}` : base;
}

async function storageRequest(fetchImpl, url, accessToken) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json, application/pdf, image/jpeg, image/png, image/webp",
      },
    });
  } catch {
    throw new HttpError(503, "Secure report storage is temporarily unavailable.");
  }

  if (response.status === 404) {
    throw new HttpError(404, "This report file is no longer available.");
  }
  if (!response.ok) {
    throw new HttpError(503, "Secure report storage is temporarily unavailable.");
  }
  return response;
}

/**
 * Retrieves one immutable patient report through the trusted service account.
 * The object is metadata-checked first and the exact observed generation is
 * streamed, so a browser never receives a Firebase Storage bearer URL.
 */
async function fetchReportObject(
  env,
  storagePath,
  patientId,
  pathValidator,
  {
    fetchImpl = fetch,
    accessTokenProvider = serviceAccountAccessToken,
  } = {},
) {
  const path = pathValidator(storagePath, patientId);
  const bucket = configuredBucket(env);
  const accessToken = await accessTokenProvider(env);
  const metadataResponse = await storageRequest(
    fetchImpl,
    storageObjectUrl(bucket, path, "fields=name,size,contentType,generation"),
    accessToken,
  );

  let metadata;
  try {
    metadata = await metadataResponse.json();
  } catch {
    throw new HttpError(503, "Secure report storage is temporarily unavailable.");
  }
  const contentType = String(metadata?.contentType || "").split(";", 1)[0].trim().toLowerCase();
  const extension = REPORT_CONTENT_TYPES.get(contentType);
  const size = Number(metadata?.size);
  const generation = String(metadata?.generation || "");
  if (
    metadata?.name !== path
    || !extension
    || !Number.isSafeInteger(size)
    || size <= 0
    || size > MAX_REPORT_BYTES
    || !/^\d+$/u.test(generation)
  ) {
    throw new HttpError(409, "This report file cannot be opened securely.");
  }

  const mediaResponse = await storageRequest(
    fetchImpl,
    storageObjectUrl(
      bucket,
      path,
      new URLSearchParams({ alt: "media", generation }).toString(),
    ),
    accessToken,
  );
  if (!mediaResponse.body) {
    throw new HttpError(503, "Secure report storage is temporarily unavailable.");
  }

  return {
    body: mediaResponse.body,
    contentType,
    extension,
    size,
  };
}

export function fetchPatientReportObject(env, storagePath, patientId, options) {
  return fetchReportObject(
    env,
    storagePath,
    patientId,
    validatePatientReportPath,
    options,
  );
}

export function fetchLabReportObject(env, storagePath, patientId, options) {
  return fetchReportObject(
    env,
    storagePath,
    patientId,
    validateLabReportPath,
    options,
  );
}

export function patientReportStreamResponse(reportObject, action) {
  const disposition = action === "download" ? "attachment" : "inline";
  return new Response(reportObject.body, {
    status: 200,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Disposition": `${disposition}; filename="medical-report.${reportObject.extension}"`,
      "Content-Length": String(reportObject.size),
      "Content-Security-Policy": "sandbox",
      "Content-Type": reportObject.contentType,
      "Cross-Origin-Resource-Policy": "same-origin",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
