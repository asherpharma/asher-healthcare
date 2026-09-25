import { createHash, ECDH, randomUUID } from "node:crypto";

export const PRODUCTION_PROJECT = "asher-healthcare-clinic";
export const PRODUCTION_ORIGIN = "https://asherhealthcare.in";
const BOOKING_ORIGINS = new Set([PRODUCTION_ORIGIN, "https://www.asherhealthcare.in"]);
export const ALERT_RECIPIENT = "asherhealthcare100@gmail.com";
export const MAX_DEVICES = 100;
export const MAX_ATTEMPTS = 12;
export const RETRY_WINDOW_MS = 20 * 60 * 60 * 1000;
export const LEASE_MS = 2 * 60 * 1000;
export const TERMINAL_STATES = new Set(["sent", "skipped", "needs_attention"]);

export const APPOINTMENT_DESK_URL = `${PRODUCTION_ORIGIN}/admin/appointments`;
const PUSH_PATHS = new Map([
  ["fcm.googleapis.com", /^\/(fcm\/send|wp)\/[A-Za-z0-9:_-]{20,2048}$/u],
  ["updates.push.services.mozilla.com", /^\/wpush\/v[12]\/[A-Za-z0-9_-]{20,2048}$/u],
  ["web.push.apple.com", /^\/[A-Za-z0-9_-]{20,2048}$/u],
]);

export function fingerprint(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function validSubscription(subscription, now = Date.now()) {
  try {
    const expiry = subscription?.expirationTime;
    if (expiry != null && (!Number.isSafeInteger(expiry) || expiry <= now)) return false;
    const endpoint = new URL(subscription?.endpoint);
    const keys = subscription?.keys;
    const point = Buffer.from(keys?.p256dh || "", "base64url");
    if (point.length !== 65 || point[0] !== 4) return false;
    ECDH.convertKey(point, "prime256v1");
    return endpoint.protocol === "https:"
      && PUSH_PATHS.get(endpoint.hostname)?.test(endpoint.pathname) === true
      && endpoint.href === subscription.endpoint
      && !endpoint.port && !endpoint.username && !endpoint.password && !endpoint.hash && !endpoint.search
      && endpoint.href.length <= 2200
      && typeof keys?.auth === "string" && /^[A-Za-z0-9_-]{22}$/u.test(keys.auth)
      && Buffer.from(keys.auth, "base64url").toString("base64url") === keys.auth
      && typeof keys?.p256dh === "string" && /^[A-Za-z0-9_-]{87}$/u.test(keys.p256dh)
      && point.toString("base64url") === keys.p256dh;
  } catch {
    return false;
  }
}

export function eligibility(event, config, now) {
  if (config.enabled !== true) return "disabled";
  if (event.projectId !== PRODUCTION_PROJECT) return "wrong_project";
  if (config.origin !== PRODUCTION_ORIGIN) return "wrong_origin_config";
  if (config.emailEnabled !== false && config.recipient !== ALERT_RECIPIENT) return "unapproved_recipient";
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(config.activatedAt || "")) {
    return "missing_activation";
  }
  const activation = Date.parse(config.activatedAt);
  if (!Number.isFinite(activation) || activation > now) return "not_activated";
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(event.id || "")) return "invalid_id";
  if (!Number.isFinite(event.createdAtMs) || event.createdAtMs < activation
    || event.createdAtMs > now + 60_000) return "outside_activation";
  const appointment = event.appointment;
  if (appointment?.source !== "website" || appointment?.createdBy !== "public-website"
    || appointment?.status !== "requested") return "not_website_request";
  if (!BOOKING_ORIGINS.has(appointment.requestOrigin)) return "not_production_booking";
  return null;
}

export function emailMessage(config) {
  return {
    from: config.sender,
    to: [ALERT_RECIPIENT],
    subject: "Asher Healthcare: new appointment request",
    text: `A new website appointment request is ready for review.\n\nOpen the secure appointment desk:\n${APPOINTMENT_DESK_URL}\n\nSign in with your staff account to view the details. This alert does not confirm the appointment.`,
    html: `<p>A new website appointment request is ready for review.</p><p><a href="${APPOINTMENT_DESK_URL}">Open the secure appointment desk</a></p><p>Sign in with your staff account to view the details. This alert does not confirm the appointment.</p>`,
  };
}

export function pushMessage(appointmentId) {
  return { type: "appointment-request", appointmentId };
}

export function retryDelay(attempt) {
  return Math.min(60 * 60 * 1000, 60_000 * (2 ** Math.min(attempt - 1, 6)));
}

// Pure transition, applied inside a Firestore transaction by the adapter.
export function claimTransition(previous, { now, deadlineAtMs, token, payloadHash }) {
  if (TERMINAL_STATES.has(previous?.status)) return { claimed: false, record: previous };
  if (now >= deadlineAtMs || (previous?.attempts || 0) >= MAX_ATTEMPTS) {
    return { claimed: false, record: { ...previous, status: "needs_attention", code: "retry_window_closed", leaseToken: null, leaseUntilMs: 0, updatedAtMs: now } };
  }
  if (previous?.payloadHash && previous.payloadHash !== payloadHash) {
    return { claimed: false, record: { ...previous, status: "needs_attention", code: "configuration_changed", leaseToken: null, leaseUntilMs: 0, updatedAtMs: now } };
  }
  if (previous?.leaseUntilMs > now || previous?.nextAttemptAtMs > now) {
    return { claimed: false, record: previous };
  }
  return {
    claimed: true,
    record: {
      status: "sending", attempts: (previous?.attempts || 0) + 1,
      firstAttemptAtMs: previous?.firstAttemptAtMs ?? now,
      updatedAtMs: now, nextAttemptAtMs: 0, leaseToken: token,
      leaseUntilMs: now + LEASE_MS, payloadHash,
    },
  };
}

export function classifyFailure(error, channel) {
  const status = Number(error?.statusCode || error?.status || 0);
  if (channel === "push" && [404, 410].includes(status)) {
    return { transient: false, invalidSubscription: true, code: "subscription_expired" };
  }
  if (error?.code === "configuration_missing") {
    return { transient: false, code: "configuration_missing" };
  }
  // Resend can return 409 while the same idempotent request is in flight.
  // Retry the same immutable payload/key; never create a new key to bypass it.
  if (!status || status === 408 || (channel === "email" && status === 409)
    || status === 425 || status === 429 || status >= 500) {
    return { transient: true, code: status ? `provider_${status}` : "transport_failure" };
  }
  return { transient: false, code: `provider_${status}` };
}

function configurationError() {
  return Object.assign(new Error("Alert delivery configuration is incomplete."), { code: "configuration_missing" });
}

async function deliverChannel({ store, appointmentId, key, deadlineAtMs, payloadHash, now, token, deliver, invalidSubscription }) {
  const lease = await store.claim(appointmentId, key, {
    now: now(), deadlineAtMs, token: token(), payloadHash,
  });
  if (!lease.claimed) return lease.record;
  const leaseToken = lease.record.leaseToken;
  let result;
  try {
    const delivery = await deliver();
    result = delivery?.skip
      ? { status: "skipped", code: delivery.skip }
      : { status: "sent", code: "accepted", sentAtMs: now() };
  } catch (error) {
    const failure = classifyFailure(error, key === "email" ? "email" : "push");
    if (failure.invalidSubscription && invalidSubscription) await invalidSubscription();
    const nextAttemptAtMs = now() + retryDelay(lease.record.attempts);
    const retryable = failure.transient && lease.record.attempts < MAX_ATTEMPTS && nextAttemptAtMs < deadlineAtMs;
    result = {
      status: failure.invalidSubscription ? "skipped" : retryable ? "retry" : "needs_attention",
      code: failure.code,
      nextAttemptAtMs: retryable ? nextAttemptAtMs : 0,
    };
  }
  return store.finish(appointmentId, key, leaseToken, {
    ...result, updatedAtMs: now(), leaseUntilMs: 0, leaseToken: null,
  });
}

async function boundedMap(values, concurrency, callback) {
  let cursor = 0;
  const results = [];
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      try {
        results[index] = await callback(values[index]);
      } catch {
        // A storage failure on one device must not starve the other devices.
        results[index] = { status: "retry", code: "storage_failure" };
      }
    }
  }));
  return results;
}

/** Dependency injected: tests use an in-memory transactional store and fake transports. */
export async function processAppointmentAlert(event, config, dependencies) {
  const { store, sendEmail, sendPush, now = Date.now, token = randomUUID } = dependencies;
  const ignored = eligibility(event, config, now());
  if (ignored) return { status: "ignored", code: ignored };
  const existing = await store.getAlert(event.id);
  if (existing && ["complete", "needs_attention"].includes(existing.status)) return existing;
  // No query or outbound delivery for historical/replayed events past the hard deadline.
  const deadlineAtMs = event.createdAtMs + RETRY_WINDOW_MS;
  if (now() >= deadlineAtMs) {
    return store.expireAlert(event.id, { createdAtMs: event.createdAtMs, deadlineAtMs, now: now() });
  }
  const candidates = existing?.deviceIds
    ? null : await store.listDevices(MAX_DEVICES + 1, PRODUCTION_ORIGIN);
  const alert = existing || await store.initializeAlert(event.id, {
    status: "processing", version: 1, createdAtMs: event.createdAtMs, deadlineAtMs,
    firstObservedAtMs: now(), updatedAtMs: now(),
    deviceIds: candidates.slice(0, MAX_DEVICES).map((device) => device.id),
    fanoutTruncated: candidates.length > MAX_DEVICES,
  });

  const message = emailMessage(config);
  const emailTask = config.emailEnabled === false ? Promise.resolve({ status: "skipped", code: "email_paused" }) : deliverChannel({
    store, appointmentId: event.id, key: "email", deadlineAtMs,
    payloadHash: fingerprint(message), now, token,
    deliver: async () => {
      if (!config.resendApiKey || typeof config.sender !== "string"
        || !/^[^\r\n<>\s]+@[^\r\n<>\s]+\.[^\r\n<>\s]+$/u.test(config.sender)) throw configurationError();
      await sendEmail(message, { idempotencyKey: `asher-appointment-v1-${event.id}`, apiKey: config.resendApiKey });
    },
  });
  const pushTask = boundedMap(alert.deviceIds, 5, async (deviceId) => {
    // Read subscription fresh each attempt. Never copy endpoint/keys into delivery logs.
    const device = await store.getDevice(deviceId);
    const subscriptionHash = fingerprint(device?.subscription || null);
    return deliverChannel({
      store, appointmentId: event.id, key: `device:${deviceId}`, deadlineAtMs,
      payloadHash: fingerprint(pushMessage(event.id)), now, token,
      invalidSubscription: () => store.disableDeviceIfUnchanged(deviceId, subscriptionHash, now()),
      deliver: async () => {
        // An opt-out/role revocation after enrollment must take effect on retries.
        const currentDevice = await store.getDevice(deviceId);
        if (!currentDevice || !currentDevice.active || currentDevice.origin !== PRODUCTION_ORIGIN) return { skip: "device_inactive" };
        if (fingerprint(currentDevice.subscription) !== subscriptionHash || currentDevice.uid !== device?.uid) {
          // No send to a new subscription under an old snapshot. Event retry refreshes it.
          throw Object.assign(new Error("Subscription changed."), { status: 425 });
        }
        const expiry = currentDevice.subscription?.expirationTime;
        if (Number.isSafeInteger(expiry) && expiry <= now()) {
          await store.disableDeviceIfUnchanged(deviceId, subscriptionHash, now());
          return { skip: "subscription_expired" };
        }
        if (!validSubscription(currentDevice.subscription, now())) return { skip: "invalid_subscription" };
        const staff = await store.getStaff(currentDevice.uid);
        if (!staff || staff.active !== true || staff.role !== "admin") return { skip: "admin_access_revoked" };
        if (!config.vapidPublicKey || !config.vapidPrivateKey) throw configurationError();
        await sendPush(currentDevice.subscription, pushMessage(event.id), {
          publicKey: config.vapidPublicKey, privateKey: config.vapidPrivateKey,
          subject: `mailto:${ALERT_RECIPIENT}`,
          // Stable collapse topic is limited to 32 URL-safe characters by Web Push.
          topic: fingerprint(event.id).slice(0, 32),
        });
      },
    });
  });
  const results = await Promise.allSettled([emailTask, pushTask]);
  const email = results[0].status === "fulfilled" ? results[0].value : { status: "retry", code: "storage_failure" };
  const pushes = results[1].status === "fulfilled" ? results[1].value : [{ status: "retry", code: "storage_failure" }];
  const channels = [email, ...pushes];
  const pending = channels.some((channel) => !TERMINAL_STATES.has(channel?.status));
  const attention = alert.fanoutTruncated || channels.some((channel) => channel?.status === "needs_attention");
  const status = pending ? "processing" : attention ? "needs_attention" : "complete";
  const summary = {
    status, emailStatus: email?.status || "retry", pushTargetCount: alert.deviceIds.length,
    pushAcceptedCount: pushes.filter((channel) => channel?.status === "sent").length,
    pushSkippedCount: pushes.filter((channel) => channel?.status === "skipped").length,
    fanoutTruncated: alert.fanoutTruncated,
    code: alert.fanoutTruncated ? "device_limit_exceeded" : attention ? "delivery_needs_attention" : pending ? "retry_pending" : "delivery_finished",
    updatedAtMs: now(),
  };
  await store.summarizeAlert(event.id, summary);
  return summary;
}
