import assert from "node:assert/strict";
import test from "node:test";

import { HttpError } from "../server/razorpay/http.js";
import {
  getServiceCatalogForAdministrator,
  setServiceCatalogForAdministrator,
  validateCompleteServiceCatalog,
  validateServiceCatalogMutation,
} from "../server/reception/service-catalog-management.js";

const env = { FIREBASE_PROJECT_ID: "asher-healthcare-test" };
const ADMIN_TIME = "2026-08-13T08:00:00.123456Z";
const CATALOG_TIME = "2026-08-13T08:01:00.123456Z";
const NEXT_TIME = "2026-08-13T08:02:00.123456Z";

function catalog(overrides = {}) {
  return {
    schemaVersion: 1,
    services: {
      general: { label: "General consultation", fee: 250, active: true },
      pediatrics: { label: "Pediatric consultation", fee: 500, active: true },
      obg: { label: "Obstetrics & Gynaecology consultation", fee: 500, active: true },
      ...overrides,
    },
  };
}

function administrator(overrides = {}) {
  return {
    updateTime: ADMIN_TIME,
    data: {
      active: true,
      role: "admin",
      displayName: "Clinic Admin",
      email: "private-admin@example.test",
      ...overrides,
    },
  };
}

function catalogDocument(value = catalog(), updateTime = CATALOG_TIME) {
  return { data: value, updateTime };
}

function fakeDatabase(initialDocuments, { committedCatalog = null } = {}) {
  const documents = { ...initialDocuments };
  const reads = [];
  const commits = [];
  let catalogReads = 0;
  return {
    reads,
    commits,
    async getDocument(_env, path) {
      reads.push(path);
      if (path === "clinicSettings/serviceCatalog") {
        catalogReads += 1;
        if (catalogReads > 1 && committedCatalog) return committedCatalog;
      }
      return documents[path] || null;
    },
    verifyDocumentWrite(_env, path, updateTime) {
      return { verify: path, currentDocument: { updateTime } };
    },
    createDocumentWrite(_env, path, data) {
      return { create: path, data, currentDocument: { exists: false } };
    },
    updateDocumentWrite(_env, path, data, fieldPaths, updateTime) {
      return { update: path, data, fieldPaths, currentDocument: { updateTime } };
    },
    async commitWrites(_env, writes) {
      commits.push(writes);
      return { commitTime: NEXT_TIME };
    },
  };
}

const actor = {
  uid: "admin-1",
  role: "admin",
  displayName: "Token Name",
  email: "token-private@example.test",
};

test("strict mutation validation accepts only a complete canonical catalogue", () => {
  const valid = catalog();
  assert.deepEqual(validateCompleteServiceCatalog(valid), valid);
  assert.deepEqual(validateServiceCatalogMutation({
    catalog: valid,
    expectedUpdateTime: CATALOG_TIME,
  }), {
    catalog: valid,
    expectedUpdateTime: CATALOG_TIME,
  });

  const invalidCatalogs = [
    null,
    { ...valid, extra: true },
    { schemaVersion: 2, services: valid.services },
    { schemaVersion: 1, services: { general: valid.services.general } },
    { ...valid, services: { ...valid.services, extra: valid.services.general } },
    catalog({ general: { label: "General consultation", fee: 0, active: true } }),
    catalog({ general: { label: "General consultation", fee: -1, active: true } }),
    catalog({ general: { label: "General consultation", fee: 250.5, active: true } }),
    catalog({ general: { label: "General consultation", fee: "250", active: true } }),
    catalog({ general: { label: "General consultation", fee: 100_001, active: true } }),
    catalog({ general: { label: " General consultation", fee: 250, active: true } }),
    catalog({ general: { label: "General\u0007consultation", fee: 250, active: true } }),
    catalog({ general: { label: "General consultation", fee: 250, active: "true" } }),
    catalog({
      general: { ...valid.services.general, active: false },
      pediatrics: { ...valid.services.pediatrics, active: false },
      obg: { ...valid.services.obg, active: false },
    }),
  ];
  for (const value of invalidCatalogs) {
    assert.throws(
      () => validateCompleteServiceCatalog(value),
      (error) => error instanceof HttpError && error.status === 400,
    );
  }
  for (const value of [
    null,
    { catalog: valid },
    { catalog: valid, expectedUpdateTime: "stale" },
    { catalog: valid, expectedUpdateTime: null, extra: true },
  ]) {
    assert.throws(
      () => validateServiceCatalogMutation(value),
      (error) => error instanceof HttpError && error.status === 400,
    );
  }
});

test("returns safe default fees when no catalogue document exists", async () => {
  const database = fakeDatabase({ "staff/admin-1": administrator() });
  const result = await getServiceCatalogForAdministrator(env, actor, database);
  assert.equal(result.catalog.services.general.fee, 250);
  assert.equal(result.catalog.services.pediatrics.fee, 500);
  assert.equal(result.catalog.services.obg.fee, 500);
  assert.equal(result.revision, null);
});

test("creates catalogue and audit atomically with exact preconditions", async () => {
  const next = catalog({ general: { label: "Family physician consultation", fee: 300, active: true } });
  const database = fakeDatabase(
    { "staff/admin-1": administrator() },
    { committedCatalog: catalogDocument(next, NEXT_TIME) },
  );
  const result = await setServiceCatalogForAdministrator(
    env,
    { catalog: next, expectedUpdateTime: null },
    actor,
    database,
  );

  assert.equal(database.commits.length, 1);
  const [verifyAdmin, createCatalog, audit] = database.commits[0];
  assert.deepEqual(verifyAdmin, {
    verify: "staff/admin-1",
    currentDocument: { updateTime: ADMIN_TIME },
  });
  assert.equal(createCatalog.create, "clinicSettings/serviceCatalog");
  assert.equal(createCatalog.currentDocument.exists, false);
  assert.match(audit.create, /^auditLogs\/[0-9a-f-]{36}$/u);
  assert.equal(audit.currentDocument.exists, false);
  assert.equal(audit.data.eventType, "clinic.service_catalog_created");
  assert.deepEqual(audit.data.changedServiceIds, ["general", "pediatrics", "obg"]);
  assert.equal(result.revision, NEXT_TIME);
  assert.equal(result.changed, true);
  const serializedAudit = JSON.stringify(audit);
  assert.equal(serializedAudit.includes("private-admin@example.test"), false);
  assert.equal(serializedAudit.includes("token-private@example.test"), false);
});

test("updates catalogue against its exact revision and appends one audit", async () => {
  const previous = catalog();
  const next = catalog({ pediatrics: { label: "Child specialist consultation", fee: 600, active: true } });
  const database = fakeDatabase({
    "staff/admin-1": administrator(),
    "clinicSettings/serviceCatalog": catalogDocument(previous),
  }, { committedCatalog: catalogDocument(next, NEXT_TIME) });
  const result = await setServiceCatalogForAdministrator(
    env,
    { catalog: next, expectedUpdateTime: CATALOG_TIME },
    actor,
    database,
  );

  const [, updateCatalog, audit] = database.commits[0];
  assert.equal(updateCatalog.update, "clinicSettings/serviceCatalog");
  assert.equal(updateCatalog.currentDocument.updateTime, CATALOG_TIME);
  assert.deepEqual(updateCatalog.fieldPaths, ["schemaVersion", "services", "updatedBy", "updatedAt"]);
  assert.deepEqual(audit.data.changedServiceIds, ["pediatrics"]);
  assert.deepEqual(audit.data.previousServices, previous.services);
  assert.deepEqual(audit.data.nextServices, next.services);
  assert.equal(audit.data.previousRevision, CATALOG_TIME);
  assert.equal(result.revision, NEXT_TIME);
});

test("rejects stale concurrent edits without committing", async () => {
  const database = fakeDatabase({
    "staff/admin-1": administrator(),
    "clinicSettings/serviceCatalog": catalogDocument(),
  });
  await assert.rejects(
    setServiceCatalogForAdministrator(
      env,
      { catalog: catalog({ general: { label: "General consultation", fee: 300, active: true } }), expectedUpdateTime: null },
      actor,
      database,
    ),
    (error) => error instanceof HttpError && error.status === 409,
  );
  assert.equal(database.commits.length, 0);
});

test("same-payload retry is an idempotent no-op even with a stale revision", async () => {
  const current = catalog({ general: { label: "Family physician consultation", fee: 300, active: true } });
  const database = fakeDatabase({
    "staff/admin-1": administrator(),
    "clinicSettings/serviceCatalog": catalogDocument(current, NEXT_TIME),
  });
  const result = await setServiceCatalogForAdministrator(
    env,
    { catalog: current, expectedUpdateTime: CATALOG_TIME },
    actor,
    database,
  );
  assert.deepEqual(result, { catalog: current, revision: NEXT_TIME, changed: false });
  assert.equal(database.commits.length, 0);
});

test("rechecks administrator activity and role before every mutation", async () => {
  for (const adminDocument of [
    null,
    administrator({ active: false }),
    administrator({ role: "reception" }),
  ]) {
    const database = fakeDatabase({
      ...(adminDocument ? { "staff/admin-1": adminDocument } : {}),
      "clinicSettings/serviceCatalog": catalogDocument(),
    });
    await assert.rejects(
      setServiceCatalogForAdministrator(
        env,
        { catalog: catalog(), expectedUpdateTime: CATALOG_TIME },
        actor,
        database,
      ),
      (error) => error instanceof HttpError && error.status === 403,
    );
    assert.equal(database.commits.length, 0);
  }
});

test("post-commit verification rejects an unconfirmed catalogue revision", async () => {
  const database = fakeDatabase({
    "staff/admin-1": administrator(),
    "clinicSettings/serviceCatalog": catalogDocument(),
  });
  await assert.rejects(
    setServiceCatalogForAdministrator(
      env,
      {
        catalog: catalog({ general: { label: "General consultation", fee: 300, active: true } }),
        expectedUpdateTime: CATALOG_TIME,
      },
      actor,
      database,
    ),
    (error) => error instanceof HttpError && error.status === 503,
  );
  assert.equal(database.commits.length, 1);
});
