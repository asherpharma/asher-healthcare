import {
  commitWrites, createDocumentWrite, getDocument, serviceAccountAccessToken, updateDocumentWrite,
} from "../razorpay/firebase.js";

const DEFAULTS = { commitWrites, createDocumentWrite, getDocument, serviceAccountAccessToken, updateDocumentWrite, fetch };

/** Optimistic Firestore REST transactions. All paths/data are server-owned. */
export function createPushStore(overrides = {}) {
  const dependencies = { ...DEFAULTS, ...overrides };
  // Workerd's global fetch rejects a dependency object as its `this` receiver.
  // Invoke the function directly, just like the push transport and REST helper.
  const fetchRequest = dependencies.fetch;
  return {
    async get(env, path) { return dependencies.getDocument(env, path); },
    async listDevices(env, limit, signal) {
      const token = await dependencies.serviceAccountAccessToken(env);
      if (signal?.aborted) throw new Error("Notification dispatch time expired.");
      const response = await fetchRequest(
        `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`,
        {
          method: "POST", signal, redirect: "manual",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ structuredQuery: {
            from: [{ collectionId: "adminPushDevices" }],
            select: { fields: [{ fieldPath: "__name__" }] },
            where: { fieldFilter: { field: { fieldPath: "active" }, op: "EQUAL", value: { booleanValue: true } } },
            orderBy: [{ field: { fieldPath: "__name__" }, direction: "ASCENDING" }],
            limit,
          } }),
        },
      );
      if (!response.ok) throw new Error("Notification devices could not be read.");
      const entries = await response.json();
      if (!Array.isArray(entries)) throw new Error("Notification device response was invalid.");
      return entries.filter((entry) => entry.document).map((entry) => entry.document.name.split("/").at(-1));
    },
    async mutate(env, path, transition, check = () => {}) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        check();
        const previous = await dependencies.getDocument(env, path);
        check();
        const patch = transition(previous?.data || null);
        if (!patch) return previous?.data || null;
        const write = previous
          ? dependencies.updateDocumentWrite(env, path, patch, Object.keys(patch), previous.updateTime)
          : dependencies.createDocumentWrite(env, path, patch);
        try {
          await dependencies.commitWrites(env, [write]);
          return { ...previous?.data, ...patch };
        } catch (error) {
          if (![409, 412].includes(error?.status) || attempt === 2) throw error;
        }
      }
      throw new Error("Notification delivery state could not be saved.");
    },
    async disableIfUnchanged(env, deviceId, expected, now, check) {
      return this.mutate(env, `adminPushDevices/${deviceId}`, (current) => {
        if (!current || current.active !== true || current.uid !== expected.uid
          || JSON.stringify(current.subscription) !== JSON.stringify(expected.subscription)) return null;
        return { active: false, disabledReason: "subscription_expired", updatedAt: new Date(now) };
      }, check);
    },
  };
}
