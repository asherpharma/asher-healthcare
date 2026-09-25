export function publicKeyBytes(key) {
  const text = key.replaceAll("-", "+").replaceAll("_", "/");
  return Uint8Array.from(atob(text.padEnd(Math.ceil(text.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
}

export function usableSubscription(subscription, key, now = Date.now()) {
  const storedKey = subscription?.options.applicationServerKey;
  if (!storedKey || !key) return false;
  const expiry = subscription.expirationTime;
  if (expiry != null && (!Number.isFinite(expiry) || expiry <= now)) return false;
  try {
    const expected = publicKeyBytes(key);
    const actual = new Uint8Array(storedKey);
    return expected.length === actual.length && expected.every((byte, index) => byte === actual[index]);
  } catch { return false; }
}

export async function subscriptionDeviceId(subscription) {
  if (!subscription?.endpoint) return "";
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(subscription.endpoint));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
