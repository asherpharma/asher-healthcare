import assert from "node:assert/strict";
import test from "node:test";

import {
  createImmutableReportObject,
  deleteImmutableReportObject,
  deleteStagedReportObject,
  fetchImmutableReportObject,
  fetchStagedReportObject,
} from "../server/storage/report-finalizer-objects.js";

const env = {
  FIREBASE_PROJECT_ID: "asher-healthcare-test",
  FIREBASE_STORAGE_BUCKET: "asher-healthcare-test.firebasestorage.app",
};
const tokenProvider = async () => "test-token";
const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

test("reads one exact staged generation after checking object metadata", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("alt=media")) {
      return new Response(bytes, { status: 200, headers: { "Content-Type": "application/pdf" } });
    }
    return Response.json({
      name: "pending-reports/patient-1/7ebf45a1-report.pdf",
      size: String(bytes.byteLength),
      contentType: "application/pdf",
      generation: "41",
      metadata: {
        patientId: "patient-1",
        labOrderId: "lab-order-1",
        uploadedBy: "staff-1",
      },
    });
  };

  const result = await fetchStagedReportObject(
    env,
    "pending-reports/patient-1/7ebf45a1-report.pdf",
    { fetchImpl, accessTokenProvider: tokenProvider },
  );
  assert.equal(result.generation, "41");
  assert.equal(result.metadata.labOrderId, "lab-order-1");
  assert.deepEqual(result.bytes, bytes);
  assert.match(calls[1].url, /alt=media/u);
  assert.match(calls[1].url, /generation=41/u);
});

test("creates a permanent object only when generation is zero", async () => {
  let captured;
  const fetchImpl = async (url, options = {}) => {
    captured = { url: String(url), options };
    return Response.json({
      name: "lab-reports/patient-1/lab-order-1.pdf",
      size: String(bytes.byteLength),
      contentType: "application/pdf",
      generation: "42",
    });
  };
  const result = await createImmutableReportObject(
    env,
    "lab-reports/patient-1/lab-order-1.pdf",
    { bytes, contentType: "application/pdf" },
    { fetchImpl, accessTokenProvider: tokenProvider },
  );
  assert.equal(result.created, true);
  assert.equal(captured.options.method, "POST");
  assert.match(captured.url, /ifGenerationMatch=0/u);
  assert.match(captured.url, /uploadType=media/u);
});

test("the finalizer refuses the browser-writable legacy reports namespace", async () => {
  let fetched = false;
  await assert.rejects(
    createImmutableReportObject(
      env,
      "reports/patient-1/lab-order-1.pdf",
      { bytes, contentType: "application/pdf" },
      {
        fetchImpl: async () => {
          fetched = true;
          return new Response(null, { status: 500 });
        },
        accessTokenProvider: tokenProvider,
      },
    ),
    (error) => error instanceof Error && /permanent report location/u.test(error.message),
  );
  assert.equal(fetched, false);
});

test("accepts an exact existing immutable object for interrupted-commit recovery", async () => {
  let call = 0;
  const authorizations = [];
  const fetchImpl = async (_url, options = {}) => {
    call += 1;
    authorizations.push(options.headers?.Authorization || "");
    if (call === 1) return new Response("precondition", { status: 412 });
    if (call === 2) {
      return Response.json({
        name: "lab-reports/patient-1/lab-order-1.pdf",
        size: String(bytes.byteLength),
        contentType: "application/pdf",
        generation: "42",
      });
    }
    return new Response(bytes, { status: 200 });
  };
  const result = await createImmutableReportObject(
    env,
    "lab-reports/patient-1/lab-order-1.pdf",
    { bytes, contentType: "application/pdf" },
    {
      fetchImpl,
      accessTokenProvider: async () => "writer-token",
      permanentReadAccessTokenProvider: async () => "reader-token",
    },
  );
  assert.deepEqual(result, { generation: "42", created: false });
  assert.equal(authorizations[0], "Bearer writer-token");
  assert.deepEqual(authorizations.slice(1), ["Bearer reader-token", "Bearer reader-token"]);
});

test("deletes only the exact staged generation after finalization", async () => {
  let captured;
  const fetchImpl = async (url, options = {}) => {
    captured = { url: String(url), options };
    return new Response(null, { status: 204 });
  };
  await deleteStagedReportObject(
    env,
    "pending-reports/patient-1/7ebf45a1-report.pdf",
    "41",
    { fetchImpl, accessTokenProvider: tokenProvider },
  );
  assert.equal(captured.options.method, "DELETE");
  assert.match(captured.url, /ifGenerationMatch=41/u);
});

test("reconciliation reads and deletes only the reserved permanent namespace and exact generation", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (options.method === "DELETE") return new Response(null, { status: 204 });
    if (String(url).includes("alt=media")) return new Response(bytes, { status: 200 });
    return Response.json({
      name: "lab-reports/patient-1/lab-order-1.pdf",
      size: String(bytes.byteLength),
      contentType: "application/pdf",
      generation: "42",
    });
  };
  const object = await fetchImmutableReportObject(
    env,
    "lab-reports/patient-1/lab-order-1.pdf",
    { fetchImpl, accessTokenProvider: async () => "reader-token" },
  );
  assert.equal(object.generation, "42");
  await deleteImmutableReportObject(
    env,
    "lab-reports/patient-1/lab-order-1.pdf",
    "42",
    { fetchImpl, accessTokenProvider: async () => "cleanup-token" },
  );
  const deletion = calls.at(-1);
  assert.equal(deletion.options.method, "DELETE");
  assert.equal(deletion.options.headers.Authorization, "Bearer cleanup-token");
  assert.match(deletion.url, /ifGenerationMatch=42/u);

  await assert.rejects(
    deleteImmutableReportObject(
      env,
      "reports/patient-1/lab-order-1.pdf",
      "42",
      { fetchImpl, accessTokenProvider: async () => "cleanup-token" },
    ),
    /permanent report location/iu,
  );
});

test("writer code uses a dedicated bucket-scoped credential instead of the read-only account", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(
    new URL("../server/storage/report-finalizer-objects.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /FIREBASE_REPORT_WRITER_CLIENT_EMAIL/u);
  assert.match(source, /FIREBASE_REPORT_WRITER_PRIVATE_KEY/u);
  assert.match(source, /FIREBASE_REPORT_CLEANUP_CLIENT_EMAIL/u);
  assert.match(source, /FIREBASE_REPORT_CLEANUP_PRIVATE_KEY/u);
  assert.match(source, /permanentReadAccessTokenProvider = serviceAccountAccessToken/u);
  assert.doesNotMatch(source, /env\.FIREBASE_CLIENT_EMAIL/u);
  assert.doesNotMatch(source, /env\.FIREBASE_PRIVATE_KEY/u);
});

test("deployment guidance forbids broad Storage roles and splits prefix-scoped permissions", async () => {
  const { readFile } = await import("node:fs/promises");
  const guide = await readFile(new URL("../DEPLOYMENT.md", import.meta.url), "utf8");
  assert.match(guide, /delivery[\s\S]*only\s+`storage\.objects\.get`/u);
  assert.match(guide, /Pending report worker[\s\S]*`storage\.objects\.get`, `storage\.objects\.delete`/u);
  assert.match(guide, /Permanent report creator[\s\S]*`storage\.objects\.create`/u);
  assert.match(guide, /objects\/pending-reports\//u);
  assert.match(guide, /objects\/lab-reports\//u);
  assert.match(guide, /must never receive get, update, or[\s\S]*delete permission on `lab-reports\/`/u);
  assert.match(guide, /FIREBASE_REPORT_CLEANUP_/u);
  assert.match(guide, /cleanup[\s\S]*only `storage\.objects\.delete`/u);
  assert.match(guide, /ifGenerationMatch/u);
  assert.match(guide, /Uniform Bucket-Level Access/u);
  assert.match(guide, /IAM policy version 3/u);
  assert.doesNotMatch(guide, /Grant \*\*Storage Object (?:Viewer|User)\*\*/u);
});

test("Storage rules reserve permanent lab promotion for the trusted finalizer", async () => {
  const { readFile } = await import("node:fs/promises");
  const rules = await readFile(new URL("../storage.rules", import.meta.url), "utf8");
  assert.match(rules, /match \/pending-reports\/\{patientId\}\/\{fileName\}[\s\S]*validPendingReportCreate/u);
  assert.match(rules, /metadataKeys\.hasOnly\(\['patientId', 'uploadedBy'\]\)/u);
  const permanentBlock = rules.match(/match \/reports\/\{patientId\}\/\{fileName\} \{([\s\S]*?)\n    \}/u)?.[1] || "";
  assert.match(permanentBlock, /allow create: if \(isAdmin\(\) \|\| isAssignedDoctor\(patientId\)\)/u);
  assert.doesNotMatch(permanentBlock, /isReception\(\)|labOrderId/u);
  assert.match(permanentBlock, /allow read: if false/u);
  assert.match(permanentBlock, /allow update: if false/u);
  assert.match(permanentBlock, /allow delete: if false/u);
  const labPermanentBlock = rules.match(/match \/lab-reports\/\{patientId\}\/\{fileName\} \{([\s\S]*?)\n    \}/u)?.[1] || "";
  assert.match(labPermanentBlock, /allow read, write: if false/u);
});
