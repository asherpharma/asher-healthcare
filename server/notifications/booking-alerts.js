import {
  commitWrites,
  createDocumentWrite,
  getDocument,
  serviceAccountAccessToken,
  updateDocumentWrite,
  verifyDocumentWrite,
} from "../razorpay/firebase.js";
import { HttpError } from "../razorpay/http.js";

export const BOOKING_ALERT_PRODUCTION_ORIGIN = "https://asherhealthcare.in";
export const BOOKING_ALERT_EMAIL_RECIPIENT = "asherhealthcare100@gmail.com";
const PROJECT_ID = "asher-healthcare-clinic";
const DELIVERY_WINDOW = 20;
const DEVICE_ID_PATTERN = /^[a-f0-9]{64}$/u;
const ENDPOINT_PATHS = Object.freeze({
  "fcm.googleapis.com": /^\/(?:fcm\/send|wp)\/[A-Za-z0-9:_-]{20,2048}$/u,
  "updates.push.services.mozilla.com": /^\/wpush\/v[12]\/[A-Za-z0-9_-]{20,2048}$/u,
  "web.push.apple.com": /^\/[A-Za-z0-9_-]{20,2048}$/u,
});

const DEFAULT_DEPENDENCIES = Object.freeze({
  commitWrites,
  createDocumentWrite,
  getDocument,
  updateDocumentWrite,
  verifyDocumentWrite,
  listRecentOutbox,
  deliverPush: null,
  now: () => new Date(),
});

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertOnlyKeys(value, allowed) {
  if (!isObject(value) || Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new HttpError(400, "The notification request contains unsupported fields.");
  }
}

function base64UrlBytes(value, length) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  if (value.length !== Math.ceil(length * 4 / 3)) return null;
  try {
    const decoded = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
    if (decoded.length !== length) return null;
    const canonical = btoa(decoded).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
    return canonical === value ? Uint8Array.from(decoded, (character) => character.charCodeAt(0)) : null;
  } catch {
    return null;
  }
}

function assertAdministrator(administrator) {
  if (!administrator?.uid || administrator.role !== "admin") {
    throw new HttpError(403, "Only an active clinic administrator can manage appointment alerts.");
  }
}

export function bookingPushReadiness(env, now = Date.now()) {
  const activation = env.BOOKING_ALERTS_ACTIVATED_AT;
  const publicBytes = base64UrlBytes(env.BOOKING_ALERT_VAPID_PUBLIC_KEY, 65);
  const privateBytes = base64UrlBytes(env.BOOKING_ALERT_VAPID_PRIVATE_KEY, 32);
  const activationMs = typeof activation === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(activation)
    ? Date.parse(activation) : NaN;
  return env.FIREBASE_PROJECT_ID === PROJECT_ID
    && env.BOOKING_ALERTS_ENABLED === "true"
    && env.BOOKING_ALERT_PUSH_CONFIGURED === "true"
    && Number.isFinite(activationMs) && activationMs <= now
    && new Date(activationMs).toISOString() === (activation.includes(".") ? activation : activation.replace("Z", ".000Z"))
    && publicBytes?.[0] === 4 && Boolean(privateBytes);
}

export function prepareBookingPushOutbox(env, request, { appointmentId, source, now }) {
  const requestOrigin = new URL(request.url).origin;
  if (source !== "website" || !bookingPushReadiness(env, now.getTime())
    || ![BOOKING_ALERT_PRODUCTION_ORIGIN, "https://www.asherhealthcare.in"].includes(requestOrigin)) return null;
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(appointmentId || "")) return null;
  return createDocumentWrite(env, `appointmentPushOutbox/${appointmentId}`, {
    appointmentId, requestOrigin, createdAt: now, status: "pending",
  });
}

export function bookingAlertConfiguration(request, env, now = Date.now()) {
  const origin = new URL(request.url).origin;
  const suppliedOrigin = request.headers.get("Origin");
  const enabled = env.BOOKING_ALERTS_ENABLED === "true"
    && env.FIREBASE_PROJECT_ID === PROJECT_ID
    && origin === BOOKING_ALERT_PRODUCTION_ORIGIN
    && (!suppliedOrigin || suppliedOrigin === BOOKING_ALERT_PRODUCTION_ORIGIN);
  const publicKey = typeof env.BOOKING_ALERT_VAPID_PUBLIC_KEY === "string"
    ? env.BOOKING_ALERT_VAPID_PUBLIC_KEY : "";
  const publicBytes = base64UrlBytes(publicKey, 65);
  const validPublicKey = publicBytes?.[0] === 4;
  return {
    emailRecipient: BOOKING_ALERT_EMAIL_RECIPIENT,
    emailConfigured: false,
    emailPaused: true,
    pushDeliveryMethod: "cloudflare",
    pushConfigured: enabled && bookingPushReadiness(env, now) && validPublicKey === true,
    vapidPublicKey: enabled && validPublicKey ? publicKey : "",
    enabled,
    productionOrigin: BOOKING_ALERT_PRODUCTION_ORIGIN,
  };
}

async function listRecentOutbox(env) {
  const token = await serviceAccountAccessToken(env);
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/databases/(default)/documents:runQuery`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: "appointmentPushOutbox" }],
      orderBy: [{ field: { fieldPath: "createdAt" }, direction: "DESCENDING" }],
      limit: DELIVERY_WINDOW,
    } }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new HttpError(503, "Recent notification attempts could not be checked.");
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new HttpError(503, "Recent notification attempts could not be checked.");
  return rows.filter((row) => row.document).slice(0, DELIVERY_WINDOW).map(({ document }) => ({
    id: document.name?.split("/").pop(),
    status: document.fields?.status?.stringValue,
    createdAt: document.fields?.createdAt?.timestampValue || null,
  }));
}

function emptyDeliverySummary() {
  return { available: false, limit: DELIVERY_WINDOW, checked: 0, pending: 0, failed: 0, items: [] };
}

async function deliverySummary(dependencies, env) {
  try {
    const rows = (await dependencies.listRecentOutbox(env)).slice(0, DELIVERY_WINDOW);
    const items = rows.filter((row) => /^[A-Za-z0-9_-]{1,128}$/u.test(row.id || "")
      && ["pending", "processing", "needs_attention"].includes(row.status)).map((row) => ({
      appointmentId: row.id,
      status: row.status,
      createdAt: typeof row.createdAt === "string" && Number.isFinite(Date.parse(row.createdAt)) ? row.createdAt : null,
    }));
    return {
      available: true, limit: DELIVERY_WINDOW, checked: rows.length,
      pending: items.filter((item) => item.status !== "needs_attention").length,
      failed: items.filter((item) => item.status === "needs_attention").length,
      items,
    };
  } catch {
    return emptyDeliverySummary();
  }
}

export function validateBookingAlertDeviceId(deviceId) {
  if (typeof deviceId !== "string" || !DEVICE_ID_PATTERN.test(deviceId)) {
    throw new HttpError(400, "The notification device reference is invalid.");
  }
  return deviceId;
}

export async function validatePushSubscription(subscription, now = new Date()) {
  assertOnlyKeys(subscription, ["endpoint", "expirationTime", "keys"]);
  assertOnlyKeys(subscription.keys, ["p256dh", "auth"]);
  if (typeof subscription.endpoint !== "string" || subscription.endpoint.length > 2200) {
    throw new HttpError(400, "The push notification endpoint is invalid.");
  }
  let endpoint;
  try {
    endpoint = new URL(subscription.endpoint);
  } catch {
    throw new HttpError(400, "The push notification endpoint is invalid.");
  }
  const allowedPath = Object.hasOwn(ENDPOINT_PATHS, endpoint.hostname) ? ENDPOINT_PATHS[endpoint.hostname] : null;
  if (endpoint.protocol !== "https:" || endpoint.port || endpoint.username || endpoint.password
    || endpoint.search || endpoint.hash || !allowedPath?.test(endpoint.pathname)
    || endpoint.href !== subscription.endpoint) {
    throw new HttpError(400, "This push notification service is not supported.");
  }
  const publicKey = base64UrlBytes(subscription.keys.p256dh, 65);
  const authentication = base64UrlBytes(subscription.keys.auth, 16);
  if (!publicKey || publicKey[0] !== 4 || !authentication) {
    throw new HttpError(400, "The push notification keys are invalid.");
  }
  try {
    await crypto.subtle.importKey("raw", publicKey, { name: "ECDH", namedCurve: "P-256" }, false, []);
  } catch {
    throw new HttpError(400, "The push notification public key is invalid.");
  }
  const expirationTime = subscription.expirationTime ?? null;
  if (expirationTime !== null && (typeof expirationTime !== "number"
    || !Number.isSafeInteger(expirationTime) || expirationTime <= now.getTime())) {
    throw new HttpError(400, "This push subscription has expired. Enable notifications again.");
  }
  return {
    endpoint: endpoint.href,
    expirationTime,
    keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
  };
}

export async function bookingAlertDeviceId(endpoint) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isActiveOwnedDevice(document, administrator, now) {
  const data = document?.data;
  const expiration = data?.subscription?.expirationTime;
  return Boolean(data && data.uid === administrator.uid && data.active === true
    && data.origin === BOOKING_ALERT_PRODUCTION_ORIGIN
    && (expiration === null || expiration === undefined
      || (typeof expiration === "number" && expiration > now.getTime())));
}

export function createBookingAlertService(overrides = {}) {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...overrides };
  return {
    async get(request, env, administrator) {
      assertAdministrator(administrator);
      const config = bookingAlertConfiguration(request, env, dependencies.now().getTime());
      const ids = new URL(request.url).searchParams.getAll("deviceId");
      if (ids.length > 1) throw new HttpError(400, "Provide only one notification device reference.");
      const deviceId = ids.length ? validateBookingAlertDeviceId(ids[0]) : null;
      const [summary, document] = await Promise.all([
        config.enabled && config.pushConfigured
          ? deliverySummary(dependencies, env) : emptyDeliverySummary(),
        deviceId && config.enabled && config.pushConfigured
          ? dependencies.getDocument(env, `adminPushDevices/${deviceId}`) : null,
      ]);
      return {
        ...config,
        ...(deviceId ? { deviceId } : {}),
        deviceActive: isActiveOwnedDevice(document, administrator, dependencies.now()),
        deliverySummary: summary,
      };
    },
    async post(request, env, administrator, body) {
      assertAdministrator(administrator);
      const config = bookingAlertConfiguration(request, env, dependencies.now().getTime());
      if (env.FIREBASE_PROJECT_ID !== PROJECT_ID
        || new URL(request.url).origin !== BOOKING_ALERT_PRODUCTION_ORIGIN
        || request.headers.get("Origin") !== BOOKING_ALERT_PRODUCTION_ORIGIN) {
        throw new HttpError(403, "Appointment notifications can only be managed on the live clinic site.");
      }
      assertOnlyKeys(body, ["action", "subscription", "deviceId", "appointmentId"]);
      if (!["subscribe", "unsubscribe", "retry"].includes(body.action)) {
        throw new HttpError(400, "Choose a valid notification action.");
      }
      if (body.action !== "unsubscribe" && !config.enabled) {
        throw new HttpError(403, "Appointment notifications are not enabled yet.");
      }
      if (body.action !== "unsubscribe" && !config.pushConfigured) {
        throw new HttpError(503, "Mobile notification setup is not complete yet.");
      }
      if (body.action === "retry") {
        assertOnlyKeys(body, ["action", "appointmentId"]);
        if (typeof body.appointmentId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(body.appointmentId)) {
          throw new HttpError(400, "Choose a valid notification attempt.");
        }
        if (typeof dependencies.deliverPush !== "function") throw new HttpError(503, "Mobile delivery is not available.");
        const result = await dependencies.deliverPush(env, body.appointmentId);
        const count = (value) => Number.isSafeInteger(value) && value >= 0 ? value : 0;
        return {
          retried: true,
          appointmentId: body.appointmentId,
          delivery: {
            status: ["pending", "processing", "sent", "skipped", "needs_attention"].includes(result?.status) ? result.status : "needs_attention",
            sent: count(result?.sent), pending: count(result?.pending),
            skipped: count(result?.skipped), failed: count(result?.failed),
          },
        };
      }
      if (body.appointmentId !== undefined) throw new HttpError(400, "An appointment reference is only accepted for retry.");
      const now = dependencies.now();
      let subscription = null;
      let deviceId;
      if (body.action === "subscribe") {
        if (body.deviceId !== undefined) throw new HttpError(400, "A device reference is not accepted when enabling notifications.");
        subscription = await validatePushSubscription(body.subscription, now);
        deviceId = await bookingAlertDeviceId(subscription.endpoint);
      } else if (body.deviceId !== undefined) {
        if (body.subscription !== undefined) throw new HttpError(400, "Provide a device reference or subscription, not both.");
        deviceId = validateBookingAlertDeviceId(body.deviceId);
      } else {
        subscription = await validatePushSubscription(body.subscription, now);
        deviceId = await bookingAlertDeviceId(subscription.endpoint);
      }
      const path = `adminPushDevices/${deviceId}`;
      const previous = await dependencies.getDocument(env, path);
      if (previous && previous.data?.uid !== administrator.uid) {
        throw new HttpError(403, "This notification device belongs to a different administrator.");
      }
      if (body.action === "unsubscribe" && !previous) return { registered: false, deviceId };
      const registered = body.action === "subscribe";
      const data = registered ? {
        uid: administrator.uid,
        origin: BOOKING_ALERT_PRODUCTION_ORIGIN,
        subscription,
        active: true,
        updatedAt: now,
      } : { active: false, updatedAt: now };
      const write = previous
        ? dependencies.updateDocumentWrite(env, path, data, Object.keys(data), previous.updateTime)
        : dependencies.createDocumentWrite(env, path, { ...data, createdAt: now });
      const staffGuard = dependencies.verifyDocumentWrite(env, `staff/${administrator.uid}`, administrator.staffUpdateTime);
      await dependencies.commitWrites(env, [staffGuard, write]);
      return { registered, deviceId };
    },
  };
}
