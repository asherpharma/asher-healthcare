import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { HttpError } from "../server/razorpay/http.js";
import { queueAppointmentsForDayQuery } from "../server/reception/firestore-query.js";
import {
  DEFAULT_RECEPTION_SERVICE_CATALOG,
  normalizeReceptionServiceCatalog,
} from "../server/reception/service-catalog.js";
import {
  clinicClock,
  exactReceptionPatientIdentity,
  normalizeReceptionName,
  normalizeReceptionPhone,
  receptionIdentityMaterial,
  receptionPayloadMaterial,
  receptionRequestIntent,
  receptionRequestMaterial,
  validateReceptionRegistration,
} from "../server/reception/workflow.js";
import { verifyServiceCatalogWrite } from "../functions/api/reception/register.js";

const now = new Date("2026-08-07T04:35:00.000Z");

test("queue lookup uses the deployed descending appointment-date index", () => {
  const query = queueAppointmentsForDayQuery("2026-08-07");
  assert.deepEqual(query.orderBy, [{
    field: { fieldPath: "preferredDate" },
    direction: "DESCENDING",
  }]);
  assert.deepEqual(
    query.where.fieldFilter.value,
    { stringValue: "2026-08-07" },
  );
  const indexes = JSON.parse(
    readFileSync(new URL("../firestore.indexes.json", import.meta.url), "utf8"),
  );
  const preferredDateOverride = indexes.fieldOverrides.find((override) => (
    override.collectionGroup === "appointments"
    && override.fieldPath === "preferredDate"
  ));
  assert.ok(preferredDateOverride);
  assert.ok(preferredDateOverride.indexes.some((index) => (
    index.queryScope === "COLLECTION"
    && index.order === query.orderBy[0].direction
  )));
});

function valid(overrides = {}) {
  return {
    requestId: "123e4567-e89b-42d3-a456-426614174000",
    fullName: "  Ananya Rao ",
    phone: "09876543210",
    dateOfBirth: "1991-06-15",
    gender: "female",
    caseType: "specialist",
    specialty: "obg",
    doctorId: "obg",
    fee: 500,
    ...overrides,
  };
}

test("normalizes reception identity deterministically", () => {
  assert.equal(normalizeReceptionName("  Dr.  Śhafi Ahamad  "), "shafi ahamad");
  assert.equal(normalizeReceptionPhone("+91 98765 43210"), "+919876543210");
  assert.equal(normalizeReceptionPhone("12345"), null);
});

test("uses the clinic timezone for same-day arrivals", () => {
  assert.deepEqual(clinicClock(now), { date: "2026-08-07", time: "10:05" });
  assert.deepEqual(
    clinicClock(new Date("2026-08-06T20:00:00.000Z")),
    { date: "2026-08-07", time: "01:30" },
  );
});

test("derives authoritative specialist fees and doctor details", () => {
  const registration = validateReceptionRegistration(valid(), now);
  assert.equal(registration.fee, 500);
  assert.equal(registration.doctorName, "Dr. Shaik Reshma");
  assert.equal(registration.consultationLabel, "Obstetrics & Gynaecology consultation");
  assert.equal(registration.clinicDate, "2026-08-07");
});

test("uses an admin-configured service label and fee as the invoice authority", () => {
  const configuredCatalog = {
    schemaVersion: 1,
    services: {
      ...DEFAULT_RECEPTION_SERVICE_CATALOG.services,
      obg: {
        label: "Specialist women's health consultation",
        fee: 725,
        active: true,
      },
    },
  };
  const registration = validateReceptionRegistration(
    valid({ fee: 725, serviceId: "obg" }),
    now,
    configuredCatalog,
  );
  assert.equal(registration.serviceId, "obg");
  assert.equal(registration.fee, 725);
  assert.equal(registration.consultationLabel, "Specialist women's health consultation");
});

test("keeps safe default fees when the service catalogue is absent or malformed", () => {
  const catalog = normalizeReceptionServiceCatalog({
    services: { obg: { label: "", fee: -1, active: "yes" } },
  });
  assert.deepEqual(catalog.services.obg, {
    label: "Obstetrics & Gynaecology consultation",
    fee: 500,
    active: true,
  });
  assert.equal(validateReceptionRegistration(valid(), now, null).fee, 500);
});

test("keeps a payable default when a catalogue tries to configure a zero fee", () => {
  const catalog = normalizeReceptionServiceCatalog({
    services: { obg: { label: "OBG consultation", fee: 0, active: true } },
  });
  assert.equal(catalog.services.obg.fee, 500);
});

test("reception commits against the exact service catalogue revision", () => {
  const env = { FIREBASE_PROJECT_ID: "asher-test" };
  assert.deepEqual(verifyServiceCatalogWrite(env, null), {
    verify: "projects/asher-test/databases/(default)/documents/clinicSettings/serviceCatalog",
    currentDocument: { exists: false },
  });
  assert.deepEqual(verifyServiceCatalogWrite(env, {
    updateTime: "2026-08-13T12:30:00.123456Z",
  }), {
    verify: "projects/asher-test/databases/(default)/documents/clinicSettings/serviceCatalog",
    currentDocument: { updateTime: "2026-08-13T12:30:00.123456Z" },
  });
});

test("rejects an inactive service even when the client submits its former fee", () => {
  assert.throws(
    () => validateReceptionRegistration(valid(), now, {
      services: {
        ...DEFAULT_RECEPTION_SERVICE_CATALOG.services,
        obg: { ...DEFAULT_RECEPTION_SERVICE_CATALOG.services.obg, active: false },
      },
    }),
    (error) => error instanceof HttpError && error.status === 409,
  );
});

test("rejects client-side fee tampering", () => {
  assert.throws(
    () => validateReceptionRegistration(valid({ fee: 250 }), now),
    (error) => error instanceof HttpError && error.status === 409,
  );
});

test("rejects a client service identifier that does not match the visit", () => {
  assert.throws(
    () => validateReceptionRegistration(valid({ serviceId: "pediatrics" }), now),
    (error) => error instanceof HttpError && error.status === 409,
  );
});

test("requires a fresh UUID request id", () => {
  assert.throws(
    () => validateReceptionRegistration(valid({ requestId: "retry-1" }), now),
    (error) => error instanceof HttpError && error.status === 400,
  );
});

test("requires specialist and doctor to agree", () => {
  assert.throws(
    () => validateReceptionRegistration(valid({ specialty: "pediatrics" }), now),
    (error) => error instanceof HttpError && error.status === 400,
  );
});

test("builds an exact identity reservation from normalized fields", () => {
  const first = validateReceptionRegistration(valid(), now);
  const second = validateReceptionRegistration(valid({
    fullName: "ananya   rao",
    phone: "+91 9876543210",
  }), now);
  assert.equal(receptionIdentityMaterial(first), receptionIdentityMaterial(second));
  const otherGender = validateReceptionRegistration(valid({ gender: "other" }), now);
  assert.notEqual(receptionIdentityMaterial(first), receptionIdentityMaterial(otherGender));
});

test("scopes idempotency material to the authenticated actor", () => {
  const requestId = valid().requestId;
  assert.equal(
    receptionRequestMaterial("staff-a", requestId),
    receptionRequestMaterial("staff-a", requestId),
  );
  assert.notEqual(
    receptionRequestMaterial("staff-a", requestId),
    receptionRequestMaterial("staff-b", requestId),
  );
});

test("fingerprints normalized workflow details instead of presentation formatting", () => {
  const first = validateReceptionRegistration(valid(), now);
  const second = validateReceptionRegistration(valid({
    fullName: "ananya   rao",
    phone: "+91 9876543210",
  }), now);
  assert.equal(receptionPayloadMaterial(first), receptionPayloadMaterial(second));
});

test("reception replay intent is stable across fee changes but bound to patient details", () => {
  const first = receptionRequestIntent(valid({ fee: 250 }));
  const laterFee = receptionRequestIntent(valid({ fee: 500 }));
  const differentPatient = receptionRequestIntent(valid({ fullName: "Different Patient" }));

  assert.equal(first.requestId, valid().requestId);
  assert.equal(first.material, laterFee.material);
  assert.notEqual(first.material, differentPatient.material);
});

test("recognizes exact legacy charts even when they are archived", () => {
  const registration = validateReceptionRegistration(valid(), now);
  assert.equal(exactReceptionPatientIdentity({
    fullName: "Ms. Ananya Rao",
    phone: "+91-98765-43210",
    dateOfBirth: "1991-06-15",
    gender: "FEMALE",
    archived: true,
  }, registration), true);
  assert.equal(exactReceptionPatientIdentity({
    fullName: "Ms. Ananya Rao",
    phone: "+91-98765-43210",
    dateOfBirth: "1991-06-15",
    gender: "other",
    archived: true,
  }, registration), false);
});
