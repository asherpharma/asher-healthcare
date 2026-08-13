"use client";

import { useStaff } from "@/components/admin/StaffGuard";
import { firebaseAuth } from "@/firebase/config";
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  Clock3,
  ExternalLink,
  LoaderCircle,
  MessageCircle,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

type Channel = "whatsapp";
type ConsentState = {
  status: "granted" | "revoked" | "not-recorded";
  maskedRecipient?: string;
  suggestedRecipient?: string;
};
type DueReminder = {
  key: string;
  sourceType: "appointment" | "task";
  sourceId: string;
  patientId: string;
  patientNumber: string;
  patientName: string;
  dueAt: string;
  kind: "appointment_reminder" | "follow_up_recall";
  dueLabel: string;
  patientVerbalEligible: boolean;
  channels: Record<Channel, ConsentState>;
};
type OutboxItem = {
  id: string;
  patientId: string;
  patientName: string;
  sourceType: string;
  purpose: string;
  channel: Channel;
  maskedRecipient: string;
  scheduledFor: string;
  status: "ready" | "opened" | "delivered" | "failed" | "cancelled" | "expired";
  deliveryMode: "manual_fallback";
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  lastOpenedAt: string;
  deliveredAt: string;
  failureCode: string;
};
type DeskData = {
  generatedAt: string;
  providerMode: "manual_fallback";
  candidates: DueReminder[];
  outbox: OutboxItem[];
  excluded: { unlinked: number; archived: number };
  summary: { due: number; consentReady: number; readyToOpen: number; delivered: number };
};

type ConsentForm = {
  candidate: DueReminder;
  channel: Channel;
};

const channelMeta = {
  whatsapp: { label: "WhatsApp", Icon: MessageCircle },
} satisfies Record<Channel, { label: string; Icon: typeof MessageCircle }>;

const actionButton = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50";

function displayTimestamp(value: string) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(date);
}

function statusLabel(status: OutboxItem["status"]) {
  return ({
    ready: "Ready to open",
    opened: "Messaging app opened",
    delivered: "Marked delivered",
    failed: "Delivery failed",
    cancelled: "Cancelled",
    expired: "Expired",
  })[status];
}

function statusStyle(status: OutboxItem["status"]) {
  if (status === "delivered") return "bg-emerald-50 text-emerald-800 ring-emerald-200";
  if (status === "opened") return "bg-blue-50 text-blue-800 ring-blue-200";
  if (status === "ready") return "bg-amber-50 text-amber-900 ring-amber-200";
  return "bg-slate-100 text-slate-700 ring-slate-200";
}

export default function CommunicationsPage() {
  const { profile } = useStaff();
  const [desk, setDesk] = useState<DeskData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [consentForm, setConsentForm] = useState<ConsentForm | null>(null);
  const [recipient, setRecipient] = useState("");
  const [method, setMethod] = useState("patient-verbal");
  const [proxyName, setProxyName] = useState("");
  const [proxyRelationship, setProxyRelationship] = useState("");
  const [consentReference, setConsentReference] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [view, setView] = useState<"due" | "outbox">("due");

  const request = useCallback(async (body?: Record<string, unknown>) => {
    const user = firebaseAuth?.currentUser;
    if (!user) throw new Error("Your staff session expired. Sign in again.");
    const idToken = await user.getIdToken();
    const response = await fetch("/api/communications/desk", {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${idToken}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "The reminder desk could not complete this request.");
    return result;
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setDesk(await request() as DeskData);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "The reminder desk could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const result = await request() as DeskData;
        if (active) setDesk(result);
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "The reminder desk could not be loaded.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [request]);

  const visibleOutbox = useMemo(
    () => desk?.outbox.filter((item) => view === "outbox" || item.status === "ready") ?? [],
    [desk, view],
  );

  if (!profile || !["admin", "reception"].includes(profile.role)) {
    return (
      <section className="rounded-3xl border border-red-200 bg-red-50 p-6 text-red-900">
        <h1 className="text-xl font-bold">Reminder desk unavailable</h1>
        <p className="mt-2 text-sm">Only administrators and reception staff can manage patient communications.</p>
      </section>
    );
  }

  async function runAction(key: string, body: Record<string, unknown>, successMessage: string) {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      await request(body);
      setNotice(successMessage);
      await refresh();
      return true;
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "The reminder could not be updated.");
      return false;
    } finally {
      setBusy("");
    }
  }

  function openConsent(candidate: DueReminder, channel: Channel) {
    setConsentForm({ candidate, channel });
    setRecipient(candidate.channels[channel].suggestedRecipient || "");
    setMethod(candidate.patientVerbalEligible ? "patient-verbal" : "guardian-verbal");
    setProxyName("");
    setProxyRelationship("");
    setConsentReference("");
    setConfirmed(false);
  }

  async function submitConsent(event: FormEvent) {
    event.preventDefault();
    if (!consentForm || !confirmed) return;
    const success = await runAction(
      `consent:${consentForm.candidate.key}:${consentForm.channel}`,
      {
        action: "grant_consent",
        patientId: consentForm.candidate.patientId,
        purpose: "care",
        channel: consentForm.channel,
        recipient,
        method,
        proxyName,
        proxyRelationship,
        consentReference,
      },
      `${channelMeta[consentForm.channel].label} care-reminder permission recorded.`,
    );
    if (success) setConsentForm(null);
  }

  async function revokeConsent(candidate: DueReminder, channel: Channel) {
    const approved = window.confirm(
      `Stop ${channelMeta[channel].label} care reminders for ${candidate.patientName}? Prepared items on this channel will no longer open.`,
    );
    if (!approved) return;
    await runAction(
      `revoke:${candidate.key}:${channel}`,
      { action: "revoke_consent", patientId: candidate.patientId, channel, reason: "patient-request" },
      `${channelMeta[channel].label} permission revoked.`,
    );
  }

  async function prepare(candidate: DueReminder, channel: Channel) {
    const success = await runAction(
      `prepare:${candidate.key}:${channel}`,
      {
        action: "prepare",
        patientId: candidate.patientId,
        sourceType: candidate.sourceType,
        sourceId: candidate.sourceId,
        channel,
      },
      "Neutral reminder prepared in the outbox. Nothing has been sent yet.",
    );
    if (success) setView("outbox");
  }

  async function openManual(item: OutboxItem) {
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    setBusy(`open:${item.id}`);
    setError("");
    setNotice("");
    try {
      const result = await request({ action: "open_manual", outboxId: item.id }) as {
        fallbackUrl?: string;
        notice?: string;
      };
      const fallbackUrl = String(result.fallbackUrl || "");
      if (!fallbackUrl.startsWith("https://wa.me/") && !fallbackUrl.startsWith("mailto:")) {
        throw new Error("The secure messaging link could not be prepared.");
      }
      if (popup) popup.location.href = fallbackUrl;
      else window.location.assign(fallbackUrl);
      setNotice(result.notice || "Messaging app opened. Confirm delivery separately.");
      await refresh();
    } catch (openError) {
      popup?.close();
      setError(openError instanceof Error ? openError.message : "The messaging app could not be opened.");
    } finally {
      setBusy("");
    }
  }

  async function markDelivered(item: OutboxItem) {
    await runAction(
      `deliver:${item.id}`,
      { action: "mark_delivered", outboxId: item.id },
      "Delivery was recorded in the immutable communication log.",
    );
  }

  async function markFailed(item: OutboxItem) {
    await runAction(
      `failed:${item.id}`,
      { action: "mark_failed", outboxId: item.id, failureCode: "not_reached" },
      "The unsuccessful attempt was recorded. Permission remains unchanged.",
    );
  }

  return (
    <div className="min-w-0">
      <section className="overflow-hidden rounded-[28px] bg-[#233A59] p-6 text-white shadow-xl sm:p-8">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#E9C98D]">Consent-aware communication centre</p>
            <h1 className="mt-2 text-3xl font-bold">Reminders &amp; recalls</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-white/75">
              Review due care reminders, record channel-specific permission, prepare a neutral message, and log the outcome. No message is sent automatically while a provider is not configured.
            </p>
          </div>
          <button type="button" onClick={() => void refresh()} disabled={loading} className={`${actionButton} bg-white text-[#233A59] hover:bg-slate-100`}>
            <RefreshCw size={17} className={loading ? "animate-spin" : ""} /> Refresh desk
          </button>
        </div>
      </section>

      <section className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Due now", desk?.summary.due ?? 0],
          ["Consent ready", desk?.summary.consentReady ?? 0],
          ["Outbox ready", desk?.summary.readyToOpen ?? 0],
          ["Delivered log", desk?.summary.delivered ?? 0],
        ].map(([label, value]) => (
          <article key={label} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <p className="text-2xl font-black text-[#233A59]">{value}</p>
            <p className="mt-1 text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
          </article>
        ))}
      </section>

      <div className="mt-5 flex flex-wrap gap-2 rounded-2xl bg-white p-2 ring-1 ring-slate-200">
        <button type="button" onClick={() => setView("due")} className={`${actionButton} ${view === "due" ? "bg-[#233A59] text-white" : "text-slate-600 hover:bg-slate-50"}`}><BellRing size={17} /> Due reminders</button>
        <button type="button" onClick={() => setView("outbox")} className={`${actionButton} ${view === "outbox" ? "bg-[#233A59] text-white" : "text-slate-600 hover:bg-slate-50"}`}><Clock3 size={17} /> Outbox &amp; history</button>
      </div>

      <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <p className="flex items-start gap-2 font-bold"><ShieldCheck className="mt-0.5 shrink-0" size={18} /> Care reminders and marketing permission are separate.</p>
        <p className="mt-1 pl-6 leading-6">This desk records care-reminder permission only. Appointment privacy acceptance is never treated as messaging permission. Messages contain no diagnosis, test, pregnancy, or attachment details. If a patient asks to stop reminders by reply or phone, staff must open this desk and revoke permission immediately; replies are not monitored automatically.</p>
      </div>

      {notice ? <p className="mt-5 rounded-2xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-900">{notice}</p> : null}
      {error ? <p className="mt-5 rounded-2xl bg-red-50 p-4 text-sm font-semibold text-red-800">{error}</p> : null}
      {desk && (desk.excluded.unlinked > 0 || desk.excluded.archived > 0) ? (
        <p className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
          {desk.excluded.unlinked} unlinked and {desk.excluded.archived} archived/unavailable source records were excluded automatically.
        </p>
      ) : null}

      {loading && !desk ? (
        <div className="mt-10 flex items-center justify-center gap-3 py-16 text-slate-600"><LoaderCircle className="animate-spin" /> Loading secure reminder desk…</div>
      ) : null}

      {view === "due" && desk ? (
        <section className="mt-5 space-y-4" aria-label="Due reminders and recalls">
          {desk.candidates.length === 0 ? (
            <div className="rounded-3xl bg-white p-10 text-center ring-1 ring-slate-200"><CheckCircle2 className="mx-auto text-emerald-600" size={38} /><h2 className="mt-4 text-xl font-bold text-[#233A59]">No reminders are due</h2><p className="mt-2 text-sm text-slate-600">Today’s follow-ups and appointments for the next 48 hours will appear here.</p></div>
          ) : desk.candidates.map((candidate) => (
            <article key={candidate.key} className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
              <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-bold text-[#233A59]">{candidate.patientName}</h2>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">{candidate.patientNumber || "Patient chart"}</span>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-slate-600">{candidate.kind === "appointment_reminder" ? "Upcoming appointment" : "Follow-up recall"} · {candidate.dueLabel}</p>
                </div>
                <span className="inline-flex w-fit rounded-full bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-800">Care reminder</span>
              </div>
              <div className="mt-5 grid gap-3 lg:grid-cols-2">
                {(Object.keys(channelMeta) as Channel[]).map((channel) => {
                  const state = candidate.channels[channel];
                  const { Icon, label } = channelMeta[channel];
                  const actionKey = `${candidate.key}:${channel}`;
                  return (
                    <div key={channel} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="inline-flex items-center gap-2 font-bold text-[#233A59]"><Icon size={18} /> {label}</p>
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${state.status === "granted" ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}>{state.status === "granted" ? `Approved · ${state.maskedRecipient}` : state.status === "revoked" ? "Revoked" : "Not recorded"}</span>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {state.status === "granted" ? (
                          <>
                            <button type="button" disabled={Boolean(busy)} onClick={() => void prepare(candidate, channel)} className={`${actionButton} bg-[#233A59] text-white hover:bg-[#182b46]`}><BellRing size={16} /> {busy === `prepare:${actionKey}` ? "Preparing…" : "Prepare reminder"}</button>
                            <button type="button" disabled={Boolean(busy)} onClick={() => void revokeConsent(candidate, channel)} className={`${actionButton} border border-slate-200 bg-white text-slate-700 hover:bg-slate-100`}>Stop channel</button>
                          </>
                        ) : (
                          <button type="button" disabled={Boolean(busy)} onClick={() => openConsent(candidate, channel)} className={`${actionButton} bg-white text-[#233A59] ring-1 ring-slate-300 hover:bg-slate-100`}><ShieldCheck size={16} /> Record explicit permission</button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </article>
          ))}
        </section>
      ) : null}

      {view === "outbox" && desk ? (
        <section className="mt-5 space-y-4" aria-label="Communication outbox">
          {visibleOutbox.length === 0 ? (
            <div className="rounded-3xl bg-white p-10 text-center ring-1 ring-slate-200"><Clock3 className="mx-auto text-slate-400" size={38} /><h2 className="mt-4 text-xl font-bold text-[#233A59]">Outbox is empty</h2><p className="mt-2 text-sm text-slate-600">Prepare a consent-approved reminder from the Due reminders tab.</p></div>
          ) : visibleOutbox.map((item) => {
            const Icon = channelMeta[item.channel]?.Icon || BellRing;
            const actionable = ["ready", "opened", "failed"].includes(item.status);
            return (
              <article key={item.id} className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
                <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
                  <div>
                    <h2 className="flex items-center gap-2 text-lg font-bold text-[#233A59]"><Icon size={19} /> {item.patientName}</h2>
                    <p className="mt-2 text-sm text-slate-600">{channelMeta[item.channel]?.label || item.channel} · {item.maskedRecipient} · prepared {displayTimestamp(item.createdAt)}</p>
                  </div>
                  <span className={`w-fit rounded-full px-3 py-1.5 text-xs font-bold ring-1 ${statusStyle(item.status)}`}>{statusLabel(item.status)}</span>
                </div>
                {actionable ? (
                  <div className="mt-5 flex flex-wrap gap-2">
                    <button type="button" disabled={Boolean(busy)} onClick={() => void openManual(item)} className={`${actionButton} bg-[#233A59] text-white hover:bg-[#182b46]`}><ExternalLink size={16} /> {busy === `open:${item.id}` ? "Opening…" : `Open ${channelMeta[item.channel]?.label || "message"}`}</button>
                    {item.status === "opened" ? <button type="button" disabled={Boolean(busy)} onClick={() => void markDelivered(item)} className={`${actionButton} bg-emerald-700 text-white hover:bg-emerald-800`}><CheckCircle2 size={16} /> Mark delivered</button> : null}
                    <button type="button" disabled={Boolean(busy)} onClick={() => void markFailed(item)} className={`${actionButton} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}><AlertTriangle size={16} /> Not reached</button>
                  </div>
                ) : null}
                {item.status === "opened" ? <p className="mt-4 rounded-xl bg-blue-50 p-3 text-xs font-semibold text-blue-900">Opening the messaging app is not proof of delivery. Mark delivered only after the message is actually sent.</p> : null}
              </article>
            );
          })}
        </section>
      ) : null}

      {consentForm ? (
        <div className="fixed inset-0 z-[100] grid place-items-end bg-slate-950/60 p-0 backdrop-blur-sm sm:place-items-center sm:p-5" role="dialog" aria-modal="true" aria-labelledby="consent-title">
          <form onSubmit={(event) => void submitConsent(event)} className="max-h-[92dvh] w-full overflow-y-auto rounded-t-[30px] bg-white p-6 shadow-2xl sm:max-w-xl sm:rounded-3xl">
            <div className="flex items-start justify-between gap-4">
              <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#A8864A]">Care reminders only</p><h2 id="consent-title" className="mt-1 text-xl font-bold text-[#233A59]">Record {channelMeta[consentForm.channel].label} permission</h2><p className="mt-2 text-sm text-slate-600">{consentForm.candidate.patientName}</p></div>
              <button type="button" onClick={() => setConsentForm(null)} aria-label="Close permission form" className="grid h-11 w-11 place-items-center rounded-full bg-slate-100 text-slate-600"><X size={18} /></button>
            </div>
            <label className="mt-5 block text-sm font-bold text-slate-700">Approved recipient
              <input required type="tel" value={recipient} onChange={(event) => setRecipient(event.target.value)} className="mt-2 h-12 w-full rounded-xl border border-slate-300 px-3 outline-none focus:border-[#233A59] focus:ring-2 focus:ring-[#233A59]/10" />
            </label>
            <label className="mt-4 block text-sm font-bold text-slate-700">How permission was received
              <select value={method} onChange={(event) => {
                const nextMethod = event.target.value;
                setMethod(nextMethod);
                if (nextMethod !== "guardian-verbal") {
                  setProxyName("");
                  setProxyRelationship("");
                }
                if (nextMethod !== "written-form") setConsentReference("");
              }} className="mt-2 h-12 w-full rounded-xl border border-slate-300 bg-white px-3 outline-none focus:border-[#233A59]">
                <option value="patient-verbal" disabled={!consentForm.candidate.patientVerbalEligible}>Patient verbally agreed (verified adult only)</option>
                <option value="guardian-verbal">Parent/guardian/authorized representative verbally agreed</option>
                <option value="written-form">Written clinic form</option>
              </select>
            </label>
            {!consentForm.candidate.patientVerbalEligible ? (
              <p className="mt-2 rounded-xl bg-blue-50 px-3 py-2 text-xs font-semibold leading-5 text-blue-900">Patient-verbal permission is unavailable because the patient is a minor or the date of birth is not verified. Record a named guardian/authorized representative or a clinic-held written form.</p>
            ) : null}
            {method === "guardian-verbal" ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="block text-sm font-bold text-slate-700">Representative name
                  <input required value={proxyName} onChange={(event) => setProxyName(event.target.value)} className="mt-2 h-12 w-full rounded-xl border border-slate-300 px-3 outline-none focus:border-[#233A59]" />
                </label>
                <label className="block text-sm font-bold text-slate-700">Relationship
                  <input required value={proxyRelationship} onChange={(event) => setProxyRelationship(event.target.value)} placeholder="Parent, spouse, guardian…" className="mt-2 h-12 w-full rounded-xl border border-slate-300 px-3 outline-none focus:border-[#233A59]" />
                </label>
                <p className="text-xs leading-5 text-slate-500 sm:col-span-2">For an adult patient, use this method only when the representative is legally authorized or the patient has documented their authority.</p>
              </div>
            ) : null}
            {method === "written-form" ? (
              <label className="mt-4 block text-sm font-bold text-slate-700">Clinic-held consent form reference
                <input required minLength={3} maxLength={80} pattern="[A-Za-z0-9][A-Za-z0-9._/\-]{2,79}" value={consentReference} onChange={(event) => setConsentReference(event.target.value)} placeholder="CONSENT-2026-0001" className="mt-2 h-12 w-full rounded-xl border border-slate-300 px-3 outline-none focus:border-[#233A59]" />
                <span className="mt-2 block text-xs font-normal leading-5 text-slate-500">Enter only the clinic filing reference—never a patient name, diagnosis, or other medical detail.</span>
              </label>
            ) : null}
            <label className="mt-5 flex items-start gap-3 rounded-2xl bg-amber-50 p-4 text-sm leading-6 text-amber-950">
              <input required type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1 h-5 w-5 shrink-0" />
              <span>I confirm the patient, authorized representative, or referenced written form explicitly permits care reminders at this recipient. This is not marketing permission.</span>
            </label>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setConsentForm(null)} className={`${actionButton} border border-slate-200 bg-white text-slate-700`}>Cancel</button>
              <button type="submit" disabled={!confirmed || Boolean(busy)} className={`${actionButton} bg-[#233A59] text-white`}><ShieldCheck size={17} /> {busy.startsWith("consent:") ? "Saving…" : "Record permission"}</button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
