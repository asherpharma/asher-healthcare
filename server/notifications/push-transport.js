import webPush from "web-push";
import { createECDH } from "node:crypto";
import { validatePushSubscription } from "./booking-alerts.js";

/** Encrypt with the established Web Push library; use Workers' native fetch. */
export function createWebPushTransport({ fetch: fetchRequest = fetch, now = Date.now } = {}) {
  return async function sendPush(subscription, message, options) {
    // http_ece has a diagnostic mode that logs encryption material. Fail closed
    // instead of allowing that mode in a live notification sender.
    if (typeof process !== "undefined" && process.env?.ECE_KEYLOG === "1") {
      throw Object.assign(new Error("Unsafe push diagnostics are enabled."), { status: 401 });
    }
    const safeSubscription = await validatePushSubscription(subscription, new Date(now()));
    try {
      const curve = createECDH("prime256v1");
      curve.setPrivateKey(Buffer.from(options.privateKey, "base64url"));
      if (curve.getPublicKey().toString("base64url") !== options.publicKey) throw new Error("Mismatched key pair.");
    } catch {
      throw Object.assign(new Error("Push signing configuration does not match."), { status: 401 });
    }
    if (message?.type !== "appointment-request" || !/^[A-Za-z0-9_-]{1,128}$/u.test(message.appointmentId || "")) {
      throw Object.assign(new Error("Invalid notification payload."), { code: "invalid_payload" });
    }
    const details = webPush.generateRequestDetails(safeSubscription, JSON.stringify({
      type: "appointment-request", appointmentId: message.appointmentId,
    }), {
      TTL: 3600, urgency: "normal", topic: options.topic,
      contentEncoding: "aes128gcm",
      vapidDetails: {
        subject: "mailto:asherhealthcare100@gmail.com",
        publicKey: options.publicKey, privateKey: options.privateKey,
      },
    });
    // Never follow a push service redirect with authorization/encrypted data.
    const response = await fetchRequest(details.endpoint, {
      method: "POST", headers: Object.fromEntries(Object.entries(details.headers)
        .filter(([name]) => name.toLowerCase() !== "content-length")
        .map(([name, value]) => [name, String(value)])), body: details.body,
      // Workerd supports manual/follow, not the Node fetch "error" mode.
      // Manual prevents forwarding authorization, and every 3xx is rejected below.
      redirect: "manual", signal: options.signal,
    });
    // Provider response bodies can contain subscription identifiers. Do not log,
    // return, or persist them. HTTP acceptance does not prove phone display.
    if (response.status < 200 || response.status >= 300) {
      throw Object.assign(new Error("Push service did not accept the notification."), { status: response.status });
    }
    if (response.body) await response.body.cancel().catch(() => {});
  };
}
