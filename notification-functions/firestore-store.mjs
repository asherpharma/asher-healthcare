import { FieldPath } from "firebase-admin/firestore";
import { claimTransition, fingerprint } from "./delivery.mjs";

/** All methods are server-only. No admin credentials or records enter the browser. */
export function firestoreStore(db) {
  const alertRef = (id) => db.collection("appointmentAlerts").doc(id);
  const deviceRef = (id) => db.collection("adminPushDevices").doc(id);
  const channelRef = (id, key) => key === "email"
    ? alertRef(id).collection("channels").doc("email")
    : alertRef(id).collection("devices").doc(key.slice("device:".length));
  const read = async (ref) => {
    const snapshot = await ref.get();
    return snapshot.exists ? snapshot.data() : null;
  };
  return {
    getAlert: (id) => read(alertRef(id)),
    getDevice: (id) => read(deviceRef(id)),
    getStaff: async (uid) => typeof uid === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(uid)
      ? read(db.collection("staff").doc(uid)) : null,
    async listDevices(limit) {
      // Single-field index only. Origin and current authorization are checked
      // again before each send. The registration API only accepts production.
      const snapshot = await db.collection("adminPushDevices")
        .where("active", "==", true).orderBy(FieldPath.documentId()).limit(limit).get();
      return snapshot.docs.map((doc) => ({ id: doc.id }));
    },
    async initializeAlert(id, initial) {
      return db.runTransaction(async (transaction) => {
        const ref = alertRef(id);
        const snapshot = await transaction.get(ref);
        if (snapshot.exists) return snapshot.data();
        transaction.create(ref, initial);
        return initial;
      });
    },
    async expireAlert(id, { createdAtMs, deadlineAtMs, now }) {
      return db.runTransaction(async (transaction) => {
        const ref = alertRef(id);
        const snapshot = await transaction.get(ref);
        const previous = snapshot.data();
        if (previous && ["complete", "needs_attention"].includes(previous.status)) return previous;
        const result = {
          ...previous, version: 1, status: "needs_attention", code: "retry_window_closed",
          createdAtMs, deadlineAtMs, updatedAtMs: now,
        };
        transaction.set(ref, result);
        return result;
      });
    },
    async claim(id, key, options) {
      return db.runTransaction(async (transaction) => {
        const ref = channelRef(id, key);
        const snapshot = await transaction.get(ref);
        const previous = snapshot.data();
        const result = claimTransition(previous, options);
        if (result.claimed || result.record !== previous) transaction.set(ref, result.record);
        return result;
      });
    },
    async finish(id, key, token, result) {
      return db.runTransaction(async (transaction) => {
        const ref = channelRef(id, key);
        const snapshot = await transaction.get(ref);
        const current = snapshot.data();
        // A stale process must never complete somebody else's renewed lease.
        if (!current || current.leaseToken !== token) return current;
        const next = { ...current, ...result };
        transaction.set(ref, next);
        return next;
      });
    },
    async disableDeviceIfUnchanged(id, expectedHash, now) {
      await db.runTransaction(async (transaction) => {
        const ref = deviceRef(id);
        const snapshot = await transaction.get(ref);
        const current = snapshot.data();
        if (current?.active === true && fingerprint(current.subscription) === expectedHash) {
          transaction.update(ref, { active: false, disabledReason: "subscription_expired", disabledAtMs: now });
        }
      });
    },
    async summarizeAlert(id, summary) {
      await db.runTransaction(async (transaction) => {
        const ref = alertRef(id);
        const snapshot = await transaction.get(ref);
        const current = snapshot.data();
        // Concurrent event re-delivery may observe a busy lease. Never let that
        // stale summary turn an already completed alert back into processing.
        if (current && ["complete", "needs_attention"].includes(current.status)) return;
        transaction.set(ref, summary, { merge: true });
      });
    },
  };
}
