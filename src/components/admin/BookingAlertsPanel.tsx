"use client";

import { useStaff } from "@/components/admin/StaffGuard";
import { publicKeyBytes, subscriptionDeviceId, usableSubscription } from "@/lib/booking-alert-device.mjs";
import { BellRing, LoaderCircle, Mail, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type AlertSetup = {
  enabled: boolean;
  emailPaused?: boolean;
  pushConfigured: boolean;
  vapidPublicKey: string;
  deviceActive: boolean;
  deliverySummary?: {
    available: boolean;
    limit: number;
    checked: number;
    pending: number;
    failed: number;
    items: Array<{ appointmentId: string; status: string; createdAt: string | null }>;
  };
};

const workerUrl = "/staff-v2-sw.js?v=asher-staff-20260827-1";
const buttonClass = "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#233A59] px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50";

function supportsPush() {
  return window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function storageKey(uid: string) { return `asher-booking-alert-device:${uid}`; }
function rememberedDevice(uid: string) {
  try { return localStorage.getItem(storageKey(uid)) || ""; } catch { return ""; }
}
function rememberDevice(uid: string, deviceId: string) {
  try {
    if (deviceId) localStorage.setItem(storageKey(uid), deviceId);
    else localStorage.removeItem(storageKey(uid));
  } catch { /* Device alerts still work when local preference storage is blocked. */ }
}

function AdminBookingAlerts() {
  const { user } = useStaff();
  const [setup, setSetup] = useState<AlertSetup | null>(null);
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [deviceId, setDeviceId] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const api = useCallback(async (body?: object, id = "", timeoutMs = 15_000) => {
    const token = await user.getIdToken();
    const response = await fetch(`/api/admin/booking-alerts${!body && id ? `?deviceId=${encodeURIComponent(id)}` : ""}`, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      credentials: "same-origin",
      cache: "no-store",
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Booking alert settings could not be saved.");
    return data;
  }, [user]);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const canPush = supportsPush();
      setSupported(canPush);
      const savedId = rememberedDevice(user.uid);
      const registration = canPush ? await navigator.serviceWorker.getRegistration("/admin") : undefined;
      const subscription = await registration?.pushManager.getSubscription();
      const currentId = await subscriptionDeviceId(subscription);
      const id = currentId || savedId;
      const data = await api(undefined, id) as AlertSetup;
      setSetup(data);
      // Keep opt-out available when alerts are paused and local storage is unavailable.
      // The server still verifies ownership before disabling this reference.
      setDeviceId(data.deviceActive ? id : savedId || currentId);
      if (data.deviceActive) rememberDevice(user.uid, id);
      const currentPermission = canPush ? Notification.permission : "default";
      setPermission(currentPermission);
      setEnabled(data.enabled && data.pushConfigured && data.deviceActive && id === currentId && usableSubscription(subscription, data.vapidPublicKey) && currentPermission === "granted");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Alert settings could not be loaded.");
      setEnabled(false);
    } finally { setBusy(false); }
  }, [api, user.uid]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function enable() {
    if (!setup?.enabled || !setup.pushConfigured || !supportsPush()) return;
    setBusy(true); setError(""); setNotice("");
    try {
      // Permission must only be requested in response to this explicit button tap.
      const granted = await Notification.requestPermission();
      setPermission(granted);
      if (granted !== "granted") throw new Error("Notifications were not allowed. You can enable them in Chrome’s site settings, then try again.");
      const registration = await navigator.serviceWorker.register(workerUrl, { scope: "/admin", updateViaCache: "none" });
      if (!registration.active) throw new Error("The staff app is finishing its update. Wait a moment and tap Enable again.");
      let subscription = await registration.pushManager.getSubscription();
      if (subscription && !usableSubscription(subscription, setup.vapidPublicKey)) {
        if (deviceId) await api({ action: "unsubscribe", deviceId });
        await subscription.unsubscribe();
        rememberDevice(user.uid, ""); setDeviceId("");
        subscription = null;
      }
      if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKeyBytes(setup.vapidPublicKey) });
      const currentId = await subscriptionDeviceId(subscription);
      if (deviceId && deviceId !== currentId) await api({ action: "unsubscribe", deviceId });
      const result = await api({ action: "subscribe", subscription: subscription.toJSON() });
      if (result.registered !== true || !/^[a-f0-9]{64}$/.test(result.deviceId || "")) throw new Error("The server did not confirm this device. Please retry enabling alerts.");
      rememberDevice(user.uid, result.deviceId);
      setDeviceId(result.deviceId); setEnabled(true);
      setNotice("This device is registered for new website booking alerts. Delivery also depends on Android notification and battery settings.");
    } catch (failure) {
      setEnabled(false);
      setError(failure instanceof Error ? failure.message : "Notifications could not be enabled.");
    } finally { setBusy(false); }
  }

  async function disable() {
    setBusy(true); setError(""); setNotice("");
    try {
      // Disable the server record before forgetting it, so retries remain possible.
      if (deviceId) await api({ action: "unsubscribe", deviceId });
      const registration = await navigator.serviceWorker.getRegistration("/admin");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) await subscription.unsubscribe();
      rememberDevice(user.uid, ""); setDeviceId(""); setEnabled(false);
      setNotice("Booking notifications are off on this device. Email setup remains paused.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Notifications could not be disabled. Please retry.");
    } finally { setBusy(false); }
  }

  async function checkDisplay() {
    setError(""); setNotice("");
    try {
      const registration = await navigator.serviceWorker.getRegistration("/admin");
      if (!registration || Notification.permission !== "granted") throw new Error("Enable notifications on this device first.");
      await registration.showNotification("Asher Healthcare · display test", {
        body: "Your phone can display staff notifications. This is not an end-to-end delivery test.",
        icon: "/icons/icon-192.png", tag: "asher-alert-display-test",
        data: { type: "appointment-request" },
      });
      setNotice("Display test shown. A real test booking is still needed to verify server-to-phone delivery while the app is closed.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The display test failed."); }
  }

  async function retryDelivery(appointmentId: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api({ action: "retry", appointmentId }, "", 25_000);
      if (result.retried !== true) throw new Error("The notification retry was not confirmed. Refresh status before trying again.");
      setNotice(result.delivery?.status === "processing"
        ? "Another notification attempt is in progress. Refresh status shortly. The appointment itself is unchanged."
        : result.delivery?.status === "needs_attention"
          ? "The notification still needs attention. Recent failed attempts have a retry delay; expired or permanent failures cannot be resent. The appointment itself is unchanged."
          : "Notification retry checked. A push service accepting an alert does not prove your phone displayed it. The appointment itself is unchanged.");
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Notification retry could not be completed. Refresh status before trying again.");
    } finally { setBusy(false); }
  }

  return (
    <section id="booking-alerts" aria-labelledby="booking-alerts-title" className="scroll-mt-24 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-7">
      <div className="flex items-start gap-3"><BellRing className="mt-1 shrink-0 text-[#A8864A]" size={24} /><div>
        <p className="text-xs font-bold uppercase tracking-widest text-[#775A2A]">Administrator notifications</p>
        <h2 id="booking-alerts-title" className="mt-2 text-2xl font-bold text-[#233A59]">Know when a patient books</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">Private Android alerts for new website appointment requests. Requests still need clinic confirmation. Email setup is paused.</p>
      </div></div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="min-w-0 rounded-2xl bg-slate-50 p-4"><Mail size={20} className="text-[#233A59]" /><h3 className="mt-3 font-bold text-[#233A59]">Email alerts · Paused</h3><p className="mt-2 text-sm text-slate-600">We can set up email later. Android alerts do not require the email sending service.</p></div>
        <div className="min-w-0 rounded-2xl bg-slate-50 p-4"><BellRing size={20} className="text-[#233A59]" /><h3 className="mt-3 font-bold text-[#233A59]">This phone or browser</h3><p className="mt-2 text-sm text-slate-600">{enabled ? "Registered for booking alerts" : permission === "denied" ? "Blocked in browser settings" : "Not enabled on this device"}</p><p className="mt-2 text-xs leading-5 text-slate-500">On Android, open the staff app or Chrome and tap Enable below. Allow notifications when Chrome asks.</p></div>
      </div>
      {setup && !setup.enabled && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Alerts are not live in this environment. Server setup and a delivery test must be completed before activation. Preview bookings never send alerts.</p>}
      {setup?.enabled && !setup.pushConfigured && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">The push delivery service is not configured yet.</p>}
      {!busy && !supported && <p className="mt-4 text-sm text-slate-600">Push notifications are unavailable in this browser. Use the latest Chrome on your Android phone.</p>}
      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <button type="button" className={buttonClass} disabled={busy || !supported || (!enabled && (!setup?.enabled || !setup.pushConfigured))} onClick={() => void (enabled ? disable() : enable())}>{busy ? <LoaderCircle size={18} className="animate-spin" /> : <BellRing size={18} />}{enabled ? "Disable on this device" : "Enable booking notifications"}</button>
        {deviceId && !enabled && <button type="button" disabled={busy} className="min-h-12 rounded-xl border border-slate-300 px-4 text-sm font-bold text-slate-700 disabled:opacity-50" onClick={() => void disable()}>Remove saved device</button>}
        {enabled && <button type="button" disabled={busy} className="min-h-12 rounded-xl border border-slate-300 px-4 text-sm font-bold text-slate-700" onClick={() => void checkDisplay()}>Check phone display</button>}
        <button type="button" disabled={busy} className="min-h-12 rounded-xl px-4 text-sm font-bold text-[#233A59] disabled:opacity-50" onClick={() => void refresh()}>Refresh status</button>
      </div>
      {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-800">{error}</p>}
      {notice && <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{notice}</p>}
      {setup?.enabled && <div className="mt-6 rounded-2xl border border-slate-200 p-4">
        <h3 className="font-bold text-[#233A59]">Recent delivery checks</h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">The server makes a short background delivery attempt. There are no automatic retries in this version. Saved appointments remain available even if an alert fails; you can retry the notification here.</p>
        {!setup.deliverySummary?.available ? <p className="mt-3 text-sm text-amber-900">Delivery checks are temporarily unavailable. Check the appointment desk and refresh this page.</p> : <>
          <p className="mt-3 text-sm text-slate-600">Latest {setup.deliverySummary.checked} records (up to {setup.deliverySummary.limit}): {setup.deliverySummary.pending} pending, {setup.deliverySummary.failed} needing attention. These are not all-time totals.</p>
          {setup.deliverySummary.items.length === 0 ? <p className="mt-3 text-sm text-slate-600">No unfinished alerts in this recent check. This does not confirm receipt on every phone.</p> : <ul className="mt-3 space-y-3">
            {setup.deliverySummary.items.map((delivery) => <li key={delivery.appointmentId} className="flex flex-col gap-3 rounded-xl bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0"><p className="text-sm font-semibold text-[#233A59]">{delivery.status === "needs_attention" ? "Delivery needs attention" : delivery.status === "processing" ? "Delivery attempt recorded" : "Awaiting delivery"}</p><p className="mt-1 text-xs text-slate-500">{delivery.createdAt && Number.isFinite(Date.parse(delivery.createdAt)) ? new Date(delivery.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "Booking alert"}</p></div>
              <button type="button" disabled={busy} className="min-h-12 rounded-xl border border-slate-300 px-4 text-sm font-bold text-[#233A59] disabled:opacity-50" onClick={() => void retryDelivery(delivery.appointmentId)}>Retry notification</button>
            </li>)}
          </ul>}
        </>}
      </div>}
      <p className="mt-4 flex gap-2 text-xs leading-5 text-slate-500"><ShieldCheck size={16} className="mt-0.5 shrink-0" />Use only your personal admin phone. Generic alerts can arrive while the app is closed or signed out; opening patient details always requires login. Disable alerts here before sharing the device. Names, phone numbers and medical information are not included in lock-screen alerts. Delivery depends on connectivity and Android notification and battery settings.</p>
    </section>
  );
}

export default function BookingAlertsPanel() {
  const { profile } = useStaff();
  return profile.role === "admin" ? <AdminBookingAlerts key={profile.uid} /> : null;
}
