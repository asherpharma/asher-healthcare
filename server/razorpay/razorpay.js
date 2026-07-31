import { HttpError, requireEnvironment } from "./http.js";

function razorpayAuthorization(env) {
  requireEnvironment(env, ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"]);
  return `Basic ${btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`)}`;
}

async function razorpayRequest(env, path, options = {}) {
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: razorpayAuthorization(env),
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const result = await response.json();
  if (!response.ok) {
    console.error("Razorpay API error", response.status, result?.error?.code);
    throw new HttpError(
      response.status >= 500 ? 503 : 400,
      result?.error?.description || "Razorpay could not process this payment request.",
    );
  }
  return result;
}

export function createRazorpayOrder(env, details) {
  return razorpayRequest(env, "/orders", {
    method: "POST",
    body: JSON.stringify(details),
  });
}

export function createRazorpayQrCode(env, details) {
  return razorpayRequest(env, "/payments/qr_codes", {
    method: "POST",
    body: JSON.stringify(details),
  });
}

export function fetchRazorpayQrCode(env, qrId) {
  return razorpayRequest(env, `/payments/qr_codes/${encodeURIComponent(qrId)}`);
}

export function fetchRazorpayQrCodePayments(env, qrId) {
  return razorpayRequest(
    env,
    `/payments/qr_codes/${encodeURIComponent(qrId)}/payments?count=10`,
  );
}

export function fetchRazorpayPayment(env, paymentId) {
  return razorpayRequest(env, `/payments/${encodeURIComponent(paymentId)}`);
}

export function captureRazorpayPayment(env, paymentId, amount) {
  return razorpayRequest(env, `/payments/${encodeURIComponent(paymentId)}/capture`, {
    method: "POST",
    body: JSON.stringify({ amount, currency: "INR" }),
  });
}

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return bytesToHex(new Uint8Array(signature));
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export async function verifyCheckoutSignature(env, orderId, paymentId, signature) {
  requireEnvironment(env, ["RAZORPAY_KEY_SECRET"]);
  const expected = await hmacHex(
    env.RAZORPAY_KEY_SECRET,
    `${orderId}|${paymentId}`,
  );
  return constantTimeEqual(expected, signature.toLowerCase());
}

export async function verifyWebhookSignature(env, payload, signature) {
  requireEnvironment(env, ["RAZORPAY_WEBHOOK_SECRET"]);
  const expected = await hmacHex(env.RAZORPAY_WEBHOOK_SECRET, payload);
  return constantTimeEqual(expected, signature.toLowerCase());
}
