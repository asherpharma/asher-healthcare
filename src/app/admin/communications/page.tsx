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
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

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
  const [query, setQuery] = useState("");
  const [outboxStatus, setOutboxStatus] = useState<"all" | OutboxItem["status"]>("all");
  const consentDialog = useRef<HTMLFormElement>(null);
  const consentCloseButton = useRef<HTMLButtonElement>(null);
  const busyRef = useRef("");

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

  const normalizedQuery = query.trim().toLocaleLowerCase("en-IN");
  const visibleCandidates = useMemo(() => desk?.candidates.filter((candidate) => {
    if (!normalizedQuery) return true;
    return [candidate.patientName, candidate.patientNumber, candidate.dueLabel]
      .some((value) => value.toLocaleLowerCase("en-IN").includes(normalizedQuery));
  }) ?? [], [desk, normalizedQuery]);
  const visibleOutbox = useMemo(() => desk?.outbox.filter((item) => {
    if (outboxStatus !== "all" && item.status !== outboxStatus) return false;
    if (!normalizedQuery) return true;
    return [item.patientName, item.maskedRecipient, statusLabel(item.status)]
      .some((value) => value.toLocaleLowerCase("en-IN").includes(normalizedQuery));
  }) ?? [], [desk, normalizedQuery, outboxStatus]);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    if (!consentForm) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    consentCloseButton.current?.focus();
    const containKeyboardFocus = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) {
        setConsentForm(null);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(consentDialog.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? []);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", containKeyboardFocus);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", containKeyboardFocus);
    };
  }, [consentForm]);

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
      <section className="overflow-hidden rounded-[24px] bg-[#233A59] p-5 text-white shadow-xl sm:rounded-[28px] sm:p-8">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#E9C98D]">Consent-aware communication centre</p>
            <h1 className="mt-2 break-words text-2xl font-bold leading-tight sm:text-3xl">Reminders &amp; recalls</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-white/75">
              Find due patients, confirm their permission, prepare a neutral reminder, then record the outcome. Nothing is sent automatically.
            </p>
            {desk ? <p className="mt-3 text-xs text-white/60">Desk updated {displayTimestamp(desk.generatedAt)}</p> : null}
          </div>
          <button type="button" onClick={() => void refresh()} disabled={loading} className={`${actionButton} w-full bg-white text-[#233A59] hover:bg-slate-100 sm:w-auto`}>
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

      <div role="tablist" aria-label="Reminder desk views" className="mt-5 grid grid-cols-2 gap-2 rounded-2xl bg-white p-2 ring-1 ring-slate-200">
        <button type="button" role="tab" aria-selected={view === "due"} onClick={() => setView("due")} className={`${actionButton} min-w-0 px-2 sm:px-4 ${view === "due" ? "bg-[#233A59] text-white" : "text-slate-600 hover:bg-slate-50"}`}><BellRing aria-hidden="true" size={17} /><span className="truncate">Due reminders</span></button>
        <button type="button" role="tab" aria-selected={view === "outbox"} onClick={() => setView("outbox")} className={`${actionButton} min-w-0 px-2 sm:px-4 ${view === "outbox" ? "bg-[#233A59] text-white" : "text-slate-600 hover:bg-slate-50"}`}><Clock3 aria-hidden="true" size={17} /><span className="truncate">Outbox &amp; history</span></button>
      </div>

      <details className="group mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <summary className="flex min-h-8 cursor-pointer list-none items-start gap-2 font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-800"><ShieldCheck className="mt-0.5 shrink-0" size={18} />Privacy &amp; consent rules <span className="ml-auto text-xs font-semibold group-open:hidden">Show</span><span className="ml-auto hidden text-xs font-semibold group-open:inline">Hide</span></summary>
        <p className="mt-2 pl-6 leading-6">Care-reminder and marketing permission are separate. Appointment privacy acceptance is never messaging permission. Messages contain no diagnosis, test, pregnancy or attachment details. If a patient asks to stop reminders, revoke permission here immediately; replies are not monitored automatically.</p>
      </details>

      {notice ? <p role="status" aria-live="polite" className="mt-5 break-words rounded-2xl bg-emerald-50 p-4 text-sm font-semibold leading-6 text-emerald-900 [overflow-wrap:anywhere]">{notice}</p> : null}
      {error ? <div role="alert" className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-900"><p className="break-words text-sm font-semibold leading-6 [overflow-wrap:anywhere]">{error}</p><button type="button" onClick={() => void refresh()} disabled={loading} className="mt-3 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-bold text-[#233A59] ring-1 ring-red-200 disabled:opacity-60"><RefreshCw aria-hidden="true" className={loading ? "animate-spin" : ""} size={16} />Try again</button></div> : null}
      {desk && (desk.excluded.unlinked > 0 || desk.excluded.archived > 0) ? (
        <p className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
          {desk.excluded.unlinked} unlinked and {desk.excluded.archived} archived/unavailable source records were excluded automatically.
        </p>
      ) : null}

      {loading && !desk ? (
        <div className="mt-10 flex items-center justify-center gap-3 py-16 text-slate-600"><LoaderCircle className="animate-spin" /> Loading secure reminder desk…</div>
      ) : null}

      {desk ? (
        <section aria-label="Find reminders" className="mt-5 grid gap-3 rounded-2xl bg-white p-3 ring-1 ring-slate-200 sm:grid-cols-[minmax(0,1fr)_auto] sm:p-4">
          <label className="relative block min-w-0">
            <span className="sr-only">Search by patient name, patient number or reminder</span>
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 text-slate-400" size={18} />
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search patients or reminders" className="min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-10 text-base outline-none focus:border-[#233A59] focus:ring-2 focus:ring-[#233A59]/10" />
            {query ? <button type="button" aria-label="Clear search" onClick={() => setQuery("")} className="absolute right-1 top-1 grid h-10 w-10 place-items-center rounded-lg text-slate-500"><X aria-hidden="true" size={17} /></button> : null}
          </label>
          {view === "outbox" ? (
            <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 sm:min-w-44">Status
              <select value={outboxStatus} onChange={(event) => setOutboxStatus(event.target.value as "all" | OutboxItem["status"])} className="mt-1 min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-base font-semibold normal-case tracking-normal text-slate-700 outline-none focus:border-[#233A59]">
                <option value="all">All statuses</option>
                <option value="ready">Ready to open</option>
                <option value="opened">App opened</option>
                <option value="delivered">Delivered</option>
                <option value="failed">Not reached</option>
                <option value="cancelled">Cancelled</option>
                <option value="expired">Expired</option>
              </select>
            </label>
          ) : null}
        </section>
      ) : null}

      {view === "due" && desk ? (
        <section className="mt-5 space-y-4" aria-label="Due reminders and recalls">
          {visibleCandidates.length === 0 ? (
            <div className="rounded-3xl bg-white p-8 text-center ring-1 ring-slate-200 sm:p-10"><CheckCircle2 className="mx-auto text-emerald-600" size={38} /><h2 className="mt-4 text-xl font-bold text-[#233A59]">{query ? "No matching reminders" : "No reminders are due"}</h2><p className="mt-2 text-sm text-slate-600">{query ? "Try another patient name or number." : "Today’s follow-ups and appointments for the next 48 hours will appear here."}</p>{query ? <button type="button" onClick={() => setQuery("")} className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-100 px-4 text-sm font-bold text-[#233A59]">Clear search</button> : null}</div>
          ) : visibleCandidates.map((candidate) => (
            <article key={candidate.key} className="min-w-0 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
              <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="break-words text-lg font-bold text-[#233A59] [overflow-wrap:anywhere]">{candidate.patientName}</h2>
                    <span className="max-w-full break-words rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600 [overflow-wrap:anywhere]">{candidate.patientNumber || "Patient chart"}</span>
                  </div>
                  <p className="mt-2 break-words text-sm font-semibold leading-6 text-slate-600 [overflow-wrap:anywhere]">{candidate.kind === "appointment_reminder" ? "Upcoming appointment" : "Follow-up recall"} · {candidate.dueLabel}</p>
                </div>
                <span className="inline-flex w-fit rounded-full bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-800">Care reminder</span>
              </div>
              <div className="mt-5 grid gap-3 lg:grid-cols-2">
                {(Object.keys(channelMeta) as Channel[]).map((channel) => {
                  const state = candidate.channels[channel];
                  const { Icon, label } = channelMeta[channel];
                  const actionKey = `${candidate.key}:${channel}`;
                  return (
                    <div key={channel} className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex min-w-0 flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <p className="inline-flex items-center gap-2 font-bold text-[#233A59]"><Icon size={18} /> {label}</p>
                        <span className={`max-w-full break-words rounded-full px-2.5 py-1 text-[11px] font-bold [overflow-wrap:anywhere] ${state.status === "granted" ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}>{state.status === "granted" ? `Approved · ${state.maskedRecipient}` : state.status === "revoked" ? "Revoked" : "Not recorded"}</span>
                      </div>
                      <div className="mt-4 grid gap-2 sm:flex sm:flex-wrap">
                        {state.status === "granted" ? (
                          <>
                            <button type="button" disabled={Boolean(busy)} onClick={() => void prepare(candidate, channel)} className={`${actionButton} w-full bg-[#233A59] text-white hover:bg-[#182b46] sm:w-auto`}><BellRing size={16} /> {busy === `prepare:${actionKey}` ? "Preparing…" : "Prepare reminder"}</button>
                            <button type="button" disabled={Boolean(busy)} onClick={() => void revokeConsent(candidate, channel)} className={`${actionButton} w-full border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 sm:w-auto`}>Stop channel</button>
                          </>
                        ) : (
                          <button type="button" disabled={Boolean(busy)} onClick={() => openConsent(candidate, channel)} className={`${actionButton} w-full bg-white text-[#233A59] ring-1 ring-slate-300 hover:bg-slate-100 sm:w-auto`}><ShieldCheck size={16} /> Record explicit permission</button>
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
            <div className="rounded-3xl bg-white p-8 text-center ring-1 ring-slate-200 sm:p-10"><Clock3 className="mx-auto text-slate-400" size={38} /><h2 className="mt-4 text-xl font-bold text-[#233A59]">{query || outboxStatus !== "all" ? "No matching outbox items" : "Outbox is empty"}</h2><p className="mt-2 text-sm text-slate-600">{query || outboxStatus !== "all" ? "Clear the search or status filter to see other items." : "Prepare a consent-approved reminder from the Due reminders tab."}</p>{query || outboxStatus !== "all" ? <button type="button" onClick={() => { setQuery(""); setOutboxStatus("all"); }} className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-100 px-4 text-sm font-bold text-[#233A59]">Clear filters</button> : null}</div>
          ) : visibleOutbox.map((item) => {
            const Icon = channelMeta[item.channel]?.Icon || BellRing;
            const actionable = ["ready", "opened", "failed"].includes(item.status);
            return (
              <article key={item.id} className="min-w-0 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
                <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
                  <div className="min-w-0">
                    <h2 className="flex min-w-0 items-start gap-2 break-words text-lg font-bold text-[#233A59] [overflow-wrap:anywhere]"><Icon className="mt-0.5 shrink-0" size={19} /> {item.patientName}</h2>
                    <p className="mt-2 break-words text-sm leading-6 text-slate-600 [overflow-wrap:anywhere]">{channelMeta[item.channel]?.label || item.channel} · {item.maskedRecipient} · prepared {displayTimestamp(item.createdAt)}</p>
                  </div>
                  <span className={`w-fit rounded-full px-3 py-1.5 text-xs font-bold ring-1 ${statusStyle(item.status)}`}>{statusLabel(item.status)}</span>
                </div>
                {actionable ? (
                  <div className="mt-5 grid gap-2 sm:flex sm:flex-wrap">
                    <button type="button" disabled={Boolean(busy)} onClick={() => void openManual(item)} className={`${actionButton} w-full bg-[#233A59] text-white hover:bg-[#182b46] sm:w-auto`}><ExternalLink size={16} /> {busy === `open:${item.id}` ? "Opening…" : `Open ${channelMeta[item.channel]?.label || "message"}`}</button>
                    {item.status === "opened" ? <button type="button" disabled={Boolean(busy)} onClick={() => void markDelivered(item)} className={`${actionButton} w-full bg-emerald-700 text-white hover:bg-emerald-800 sm:w-auto`}><CheckCircle2 size={16} /> Mark delivered</button> : null}
                    <button type="button" disabled={Boolean(busy)} onClick={() => void markFailed(item)} className={`${actionButton} w-full border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 sm:w-auto`}><AlertTriangle size={16} /> Not reached</button>
                  </div>
                ) : null}
                {item.status === "opened" ? <p className="mt-4 rounded-xl bg-blue-50 p-3 text-xs font-semibold text-blue-900">Opening the messaging app is not proof of delivery. Mark delivered only after the message is actually sent.</p> : null}
              </article>
            );
          })}
        </section>
      ) : null}

      {consentForm ? (
        <div className="fixed inset-0 z-[100] grid place-items-end bg-slate-950/60 p-0 backdrop-blur-sm sm:place-items-center sm:p-5" role="dialog" aria-modal="true" aria-labelledby="consent-title" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setConsentForm(null); }}>
          <form ref={consentDialog} onSubmit={(event) => void submitConsent(event)} className="max-h-[94dvh] w-full overflow-y-auto rounded-t-[30px] bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl sm:max-w-xl sm:rounded-3xl sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0"><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#A8864A]">Care reminders only</p><h2 id="consent-title" className="mt-1 break-words text-xl font-bold leading-tight text-[#233A59] [overflow-wrap:anywhere]">Record {channelMeta[consentForm.channel].label} permission</h2><p className="mt-2 break-words text-sm text-slate-600 [overflow-wrap:anywhere]">{consentForm.candidate.patientName}</p></div>
              <button ref={consentCloseButton} type="button" disabled={Boolean(busy)} onClick={() => setConsentForm(null)} aria-label="Close permission form" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-600 disabled:opacity-50"><X size={18} /></button>
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
            <div className="sticky bottom-0 -mx-5 mt-6 flex flex-col-reverse gap-2 border-t border-slate-100 bg-white/95 px-5 pb-1 pt-4 backdrop-blur sm:static sm:mx-0 sm:flex-row sm:justify-end sm:border-0 sm:bg-transparent sm:p-0">
              <button type="button" disabled={Boolean(busy)} onClick={() => setConsentForm(null)} className={`${actionButton} w-full border border-slate-200 bg-white text-slate-700 sm:w-auto`}>Cancel</button>
              <button type="submit" disabled={!confirmed || Boolean(busy)} className={`${actionButton} w-full bg-[#233A59] text-white sm:w-auto`}><ShieldCheck size={17} /> {busy.startsWith("consent:") ? "Saving…" : "Record permission"}</button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
