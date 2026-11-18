import { createDocumentWrite } from "../razorpay/firebase.js";
import { createPushStore } from "./push-store.js";

export const BOOKING_ALERT_EMAIL_RECIPIENT = "asherhealthcare100@gmail.com";
export const BOOKING_EMAIL_OUTBOX = "appointmentEmailOutbox";

const PROJECT = "asher-healthcare-clinic";
const ORIGIN = "https://asherhealthcare.in";
const ORIGINS = new Set([ORIGIN, "https://www.asherhealthcare.in"]);
const EMAIL_ENDPOINT = "https://api.resend.com/emails";
const DOCTORS = new Map([["pediatrics", "Dr. Lt Col Shafi Ahamad"], ["obg", "Dr. Shaik Reshma"]]);
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const ID = /^[A-Za-z0-9_-]{1,128}$/u;
const MESSAGE_ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu;
const SWEEP_SECRET = /^[A-Za-z0-9_-]{43}$/u;
const KEY = /^re_[A-Za-z0-9_-]{12,200}$/u;
const PLACEHOLDER = /placeholder|change.?me|replace.?me|your.?api.?key|example|x{8,}/iu;
const TERMINAL = new Set(["accepted", "skipped", "needs_attention"]);
const STATES = new Set(["pending", "processing", ...TERMINAL]);
const ACTIVE_BOOKING_STATES = new Set(["requested", "confirmed", "checked_in", "waiting", "in_consultation"]);
const FIELD_FALLBACK = "See appointment desk";
const MAX_ATTEMPTS = 12;
// Resend holds idempotency keys for 24h. Stop all sends well before that.
const RETRY_WINDOW_MS = 20 * 60 * 60 * 1000;
const DISPATCH_BUDGET_MS = 10_000;
const PROVIDER_BUDGET_MS = 4_000;
const LEASE_MS = 45_000;
const PROVIDER_BODY_LIMIT = 4096;

function timestamp(value) {
  return value instanceof Date ? value.getTime() : typeof value === "string" ? Date.parse(value) : NaN;
}

function utcTime(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)) return NaN;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return NaN;
  const iso = new Date(time).toISOString();
  return time > 0 && (value === iso || value === iso.replace(/\.000Z$/u, "Z")) ? time : NaN;
}

function activationTime(env) { return utcTime(env?.BOOKING_ALERT_EMAIL_ACTIVATED_AT); }
function validSendingKey(env) {
  const key = env?.BOOKING_ALERT_RESEND_API_KEY;
  return typeof key === "string" && KEY.test(key) && !PLACEHOLDER.test(key);
}

export function bookingEmailTestReady(env, now = Date.now()) {
  const until = utcTime(env?.BOOKING_ALERT_EMAIL_TEST_UNTIL);
  return env?.FIREBASE_PROJECT_ID === PROJECT && env.BOOKING_ALERT_EMAIL_ENABLED === "false"
    && validSendingKey(env) && Number.isFinite(now) && until > now && until - now <= 3_600_000;
}

export function bookingEmailReadiness(env, now = Date.now()) {
  return env?.FIREBASE_PROJECT_ID === PROJECT
    && env.BOOKING_ALERT_EMAIL_ENABLED === "true"
    && Number.isFinite(now) && activationTime(env) <= now
    && validSendingKey(env)
    && typeof env.BOOKING_ALERT_EMAIL_SWEEP_SECRET === "string"
    && SWEEP_SECRET.test(env.BOOKING_ALERT_EMAIL_SWEEP_SECRET);
}

export function prepareBookingEmailOutbox(env, request, { appointmentId, source, now }) {
  const nowMs = timestamp(now);
  if (source !== "website" || typeof appointmentId !== "string" || !ID.test(appointmentId)
    || !bookingEmailReadiness(env, nowMs)) return null;
  let requestOrigin;
  try { requestOrigin = new URL(request.url).origin; } catch { return null; }
  if (!ORIGINS.has(requestOrigin)) return null;

  return createDocumentWrite(env, `${BOOKING_EMAIL_OUTBOX}/${appointmentId}`, {
    appointmentId, requestOrigin, createdAt: new Date(nowMs), status: "pending", nextAttemptAt: nowMs,
  });
}

function timeoutError() {
  return Object.assign(new Error("Email dispatch deadline reached."), { code: "dispatch_timeout" });
}

// A time limit applies even if a storage operation or mocked transport ignores
// cancellation. The mutation guard prevents another send after a timed-out claim.
function deadline(now, duration, externalSignal) {
  const end = now() + duration;
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, duration);
  if (externalSignal?.aborted) abort();
  else externalSignal?.addEventListener("abort", abort, { once: true });
  const check = () => { if (controller.signal.aborted || now() >= end) throw timeoutError(); };
  return {
    signal: controller.signal,
    check,
    remaining: () => Math.max(0, end - now()),
    async run(operation) {
      check();
      let abort;
      const expired = new Promise((_, reject) => {
        abort = () => reject(timeoutError());
        controller.signal.addEventListener("abort", abort, { once: true });
      });
      try {
        const value = await Promise.race([Promise.resolve().then(() => { check(); return operation(); }), expired]);
        check();
        return value;
      } finally { controller.signal.removeEventListener("abort", abort); }
    },
    close() { clearTimeout(timer); externalSignal?.removeEventListener("abort", abort); abort(); },
  };
}

function result(record) {
  // Return no arbitrary stored strings, private addresses or provider data.
  return { status: STATES.has(record?.status) ? record.status : "skipped" };
}

function terminal(status, reason, tick) {
  return {
    status, reason, updatedAt: new Date(tick), completedAt: new Date(tick),
    nextAttemptAt: null, leaseToken: null, leaseUntil: 0,
  };
}

function outboxProblem(record, appointmentId, activation, tick) {
  const created = timestamp(record.createdAt);
  if (record.appointmentId !== appointmentId || !ORIGINS.has(record.requestOrigin)
    || !["pending", "processing"].includes(record.status)
    || !Number.isSafeInteger(record.nextAttemptAt) || record.nextAttemptAt <= 0
    || (record.attempts !== undefined && (!Number.isSafeInteger(record.attempts) || record.attempts < 0))) return "invalid_outbox";
  if (!Number.isFinite(created) || created < activation || created > tick) return "outside_activation";
  return null;
}

function genuineWebsiteRequest(record, appointment, activation) {
  const created = timestamp(appointment?.createdAt);
  return Number.isFinite(created) && created >= activation
    && created === timestamp(record.createdAt)
    && appointment.requestOrigin === record.requestOrigin
    && appointment.source === "website" && appointment.createdBy === "public-website"
    && appointment.privacyAccepted === true && ACTIVE_BOOKING_STATES.has(appointment.status);
}

function safeEmailBody(appointment, test = false) {
  // Plain text only. Strip controls/formatting and keep common name punctuation.
  // Spacing dots within words prevents a name value from creating a second URL.
  const name = typeof appointment.patientName === "string" ? appointment.patientName.slice(0, 160).normalize("NFKC")
    .replace(/[^\p{L}\p{M} .’'\-]/gu, " ").replace(/\.(?=\p{L})/gu, ". ").replace(/\s+/gu, " ").trim() : "";
  const phone = typeof appointment.phone === "string" && appointment.phone.length <= 24 ? appointment.phone.normalize("NFKC").trim() : "";
  const digits = phone.replace(/\D/gu, "");
  const nameLength = Array.from(name).length;
  const safeName = nameLength >= 2 && nameLength <= 80 && /\p{L}/u.test(name) ? name : FIELD_FALLBACK;
  const safePhone = digits.length >= 10 && digits.length <= 15 && /^\+?[0-9(). -]+$/u.test(phone)
    ? `${phone.startsWith("+") ? "+" : ""}${digits}` : FIELD_FALLBACK;
  const doctor = DOCTORS.get(appointment.doctorId);
  const date = appointment.preferredDate;
  const time = appointment.preferredTime;
  if (!doctor
    || typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(date)
    || typeof time !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(time)) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null;
  const [year, month, day] = date.split("-");
  const [hour, minute] = time.split(":");
  const formatted = `${Number(day)} ${MONTHS[Number(month) - 1]} ${year} at ${Number(hour) % 12 || 12}:${minute} ${Number(hour) < 12 ? "AM" : "PM"} IST (India time)`;

  // Keep the format stable for all in-flight jobs. The payload digest is pinned
  // internally to fail closed if the immutable provider body would change.
  return JSON.stringify({
    from: "booking-alerts@notify.asherhealthcare.in",
    to: [BOOKING_ALERT_EMAIL_RECIPIENT],
    subject: test ? "[TEST] Asher Healthcare booking email — no appointment" : "Asher Healthcare — new website appointment request",
    text: [
      test ? "TEST ONLY: Fictional details. No appointment or slot was created. No action is needed."
        : "A new appointment request was submitted on the Asher Healthcare website.", "",
      `Patient: ${safeName}`, `Booking mobile: ${safePhone}`,
      `Doctor: ${doctor}`, `Appointment: ${formatted}`, "",
      `Sign in to review it: ${ORIGIN}/admin/appointments`,
    ].join("\n"),
  });
}

async function sha256(value) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function providerJson(response) {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let length = 0;
  let text = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > PROVIDER_BODY_LIMIT) return null;
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch { return null; }
  finally { void reader.cancel().catch(() => {}); }
}

function retryAfter(header, tick) {
  if (typeof header !== "string" || header.length > 128) return 0;
  const value = header.trim();
  if (/^\d+$/u.test(value)) return Number(value) * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - tick) : 0;
}

async function sendEmail(fetchRequest, apiKey, key, body, signal, now) {
  const response = await fetchRequest(EMAIL_ENDPOINT, {
    method: "POST", redirect: "manual", signal,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": key },
    body,
  });
  const status = response.status;
  if (status >= 200 && status < 300) {
    const receipt = await providerJson(response);
    return typeof receipt?.id === "string" && MESSAGE_ID.test(receipt.id)
      ? { accepted: true }
      : { reason: "invalid_provider_response", retryable: true };
  }
  if (status === 409) {
    const failure = await providerJson(response);
    if (failure?.name === "invalid_idempotent_request") {
      return { reason: "idempotency_payload_mismatch", retryable: false };
    }
  } else { void response.body?.cancel().catch(() => {}); }
  return {
    reason: status >= 300 && status <= 599 ? `provider_${status}` : "invalid_provider_response",
    retryable: status === 408 || status === 409 || status === 425 || status === 429 || (status >= 500 && status <= 599),
    retryAfter: retryAfter(response.headers.get("Retry-After"), now()),
  };
}

// Synthetic-only preflight: intentionally no Firestore dependency or input fields.
export async function sendBookingEmailTest(env, { now = Date.now, fetchRequest = fetch } = {}) {
  if (!bookingEmailTestReady(env, now())) return false;
  const body = safeEmailBody({
    patientName: "Clinic Delivery Test", phone: "0000000000",
    doctorId: "pediatrics", preferredDate: "2030-01-04", preferredTime: "17:30",
  }, true);
  const key = `asher-booking-email-test-v1/${utcTime(env.BOOKING_ALERT_EMAIL_TEST_UNTIL)}`;
  const timeout = deadline(now, PROVIDER_BUDGET_MS);
  try {
    const response = await timeout.run(() => sendEmail(fetchRequest, env.BOOKING_ALERT_RESEND_API_KEY, key, body, timeout.signal, now));
    return response.accepted === true;
  } catch { return false; } finally { timeout.close(); }
}

function failurePatch(sent, claimed, tick) {
  const delay = Math.min(3_600_000, 60_000 * (2 ** Math.min(claimed.attempts - 1, 6)));
  const nextAttemptAt = tick + Math.max(delay, sent.retryAfter || 0);
  if (sent.retryable && claimed.attempts < MAX_ATTEMPTS && nextAttemptAt < timestamp(claimed.createdAt) + RETRY_WINDOW_MS) {
    return { status: "pending", reason: sent.reason, nextAttemptAt, leaseToken: null, leaseUntil: 0, updatedAt: new Date(tick) };
  }
  return terminal("needs_attention", sent.reason, tick);
}

export function createBookingEmailDeliveryService(overrides = {}) {
  const now = overrides.now || Date.now;
  const store = overrides.store || createPushStore(overrides);
  const fetchRequest = overrides.fetch || fetch;
  const token = overrides.token || (() => crypto.randomUUID());
  const duration = Math.min(DISPATCH_BUDGET_MS, overrides.budgetMs || DISPATCH_BUDGET_MS);
  return {
    async deliver(env, appointmentId, { signal } = {}) {
      if (typeof appointmentId !== "string" || !ID.test(appointmentId) || !bookingEmailReadiness(env, now())) {
        return { status: "skipped" };
      }
      const total = deadline(now, duration, signal);
      const path = `${BOOKING_EMAIL_OUTBOX}/${appointmentId}`;
      const leaseToken = token();
      const activation = activationTime(env);
      let ownsLease = false;
      try {
        const claimed = await total.run(() => store.mutate(env, path, (current) => {
          if (!current || TERMINAL.has(current.status)) return null;
          const tick = now();
          const problem = outboxProblem(current, appointmentId, activation, tick);
          if (problem) return terminal("skipped", problem, tick);
          if (current.nextAttemptAt > tick || current.leaseUntil > tick) return null;
          const attempts = current.attempts || 0;
          if (attempts >= MAX_ATTEMPTS || tick >= timestamp(current.createdAt) + RETRY_WINDOW_MS) {
            return terminal("needs_attention", "retry_window_closed", tick);
          }
          const leaseUntil = tick + LEASE_MS;
          return { status: "processing", attempts: attempts + 1, leaseToken, leaseUntil, nextAttemptAt: leaseUntil, updatedAt: new Date(tick) };
        }, total.check));
        if (claimed?.leaseToken !== leaseToken) return result(claimed);
        ownsLease = true;

        const booking = await total.run(() => store.get(env, `appointments/${appointmentId}`));
        let patch;
        const genuine = genuineWebsiteRequest(claimed, booking?.data, activation);
        const payload = genuine && safeEmailBody(booking.data);
        if (!genuine) {
          patch = terminal("skipped", "not_website_request", now());
        } else if (!payload) {
          patch = terminal("needs_attention", "invalid_booking_fields", now());
        } else if (now() >= timestamp(claimed.createdAt) + RETRY_WINDOW_MS) {
          patch = terminal("needs_attention", "retry_window_closed", now());
        } else if (total.remaining() <= 2_000) {
          patch = failurePatch({ retryable: true, reason: "dispatch_timeout" }, claimed, now());
        } else {
          const [digest, payloadHash] = await total.run(() => Promise.all([
            sha256(appointmentId), sha256(JSON.stringify([appointmentId, payload])),
          ]));
          // A deterministic provider key discloses no raw appointment ID. Pin
          // only a digest, never the message or private values, before sending.
          const key = `asher-pages-booking-email-v1/${digest}`;
          const pinned = await total.run(() => store.mutate(env, path, (current) => {
            if (current?.leaseToken !== leaseToken || current.payloadHash === payloadHash) return null;
            return current.payloadHash === undefined ? { payloadHash, updatedAt: new Date(now()) }
              : terminal("needs_attention", "booking_details_changed", now());
          }, total.check));
          if (pinned?.leaseToken !== leaseToken) return result(pinned);
          if (pinned.payloadHash !== payloadHash) throw new Error("Email payload could not be pinned.");
          // Preserve time to save a result. A failed save leaves a recoverable
          // lease; the next attempt will present the exact same provider key.
          if (now() >= timestamp(claimed.createdAt) + RETRY_WINDOW_MS) {
            patch = terminal("needs_attention", "retry_window_closed", now());
          } else if (total.remaining() <= 2_000) {
            patch = failurePatch({ retryable: true, reason: "dispatch_timeout" }, claimed, now());
          } else {
            const provider = deadline(now, Math.min(PROVIDER_BUDGET_MS, total.remaining() - 1_000), total.signal);
            let sent;
            try {
              sent = await provider.run(() => sendEmail(fetchRequest, env.BOOKING_ALERT_RESEND_API_KEY, key, payload, provider.signal, now));
            } catch (error) {
              sent = { retryable: true, reason: error?.code === "dispatch_timeout" ? "dispatch_timeout" : "transport_failure" };
            } finally { provider.close(); }
            patch = sent.accepted ? terminal("accepted", "accepted_by_provider", now()) : failurePatch(sent, claimed, now());
          }
        }

        const final = await total.run(() => store.mutate(env, path, (current) => current?.leaseToken === leaseToken ? patch : null, total.check));
        return result(final);
      } catch {
        // No exception text, credentials, provider bodies or booking data in logs.
        return { status: ownsLease ? "processing" : "pending" };
      } finally { total.close(); }
    },
  };
}
