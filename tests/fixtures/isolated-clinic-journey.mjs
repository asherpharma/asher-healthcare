import assert from "node:assert/strict";

const VERSION_PREFIX = "2026-08-15T00:00:";

function clone(value) {
  return structuredClone(value);
}

function directChild(path, collectionPath) {
  const prefix = `${collectionPath}/`;
  if (!path.startsWith(prefix)) return false;
  return !path.slice(prefix.length).includes("/");
}

export const SYNTHETIC_PROFILES = Object.freeze({
  administrator: Object.freeze({
    uid: "synthetic-admin-001",
    active: true,
    role: "admin",
    displayName: "Synthetic Clinic Administrator",
  }),
  patient: Object.freeze({
    id: "synthetic-patient-001",
    patientNumber: "TEST-ASH-0001",
    fullName: "Synthetic Adult Patient",
    phone: "9000000001",
    dateOfBirth: "1990-01-15",
    gender: "Female",
    doctorId: "obg",
    doctorName: "Dr. Synthetic Test",
    archived: false,
  }),
  unrelatedPatient: Object.freeze({
    id: "synthetic-patient-002",
    patientNumber: "TEST-ASH-0002",
    fullName: "Synthetic Unrelated Patient",
    phone: "9000000002",
    dateOfBirth: "1988-03-20",
    gender: "Male",
    doctorId: "pediatrics",
    archived: false,
  }),
  familyAccount: Object.freeze({
    uid: "synthetic-family-account-001",
    displayName: "Synthetic Family Account",
    email: "synthetic.family@example.test",
  }),
  reception: Object.freeze({
    uid: "synthetic-reception-001",
    role: "reception",
    active: true,
    displayName: "Synthetic Reception User",
    staffUpdateTime: "2026-08-15T08:00:00.000Z",
  }),
});

export function portalProvisionPayload(overrides = {}) {
  const patient = SYNTHETIC_PROFILES.patient;
  const account = SYNTHETIC_PROFILES.familyAccount;
  return {
    displayName: account.displayName,
    email: account.email,
    confirmEmail: account.email,
    accountEmailAttested: true,
    grants: [{
      patientId: patient.id,
      relationship: "self",
      consentRecordId: "TEST-CONSENT-0001",
      consentMethod: "signed_form",
      evidenceType: "patient_authorization",
      consentAttested: true,
      scopes: ["profile", "appointments", "prescriptions", "reports", "billing"],
    }],
    ...overrides,
  };
}

export function createSyntheticAuthFixture() {
  const events = [];
  return {
    events,
    async findAuthUserByEmail(_env, email) {
      events.push({ type: "lookup", email });
      return null;
    },
    createRandomPassword() {
      events.push({ type: "temporary_secret_generated" });
      return "synthetic-never-delivered-secret";
    },
    async createAuthUser(_env, user) {
      events.push({ type: "identity_created", email: user.email, displayName: user.displayName });
      return { localId: SYNTHETIC_PROFILES.familyAccount.uid };
    },
    async sendPasswordResetEmail(_env, email, continueUrl) {
      events.push({ type: "invitation_captured", email, continueUrl });
    },
    async deleteAuthUser(_env, uid) {
      events.push({ type: "identity_deleted", uid });
    },
  };
}

export class InMemoryFirestoreFixture {
  #documents = new Map();
  #version = 0;

  constructor(seed = {}) {
    for (const [path, data] of Object.entries(seed)) this.seed(path, data);
  }

  #nextVersion() {
    this.#version += 1;
    const seconds = String(Math.floor(this.#version / 1_000)).padStart(2, "0");
    const millis = String(this.#version % 1_000).padStart(3, "0");
    return `${VERSION_PREFIX}${seconds}.${millis}Z`;
  }

  seed(path, data) {
    this.#documents.set(path, { data: clone(data), updateTime: this.#nextVersion() });
    return this;
  }

  patch(path, fields) {
    const current = this.#documents.get(path);
    assert.ok(current, `Cannot patch missing fixture document ${path}`);
    this.#documents.set(path, {
      data: { ...clone(current.data), ...clone(fields) },
      updateTime: this.#nextVersion(),
    });
    return this;
  }

  document(path) {
    const value = this.#documents.get(path);
    return value ? clone(value) : null;
  }

  documents(collectionPath) {
    return [...this.#documents.entries()]
      .filter(([path]) => directChild(path, collectionPath))
      .map(([path, document]) => ({
        id: path.slice(collectionPath.length + 1),
        data: clone(document.data),
        updateTime: document.updateTime,
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  paths(prefix = "") {
    return [...this.#documents.keys()].filter((path) => path.startsWith(prefix)).sort();
  }

  async getDocument(_env, path) {
    return this.document(path);
  }

  verifyDocumentWrite(_env, path, updateTime) {
    return { operation: "verify", path, updateTime };
  }

  createDocumentWrite(_env, path, data) {
    return { operation: "create", path, data: clone(data) };
  }

  updateDocumentWrite(_env, path, data, fieldMask, updateTime) {
    return { operation: "update", path, data: clone(data), fieldMask: [...fieldMask], updateTime };
  }

  async commitWrites(_env, writes) {
    const staged = new Map([...this.#documents.entries()].map(([path, value]) => [path, clone(value)]));
    for (const write of writes) {
      const current = staged.get(write.path);
      if (write.operation === "verify") {
        assert.ok(current, `Verified fixture document is missing: ${write.path}`);
        assert.equal(current.updateTime, write.updateTime, `Stale fixture verification for ${write.path}`);
        continue;
      }
      if (write.operation === "create") {
        assert.equal(current, undefined, `Fixture create would overwrite ${write.path}`);
        staged.set(write.path, { data: clone(write.data), updateTime: this.#nextVersion() });
        continue;
      }
      if (write.operation === "update") {
        assert.ok(current, `Updated fixture document is missing: ${write.path}`);
        assert.equal(current.updateTime, write.updateTime, `Stale fixture update for ${write.path}`);
        staged.set(write.path, {
          data: { ...clone(current.data), ...clone(write.data) },
          updateTime: this.#nextVersion(),
        });
        continue;
      }
      assert.fail(`Unsupported fixture write: ${JSON.stringify(write)}`);
    }
    this.#documents = staged;
  }

  list = async (_env, collectionPath, limit = 50) => {
    const result = this.documents(collectionPath);
    assert.ok(result.length <= limit, `Fixture query exceeded limit for ${collectionPath}`);
    return result;
  };

  query = async (_env, options) => {
    const collectionPath = options.parentPath
      ? `${options.parentPath}/${options.collectionId}`
      : options.collectionId;
    let result = this.documents(collectionPath);
    if (options.whereField) {
      result = result.filter((entry) => entry.data[options.whereField] === options.whereValue);
    }
    return result.slice(0, options.limit || 50);
  };
}

export function createPortalJourneyFixture() {
  const admin = SYNTHETIC_PROFILES.administrator;
  const patient = SYNTHETIC_PROFILES.patient;
  const unrelated = SYNTHETIC_PROFILES.unrelatedPatient;
  return new InMemoryFirestoreFixture({
    [`staff/${admin.uid}`]: admin,
    [`patients/${patient.id}`]: patient,
    [`patients/${unrelated.id}`]: unrelated,
    "appointments/synthetic-appointment-001": {
      patientId: patient.id,
      doctorId: "obg",
      preferredDate: "2026-08-16",
      preferredTime: "17:15",
      status: "confirmed",
      queueToken: 4,
    },
    [`patients/${patient.id}/prescriptions/synthetic-prescription-001`]: {
      prescribedDate: "2026-08-15",
      doctorName: "Dr. Synthetic Test",
      medicines: [{ name: "Synthetic medicine", dose: "1", frequency: "once", duration: "1 day" }],
      advice: "Synthetic fixture only",
      createdAt: "2026-08-15T08:10:00.000Z",
    },
    [`patients/${patient.id}/reports/synthetic-report-001`]: {
      storagePath: `reports/${patient.id}/synthetic-report-001.pdf`,
      contentType: "application/pdf",
      category: "Synthetic lab report",
      size: 128,
      reportDate: "2026-08-15",
      createdAt: "2026-08-15T08:15:00.000Z",
    },
    "invoices/synthetic-invoice-001": {
      patientId: patient.id,
      invoiceNumber: "TEST-INV-0001",
      items: [{ description: "Synthetic consultation", quantity: 1, unitPrice: 500, amount: 500 }],
      subtotal: 500,
      discount: 0,
      total: 500,
      amountPaid: 500,
      balance: 0,
      paymentStatus: "paid",
      paymentMethod: "test",
      createdAt: "2026-08-15T08:20:00.000Z",
    },
  });
}

export function communicationJourneySnapshot({ consentStatus = "granted", outboxStatus = "ready" } = {}) {
  const patient = SYNTHETIC_PROFILES.patient;
  const preference = {
    status: consentStatus,
    recipient: "+919000000001",
    method: "patient-verbal",
    consentVersion: "care-reminders-v1",
    eventId: consentStatus === "granted" ? "synthetic-consent-granted-001" : "synthetic-consent-revoked-001",
    capturedAt: "2026-08-15T08:00:00.000Z",
    revokedAt: consentStatus === "revoked" ? "2026-08-15T08:30:00.000Z" : null,
  };
  return {
    now: new Date("2026-08-15T08:30:00.000Z"),
    appointments: [{
      id: "synthetic-appointment-001",
      patientId: patient.id,
      status: "confirmed",
      preferredDate: "2026-08-16",
      preferredTime: "17:15",
    }],
    tasks: [],
    patientDocuments: new Map([[patient.id, { data: patient }]]),
    preferences: new Map([[patient.id, { data: { careWhatsapp: preference } }]]),
    outbox: [{
      id: "synthetic-outbox-001",
      patientId: patient.id,
      sourceType: "appointment",
      sourceId: "synthetic-appointment-001",
      channel: "whatsapp",
      recipient: "+919000000001",
      status: outboxStatus,
      expiresAt: "2026-08-22T08:00:00.000Z",
    }],
  };
}
