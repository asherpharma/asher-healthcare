import { serviceAccountAccessToken } from "../../../server/razorpay/firebase.js";
import {
  BOOKING_EMAIL_OUTBOX, bookingEmailReadiness, createBookingEmailDeliveryService,
} from "../../../server/notifications/email-delivery.js";

const SWEEP_URL = "https://asherhealthcare.in/api/internal/booking-email-sweep";
const LIMIT = 4;
const CONCURRENCY = 2;
const SWEEP_TIMEOUT_MS = 20_000;
const encoder = new TextEncoder();
const delivery = createBookingEmailDeliveryService();

function validSecret(value) {
  return typeof value === "string" && value.length === 43 && /^[A-Za-z0-9_-]+$/u.test(value);
}

function blankResponse(status) {
  return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
}

function comparison(left, right) {
  // Cloudflare Workers exposes the native fixed-size Web Crypto comparison.
  return crypto.subtle.timingSafeEqual(left, right);
}

function authorized(request, env, compare) {
  if (request.method !== "POST" || request.url !== SWEEP_URL
    || request.body !== null || request.headers.has("Origin")) return false;
  const secret = env?.BOOKING_ALERT_EMAIL_SWEEP_SECRET;
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return false;
  const presented = auth.slice(7);
  if (!validSecret(secret) || !validSecret(presented)) return false;
  return compare(encoder.encode(presented), encoder.encode(secret));
}

function withinDeadline(signal, work) {
  signal.throwIfAborted();
  let stop;
  const expired = new Promise((_, reject) => {
    stop = () => reject(new Error("Booking email sweep timed out."));
    signal.addEventListener("abort", stop, { once: true });
  });
  return Promise.race([Promise.resolve().then(() => {
    signal.throwIfAborted();
    return work();
  }), expired])
    .finally(() => signal.removeEventListener("abort", stop));
}

async function dueEmailIds(env, now, signal, fetchRequest, accessToken) {
  const token = await accessToken(env);
  signal.throwIfAborted();
  const project = encodeURIComponent(env.FIREBASE_PROJECT_ID);
  const documentNamePrefix = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${BOOKING_EMAIL_OUTBOX}/`;
  const nextAttemptField = { fieldPath: "nextAttemptAt" };
  const response = await fetchRequest(
    `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents:runQuery`,
    {
      method: "POST",
      // Reject unexpected responses below. Pages workerd does not support "error".
      redirect: "manual",
      signal,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ structuredQuery: {
        select: { fields: [{ fieldPath: "__name__" }] },
        from: [{ collectionId: BOOKING_EMAIL_OUTBOX }],
        where: { compositeFilter: { op: "AND", filters: [
          { fieldFilter: { field: nextAttemptField, op: "GREATER_THAN", value: { integerValue: "0" } } },
          { fieldFilter: { field: nextAttemptField, op: "LESS_THAN_OR_EQUAL", value: { integerValue: String(now) } } },
        ] } },
        orderBy: [{ field: nextAttemptField, direction: "ASCENDING" }],
        limit: LIMIT,
      } }),
    },
  );
  if (!response.ok) throw new Error("Booking email outbox query failed.");
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error("Booking email outbox query was invalid.");
  const ids = new Set();
  for (const row of rows) {
    const name = row?.document?.name;
    if (typeof name !== "string" || !name.startsWith(documentNamePrefix)) continue;
    const id = name.slice(documentNamePrefix.length);
    if (/^[a-zA-Z0-9_-]{1,128}$/u.test(id)) ids.add(id);
    if (ids.size >= LIMIT) break;
  }
  return [...ids];
}

export function createBookingEmailSweepHandler({
  compare = comparison,
  readiness = bookingEmailReadiness,
  accessToken = serviceAccountAccessToken,
  fetchRequest = fetch,
  deliver = (env, id, options) => delivery.deliver(env, id, options),
  now = Date.now,
  createSignal = () => AbortSignal.timeout(SWEEP_TIMEOUT_MS),
} = {}) {
  return async function bookingEmailSweep({ request, env }) {
    // Do not expose configuration or authorization details to an untrusted caller.
    try {
      if (!authorized(request, env, compare)) return blankResponse(404);
    } catch {
      return blankResponse(404);
    }
    try {
      const nowMs = now();
      if (env.FIREBASE_PROJECT_ID !== "asher-healthcare-clinic" || !readiness(env, nowMs)) {
        return blankResponse(503);
      }
      const signal = createSignal();
      await withinDeadline(signal, async () => {
        const ids = await dueEmailIds(env, nowMs, signal, fetchRequest, accessToken);
        let cursor = 0;
        let failed = false;
        const runLane = async () => {
          while (!signal.aborted && cursor < ids.length) {
            const id = ids[cursor++];
            try {
              await deliver(env, id, { signal });
            } catch {
              failed = true;
            }
          }
        };
        // Allow independent jobs to progress even if one delivery throws.
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, runLane));
        if (failed || signal.aborted) throw new Error("Booking email sweep did not finish.");
      });
      return blankResponse(204);
    } catch {
      // Provider responses, event identifiers and credentials never leave this handler.
      return blankResponse(503);
    }
  };
}

export const onRequest = createBookingEmailSweepHandler();
