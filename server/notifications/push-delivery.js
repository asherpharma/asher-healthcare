import {
  BOOKING_ALERT_PRODUCTION_ORIGIN, bookingPushReadiness, validatePushSubscription,
} from "./booking-alerts.js";
import { createPushStore } from "./push-store.js";
import { createWebPushTransport } from "./push-transport.js";

export const PUSH_RETRY_WINDOW_MS = 20 * 60 * 60 * 1000;
export const PUSH_DISPATCH_BUDGET_MS = 20_000;
export const PUSH_MAX_DEVICES = 20;
const MAX_ATTEMPTS = 12;
const LEASE_MS = 45_000;
const ID = /^[A-Za-z0-9_-]{1,128}$/u;
const DEVICE_ID = /^[a-f0-9]{64}$/u;
const ORIGINS = new Set([BOOKING_ALERT_PRODUCTION_ORIGIN, "https://www.asherhealthcare.in"]);
const TERMINAL = new Set(["sent", "skipped"]);

function milliseconds(value) {
  return value instanceof Date ? value.getTime() : typeof value === "string" ? Date.parse(value) : NaN;
}

function summary(record = {}) {
  return {
    status: record.status || "needs_attention",
    sent: Number.isSafeInteger(record.sent) ? record.sent : 0,
    pending: Number.isSafeInteger(record.pending) ? record.pending : 0,
    skipped: Number.isSafeInteger(record.skipped) ? record.skipped : 0,
    failed: Number.isSafeInteger(record.failed) ? record.failed : 0,
  };
}

async function fingerprint(value) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function deadlineError() { return Object.assign(new Error("Notification dispatch time expired."), { code: "dispatch_timeout" }); }

function budget(now, duration) {
  const expiresAt = now() + duration;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), duration);
  function check() { if (controller.signal.aborted || now() >= expiresAt) throw deadlineError(); }
  return {
    signal: controller.signal, check,
    remaining: () => Math.max(0, expiresAt - now()),
    async run(operation) {
      check();
      let rejectOnAbort;
      const expired = new Promise((_, reject) => {
        rejectOnAbort = () => reject(deadlineError());
        controller.signal.addEventListener("abort", rejectOnAbort, { once: true });
      });
      try { const value = await Promise.race([Promise.resolve().then(operation), expired]); check(); return value; }
      finally { controller.signal.removeEventListener("abort", rejectOnAbort); }
    },
    close() { clearTimeout(timer); controller.abort(); },
  };
}

function ineligible(outbox, appointment, id, activation, now) {
  if (outbox.appointmentId !== id || !ORIGINS.has(outbox.requestOrigin)) return "invalid_outbox";
  const created = milliseconds(outbox.createdAt);
  const booked = milliseconds(appointment?.createdAt);
  if (!Number.isFinite(created) || !Number.isFinite(booked) || created < activation || booked < activation
    || created > now + 60_000 || booked > now + 60_000 || Math.abs(created - booked) > 1000) return "outside_activation";
  if (appointment?.source !== "website" || appointment.createdBy !== "public-website"
    || appointment.status !== "requested" || appointment.requestOrigin !== outbox.requestOrigin) return "not_website_request";
  if (now >= created + PUSH_RETRY_WINDOW_MS) return "retry_window_closed";
  return null;
}

function failure(error) {
  const status = Number(error?.status || error?.statusCode || 0);
  if (status === 404 || status === 410) return { reason: "subscription_expired", invalid: true };
  return {
    reason: status ? `provider_${status}` : error?.code === "dispatch_timeout" ? "dispatch_timeout" : "transport_failure",
    retryable: !status || status === 408 || status === 425 || status === 429 || status >= 500,
  };
}

/** Push only: no email dependency, send, secret lookup, or automatic retry promise. */
export function createPushDeliveryService(overrides = {}) {
  const now = overrides.now || Date.now;
  const store = overrides.store || createPushStore(overrides);
  const sendPush = overrides.sendPush || createWebPushTransport({ fetch: overrides.fetch || fetch, now });
  const token = overrides.token || (() => crypto.randomUUID());
  const duration = Math.min(PUSH_DISPATCH_BUDGET_MS, overrides.budgetMs || PUSH_DISPATCH_BUDGET_MS);
  return {
    async deliver(env, appointmentId) {
      if (!ID.test(appointmentId || "") || !bookingPushReadiness(env, now())) return summary({ status: "skipped" });
      const total = budget(now, duration);
      let work;
      const outboxPath = `appointmentPushOutbox/${appointmentId}`;
      const leaseToken = token();
      let ownsLease = false;
      let initial;
      try {
        const document = await total.run(() => store.get(env, outboxPath));
        if (!document) return summary({ status: "skipped" });
        initial = document.data;
        if (TERMINAL.has(initial.status)) return summary(initial);
        const appointment = await total.run(() => store.get(env, `appointments/${appointmentId}`));
        const reason = ineligible(initial, appointment?.data, appointmentId, Date.parse(env.BOOKING_ALERTS_ACTIVATED_AT), now());
        if (reason) {
          const result = await total.run(() => store.mutate(env, outboxPath, (current) => current && !TERMINAL.has(current.status) ? {
            status: reason === "retry_window_closed" ? "needs_attention" : "skipped", reason,
            updatedAt: new Date(now()), leaseToken: null, leaseUntil: 0,
          } : null, total.check));
          return summary(result);
        }
        const claimed = await total.run(() => store.mutate(env, outboxPath, (current) => {
          if (!current || TERMINAL.has(current.status) || current.leaseUntil > now()) return null;
          return { status: "processing", leaseToken, leaseUntil: now() + LEASE_MS, attemptedAt: new Date(now()), updatedAt: new Date(now()) };
        }, total.check));
        if (claimed?.leaseToken !== leaseToken) return summary(claimed || initial);
        ownsLease = true;
        // Leave at least three seconds to persist a useful partial summary.
        work = budget(now, Math.max(1, total.remaining() - 3000));
        let deviceIds = Array.isArray(claimed.deviceIds) && claimed.deviceIds.length ? claimed.deviceIds : null;
        let fanoutTruncated = claimed.fanoutTruncated === true;
        if (!deviceIds) {
          const candidates = await work.run(() => store.listDevices(env, PUSH_MAX_DEVICES + 1, work.signal));
          fanoutTruncated = candidates.length > PUSH_MAX_DEVICES;
          deviceIds = candidates.slice(0, PUSH_MAX_DEVICES).filter((id) => DEVICE_ID.test(id));
          await work.run(() => store.mutate(env, outboxPath, (current) => current?.leaseToken === leaseToken
            ? { deviceIds, fanoutTruncated, updatedAt: new Date(now()) } : null, work.check));
        }
        // Never accept an unbounded list even if a server record is malformed.
        if (deviceIds.length > PUSH_MAX_DEVICES) fanoutTruncated = true;
        deviceIds = deviceIds.slice(0, PUSH_MAX_DEVICES).filter((id) => DEVICE_ID.test(id));
        const results = new Array(deviceIds.length);
        const topic = (await fingerprint(appointmentId)).slice(0, 32);
        let cursor = 0;
        const processDevice = async (deviceId) => {
          const path = `${outboxPath}/devices/${deviceId}`;
          const deviceDocument = await work.run(() => store.get(env, `adminPushDevices/${deviceId}`));
          const registered = deviceDocument?.data;
          const registrationFingerprint = await fingerprint({ uid: registered?.uid, subscription: registered?.subscription });
          const deviceToken = token();
          const state = await work.run(() => store.mutate(env, path, (previous) => {
            if (TERMINAL.has(previous?.status) || previous?.leaseUntil > now() || previous?.nextAttemptAt > now()) return null;
            if ((previous?.attempts || 0) >= MAX_ATTEMPTS || now() >= milliseconds(initial.createdAt) + PUSH_RETRY_WINDOW_MS) {
              return { status: "needs_attention", reason: "retry_window_closed", updatedAt: new Date(now()) };
            }
            if (previous?.retryable === false) return null;
            return { status: "processing", attempts: (previous?.attempts || 0) + 1,
              leaseToken: deviceToken, leaseUntil: now() + LEASE_MS, registrationFingerprint,
              nextAttemptAt: 0, updatedAt: new Date(now()) };
          }, work.check));
          if (state?.leaseToken !== deviceToken) return state || { status: "needs_attention" };
          let result;
          try {
            const fresh = (await work.run(() => store.get(env, `adminPushDevices/${deviceId}`)))?.data;
            let skipped = null;
            if (!fresh || fresh.active !== true || fresh.origin !== BOOKING_ALERT_PRODUCTION_ORIGIN || !ID.test(fresh.uid || "")) skipped = "device_inactive";
            else if (await fingerprint({ uid: fresh.uid, subscription: fresh.subscription }) !== registrationFingerprint) skipped = "registration_changed";
            else {
              try { await validatePushSubscription(fresh.subscription, new Date(now())); }
              catch {
                skipped = "invalid_subscription";
                if (Number.isSafeInteger(fresh.subscription?.expirationTime) && fresh.subscription.expirationTime <= now()) {
                  await work.run(() => store.disableIfUnchanged(env, deviceId, fresh, now(), work.check));
                  skipped = "subscription_expired";
                }
              }
            }
            if (!skipped) {
              const staff = (await work.run(() => store.get(env, `staff/${fresh.uid}`)))?.data;
              if (staff?.active !== true || staff?.role !== "admin") skipped = "admin_access_revoked";
            }
            if (skipped) result = { status: "skipped", reason: skipped, retryable: false };
            else {
              work.check();
              const sendBudget = budget(now, Math.min(5000, work.remaining()));
              const abortSend = () => sendBudget.close();
              work.signal.addEventListener("abort", abortSend, { once: true });
              try {
                await sendBudget.run(() => sendPush(fresh.subscription, { type: "appointment-request", appointmentId }, {
                  publicKey: env.BOOKING_ALERT_VAPID_PUBLIC_KEY, privateKey: env.BOOKING_ALERT_VAPID_PRIVATE_KEY,
                  topic, signal: sendBudget.signal,
                }));
              } finally { work.signal.removeEventListener("abort", abortSend); sendBudget.close(); }
              result = { status: "sent", reason: "accepted", sentAt: new Date(now()), retryable: false };
            }
          } catch (error) {
            const failed = failure(error);
            if (failed.invalid && registered) {
              await work.run(() => store.disableIfUnchanged(env, deviceId, registered, now(), work.check));
            }
            const nextAttemptAt = now() + Math.min(3600000, 60000 * (2 ** Math.min(state.attempts - 1, 6)));
            result = {
              status: failed.invalid ? "skipped" : "needs_attention", reason: failed.reason,
              retryable: failed.retryable === true && state.attempts < MAX_ATTEMPTS
                && nextAttemptAt < milliseconds(initial.createdAt) + PUSH_RETRY_WINDOW_MS,
              nextAttemptAt,
            };
          }
          return work.run(() => store.mutate(env, path, (current) => current?.leaseToken === deviceToken ? {
            ...result, leaseToken: null, leaseUntil: 0, updatedAt: new Date(now()),
          } : null, work.check));
        };
        await Promise.all(Array.from({ length: Math.min(3, deviceIds.length) }, async () => {
          while (cursor < deviceIds.length && work.remaining() > 0 && !work.signal.aborted) {
            const index = cursor++;
            try { results[index] = await processDevice(deviceIds[index]); }
            catch { results[index] = { status: "needs_attention", reason: "storage_or_dispatch_failure" }; }
          }
        }));
        const counts = {
          sent: results.filter((entry) => entry?.status === "sent").length,
          skipped: results.filter((entry) => entry?.status === "skipped").length,
          pending: deviceIds.length - results.filter(Boolean).length + results.filter((entry) => entry?.status === "processing").length,
          failed: results.filter((entry) => entry?.status === "needs_attention").length,
        };
        const attention = fanoutTruncated || !deviceIds.length || counts.pending > 0 || counts.failed > 0;
        const outcome = { ...counts, status: attention ? "needs_attention" : counts.sent ? "sent" : "skipped" };
        await total.run(() => store.mutate(env, outboxPath, (current) => current?.leaseToken === leaseToken ? {
          ...outcome, reason: fanoutTruncated ? "device_limit_exceeded" : !deviceIds.length ? "no_devices"
            : attention ? "manual_retry_required" : "delivery_finished",
          fanoutTruncated, leaseToken: null, leaseUntil: 0, updatedAt: new Date(now()),
          ...(attention ? {} : { completedAt: new Date(now()) }),
        } : null, total.check));
        return outcome;
      } catch {
        if (ownsLease) {
          try {
            await total.run(() => store.mutate(env, outboxPath, (current) => current?.leaseToken === leaseToken ? {
              status: "needs_attention", reason: "storage_or_dispatch_failure", leaseToken: null,
              leaseUntil: 0, updatedAt: new Date(now()),
            } : null, total.check));
          } catch { /* A remaining processing lease expires; a manual retry can recover it. */ }
        }
        return summary({ status: "needs_attention", failed: 1 });
      } finally { work?.close(); total.close(); }
    },
  };
}
