"use client";

import PatientPortalPwa from "@/components/portal/PatientPortalPwa";
import { patientFirebaseAuth } from "@/firebase/config";
import type { PrescriptionPdfRecord } from "@/lib/prescription-pdf";
import { PATIENT_PORTAL_IDLE_TIMEOUT_MS, patientPortalActivityTimestamp } from "@/lib/patient-portal-session";
import type { ReceiptInvoice } from "@/lib/receipt-pdf";
import { onAuthStateChanged } from "firebase/auth";
import {
  CalendarDays,
  CircleHelp,
  Download,
  FileHeart,
  FileText,
  Files,
  HeartHandshake,
  Home,
  LoaderCircle,
  LockKeyhole,
  Printer,
  ReceiptIndianRupee,
  RefreshCw,
  ShieldCheck,
  Stethoscope,
  UsersRound,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Appointment = { id: string; doctorName: string; preferredDate: string; preferredTime: string; status: string; queueToken?: number };
type PrescriptionSummary = { id: string; prescribedDate: string; doctorName: string };
type Report = { id: string; category: string; reportDate: string; contentType: string; size: number };
type InvoiceSummary = { id: string; invoiceNumber: string; total: number; amountPaid: number; balance: number; paymentStatus: string; createdAt?: string };
type Patient = {
  id: string;
  patientNumber: string;
  fullName: string;
  phone: string;
  dateOfBirth: string;
  gender: string;
  doctorName: string;
  profileAllowed: boolean;
  archived: boolean;
};
type FamilyEntry = {
  grant: { id: string; relationship: string; scopes: string[]; expiresAt: string; reviewAt: string };
  patient: Patient;
  appointments: Appointment[];
  prescriptions: PrescriptionSummary[];
  reports: Report[];
  invoices: InvoiceSummary[];
};
type Dashboard = { account: { displayName: string }; family: FamilyEntry[]; generatedAt: string };

function friendlyDate(value: string) {
  if (!value) return "Date not recorded";
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function statusLabel(value: string) {
  return value ? value.replaceAll("_", " ").replace(/\b\w/gu, (letter) => letter.toUpperCase()) : "Recorded";
}

function friendlyTimestamp(value: string) {
  if (!value) return "Just now";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "Just now"
    : parsed.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

function reportExtension(contentType: string) {
  const normalized = contentType.split(";")[0].trim().toLowerCase();
  return normalized === "application/pdf" ? "pdf"
    : normalized === "image/png" ? "png"
      : normalized === "image/webp" ? "webp"
        : normalized === "image/jpeg" ? "jpg" : "bin";
}

export default function PatientPortalDashboard() {
  const router = useRouter();
  const idleTimer = useRef<number | null>(null);
  const lastActivityAt = useRef(0);
  const dashboardRequestEpoch = useRef(0);
  const protectedActionEpoch = useRef(0);
  const protectedActionAbort = useRef<AbortController | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [sessionHydrated, setSessionHydrated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [activeAction, setActiveAction] = useState("");

  useEffect(() => () => {
    dashboardRequestEpoch.current += 1;
    protectedActionEpoch.current += 1;
    protectedActionAbort.current?.abort();
    protectedActionAbort.current = null;
  }, []);

  const closeSession = useCallback(async (reason = "") => {
    dashboardRequestEpoch.current += 1;
    protectedActionEpoch.current += 1;
    protectedActionAbort.current?.abort();
    protectedActionAbort.current = null;
    setDashboard(null);
    setSelectedPatientId("");
    setSessionHydrated(false);
    setActiveAction("");
    window.sessionStorage.removeItem("asher.portal.lastActivityAt");
    if (patientFirebaseAuth) await patientFirebaseAuth.signOut().catch(() => {});
    router.replace(reason ? `/portal/login?reason=${encodeURIComponent(reason)}` : "/portal/login");
  }, [router]);

  const loadDashboard = useCallback(async () => {
    const requestEpoch = ++dashboardRequestEpoch.current;
    const user = patientFirebaseAuth?.currentUser;
    if (!user) return;
    const persistedActivity = patientPortalActivityTimestamp(
      window.sessionStorage.getItem("asher.portal.lastActivityAt"),
    );
    if (persistedActivity === null) {
      await closeSession("inactivity");
      return;
    }
    lastActivityAt.current = persistedActivity;
    setSessionHydrated(true);
    setLoading(true);
    setMessage("");
    try {
      const idToken = await user.getIdToken();
      const response = await fetch("/api/patient/portal", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ action: "dashboard" }),
      });
      const result = await response.json().catch(() => ({}));
      if (requestEpoch !== dashboardRequestEpoch.current) return;
      if (!response.ok) {
        if ([401, 403, 404].includes(response.status)) {
          await closeSession("access_changed");
          return;
        }
        throw new Error(result.error || "Your family records could not be loaded.");
      }
      setDashboard(result as Dashboard);
      setSelectedPatientId((current) => (result as Dashboard).family.some((entry) => entry.patient.id === current)
        ? current
        : (result as Dashboard).family[0]?.patient.id || "");
    } catch (error) {
      if (requestEpoch !== dashboardRequestEpoch.current) return;
      setMessage(error instanceof Error ? error.message : "Your family records could not be loaded.");
    } finally {
      if (requestEpoch === dashboardRequestEpoch.current) setLoading(false);
    }
  }, [closeSession]);

  useEffect(() => {
    const auth = patientFirebaseAuth;
    if (!auth) return;
    return onAuthStateChanged(auth, (user) => {
      if (!user) {
        dashboardRequestEpoch.current += 1;
        setDashboard(null);
        setSelectedPatientId("");
        setSessionHydrated(false);
        setLoading(false);
        router.replace("/portal/login");
        return;
      }
      void loadDashboard();
    });
  }, [loadDashboard, router]);

  useEffect(() => {
    const auth = patientFirebaseAuth;
    if (!auth || !sessionHydrated) return;
    const scheduleIdleLock = () => {
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
      const remaining = PATIENT_PORTAL_IDLE_TIMEOUT_MS - (Date.now() - lastActivityAt.current);
      if (remaining <= 0) { void closeSession("inactivity"); return; }
      idleTimer.current = window.setTimeout(() => void closeSession("inactivity"), remaining);
    };
    const recordActivity = () => {
      lastActivityAt.current = Date.now();
      window.sessionStorage.setItem("asher.portal.lastActivityAt", String(lastActivityAt.current));
      scheduleIdleLock();
    };
    const revalidate = () => {
      if (Date.now() - lastActivityAt.current >= PATIENT_PORTAL_IDLE_TIMEOUT_MS) {
        void closeSession("inactivity");
        return;
      }
      scheduleIdleLock();
      if (document.visibilityState === "visible" && auth.currentUser) void loadDashboard();
    };
    const activityEvents: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "touchstart"];
    activityEvents.forEach((eventName) => window.addEventListener(eventName, recordActivity, { passive: true }));
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", revalidate);
    scheduleIdleLock();
    return () => {
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, recordActivity));
      window.removeEventListener("focus", revalidate);
      document.removeEventListener("visibilitychange", revalidate);
    };
  }, [closeSession, loadDashboard, sessionHydrated]);

  const selected = useMemo(
    () => dashboard?.family.find((entry) => entry.patient.id === selectedPatientId) || dashboard?.family[0] || null,
    [dashboard, selectedPatientId],
  );

  async function secureDocument(
    documentType: "prescription" | "receipt",
    documentId: string,
    action: "print" | "download",
  ) {
    const currentUser = patientFirebaseAuth?.currentUser;
    if (!currentUser || !selected) return;
    protectedActionAbort.current?.abort();
    const controller = new AbortController();
    protectedActionAbort.current = controller;
    const requestEpoch = ++protectedActionEpoch.current;
    const patient = selected.patient;
    const sessionUid = currentUser.uid;
    const canPresent = () => requestEpoch === protectedActionEpoch.current
      && !controller.signal.aborted
      && patientFirebaseAuth?.currentUser?.uid === sessionUid;
    const popup = action === "print" ? window.open("", "_blank") : null;
    if (popup) {
      popup.opener = null;
      popup.document.body.textContent = "Preparing secure document…";
    }
    setActiveAction(`${documentType}:${documentId}:${action}`);
    setMessage("");
    try {
      const idToken = await currentUser.getIdToken();
      if (!canPresent()) { popup?.close(); return; }
      const response = await fetch("/api/patient/document", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ patientId: patient.id, documentId, documentType, action }),
        signal: controller.signal,
      });
      const result = await response.json().catch(() => ({}));
      if (!canPresent()) { popup?.close(); return; }
      if (!response.ok) {
        popup?.close();
        if ([401, 403, 404].includes(response.status)) await closeSession("access_changed");
        throw new Error(result.error || "This patient document is not available.");
      }
      if (documentType === "prescription") {
        const prescription = result.document as PrescriptionPdfRecord;
        const { downloadPrescriptionPdf, printPrescriptionPdf } = await import("@/lib/prescription-pdf");
        if (!canPresent()) { popup?.close(); return; }
        if (action === "print") await printPrescriptionPdf(patient, prescription, popup || undefined, canPresent);
        else await downloadPrescriptionPdf(patient, prescription, "prescription.pdf", canPresent);
      } else {
        const data = result.document as Omit<ReceiptInvoice, "patientName" | "patientPhone" | "paymentReference" | "notes" | "createdAt"> & { createdAt?: string };
        const invoice: ReceiptInvoice = {
          ...data,
          patientName: patient.fullName,
          patientPhone: patient.phone,
          paymentReference: "",
          notes: "",
          createdAt: data.createdAt ? { toDate: () => new Date(data.createdAt as string) } : undefined,
        };
        const { downloadReceiptPdf, printReceiptPdf } = await import("@/lib/receipt-pdf");
        if (!canPresent()) { popup?.close(); return; }
        if (action === "print") await printReceiptPdf(invoice, popup || undefined, canPresent);
        else await downloadReceiptPdf(invoice, "payment-receipt.pdf", canPresent);
      }
    } catch (error) {
      popup?.close();
      if (!canPresent() || (error instanceof DOMException && error.name === "AbortError")) return;
      setMessage(error instanceof Error ? error.message : "This patient document is not available.");
    } finally {
      if (requestEpoch === protectedActionEpoch.current) {
        protectedActionAbort.current = null;
        setActiveAction("");
      }
    }
  }

  async function openReport(report: Report, action: "print" | "download") {
    const currentUser = patientFirebaseAuth?.currentUser;
    if (!currentUser || !selected) return;
    protectedActionAbort.current?.abort();
    const controller = new AbortController();
    protectedActionAbort.current = controller;
    const requestEpoch = ++protectedActionEpoch.current;
    const patient = selected.patient;
    const sessionUid = currentUser.uid;
    const canPresent = () => requestEpoch === protectedActionEpoch.current
      && !controller.signal.aborted
      && patientFirebaseAuth?.currentUser?.uid === sessionUid;
    const popup = action === "print" ? window.open("", "_blank") : null;
    if (popup) { popup.opener = null; popup.document.body.textContent = "Preparing secure report…"; }
    setActiveAction(`report:${report.id}:${action}`);
    setMessage("");
    try {
      const idToken = await currentUser.getIdToken();
      if (!canPresent()) { popup?.close(); return; }
      const response = await fetch("/api/patient/report", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ patientId: patient.id, reportId: report.id, action }),
        signal: controller.signal,
      });
      if (!canPresent()) { popup?.close(); return; }
      if (!response.ok) {
        popup?.close();
        if ([401, 403, 404].includes(response.status)) await closeSession("access_changed");
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || "This report could not be opened.");
      }
      const contentType = response.headers.get("Content-Type") || report.contentType;
      const reportBlob = await response.blob();
      if (!canPresent()) { popup?.close(); return; }
      const blobUrl = URL.createObjectURL(reportBlob);
      if (!canPresent()) { URL.revokeObjectURL(blobUrl); popup?.close(); return; }
      if (popup) popup.location.replace(blobUrl);
      else {
        const anchor = document.createElement("a");
        anchor.href = blobUrl;
        anchor.download = `medical-report.${reportExtension(contentType)}`;
        anchor.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 5 * 60_000);
    } catch (error) {
      popup?.close();
      if (!canPresent() || (error instanceof DOMException && error.name === "AbortError")) return;
      setMessage(error instanceof Error ? error.message : "This report could not be opened.");
    } finally {
      if (requestEpoch === protectedActionEpoch.current) {
        protectedActionAbort.current = null;
        setActiveAction("");
      }
    }
  }

  if (!patientFirebaseAuth) {
    return (
      <main className="grid min-h-dvh place-items-center bg-slate-50 p-5 text-center">
        <section className="w-full max-w-md rounded-[28px] bg-white p-7 shadow-sm ring-1 ring-slate-200">
          <ShieldCheck className="mx-auto text-[#A8864A]" size={38} />
          <h1 className="mt-4 text-xl font-bold text-[#233A59]">Secure connection unavailable</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">The patient portal is not configured in this deployment. Please call reception for assistance.</p>
          <a href="tel:+919019263709" className="mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-[#233A59] px-4 text-sm font-bold text-white">Call reception</a>
        </section>
      </main>
    );
  }

  if (loading && !dashboard) {
    return (
      <main id="main-content" className="grid min-h-dvh place-items-center bg-slate-50 px-5 text-center" aria-busy="true">
        <div>
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-white text-[#233A59] shadow-sm ring-1 ring-slate-200">
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          </span>
          <p className="mt-4 font-bold text-[#233A59]">Opening your secure family portal…</p>
          <p className="mt-2 text-sm text-slate-500">Your approved records are being loaded live.</p>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-dvh overflow-x-clip bg-slate-50 text-slate-950">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-3 py-2.5 sm:px-6 sm:py-4">
          <Link href="/portal" className="flex min-w-0 items-center gap-2.5 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#233A59]">
            <Image src="/images/asher-logo-compact-v2.webp" alt="Asher Healthcare" width={44} height={44} className="h-10 w-10 shrink-0 rounded-xl object-contain" />
            <div className="min-w-0">
              <p className="truncate font-bold text-[#233A59]">Asher Family</p>
              <p className="hidden truncate text-xs text-slate-500 min-[360px]:block">Private patient portal</p>
            </div>
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            <PatientPortalPwa compact />
            <button
              type="button"
              onClick={() => void closeSession()}
              aria-label="Sign out of family portal"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#233A59]"
            >
              <LockKeyhole aria-hidden="true" size={15} />
              <span className="hidden min-[390px]:inline">Sign out</span>
            </button>
          </div>
        </div>
      </header>

      <main id="main-content" aria-busy={loading} className="mx-auto max-w-6xl px-3 py-4 pb-28 sm:px-6 sm:py-8 lg:pb-10">
        <section id="overview" className="scroll-mt-24 overflow-hidden rounded-[24px] bg-[#233A59] p-5 text-white sm:rounded-[28px] sm:p-8">
          <p className="text-xs font-bold uppercase tracking-[0.17em] text-[#E7C989]">Your family care space</p>
          <h1 className="mt-2 break-words text-2xl font-bold leading-tight sm:mt-3 sm:text-3xl">Welcome, {dashboard?.account.displayName || "Family"}.</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-white/75 sm:text-base sm:leading-7">Appointments and approved clinic documents, together in one secure place.</p>
          <div className="mt-5 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-3">
            <Link href="/#appointment" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#A8864A] px-3 text-center text-sm font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:px-4">
              <CalendarDays aria-hidden="true" size={18} />Book
            </Link>
            <button type="button" onClick={() => void loadDashboard()} disabled={loading} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-white/10 px-3 text-sm font-bold text-white ring-1 ring-white/20 disabled:opacity-60 sm:px-4">
              {loading ? <LoaderCircle aria-hidden="true" className="animate-spin" size={18} /> : <RefreshCw aria-hidden="true" size={18} />}
              {loading ? "Refreshing" : "Refresh"}
            </button>
          </div>
          {dashboard ? <p className="mt-4 text-xs text-white/60">Updated at {friendlyTimestamp(dashboard.generatedAt)}</p> : null}
        </section>

        {message ? (
          <section role="alert" aria-live="assertive" className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
            <p className="break-words text-sm font-semibold leading-6">{message}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {!dashboard ? (
                <button type="button" onClick={() => void loadDashboard()} disabled={loading} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#233A59] px-4 text-sm font-bold text-white disabled:opacity-60">
                  <RefreshCw aria-hidden="true" size={16} />Try again
                </button>
              ) : null}
              <button type="button" onClick={() => setMessage("")} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-white px-4 text-sm font-bold text-[#233A59] ring-1 ring-amber-200">Dismiss</button>
            </div>
          </section>
        ) : null}

        {dashboard && dashboard.family.length === 0 ? (
          <section className="mt-5 rounded-[24px] bg-white p-7 text-center ring-1 ring-slate-200 sm:p-8">
            <ShieldCheck className="mx-auto text-[#A8864A]" size={38} />
            <h2 className="mt-4 text-xl font-bold text-[#233A59]">No active patient access</h2>
            <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-600">Ask reception to review this family account. Access may be pending, expired or revoked.</p>
            <a href="tel:+919019263709" className="mt-5 inline-flex min-h-12 items-center justify-center rounded-xl bg-[#233A59] px-5 text-sm font-bold text-white">Call reception</a>
          </section>
        ) : null}

        {dashboard && dashboard.family.length > 0 ? (
          <>
            <section className="mt-5 min-w-0 rounded-[24px] bg-white p-4 ring-1 ring-slate-200">
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                <UsersRound aria-hidden="true" size={16} />{dashboard.family.length > 1 ? "Choose family member" : "Patient record"}
              </p>
              <div className="mt-3 flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
                {dashboard.family.map((entry) => (
                  <button
                    key={entry.patient.id}
                    type="button"
                    aria-pressed={selected?.patient.id === entry.patient.id}
                    onClick={() => setSelectedPatientId(entry.patient.id)}
                    className={(selected?.patient.id === entry.patient.id ? "bg-[#233A59] text-white" : "bg-slate-50 text-[#233A59] ring-1 ring-slate-200") + " w-[min(78vw,13rem)] shrink-0 snap-start rounded-2xl px-4 py-3 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#A8864A]"}
                  >
                    <strong className="block break-words text-sm leading-5 [overflow-wrap:anywhere]">{entry.patient.fullName}</strong>
                    <span className="mt-1 block text-xs capitalize opacity-70">{entry.grant.relationship.replaceAll("_", " ")}</span>
                  </button>
                ))}
              </div>
            </section>

            {selected ? (
              <>
                <section aria-label="Record summary" className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
                  <SummaryLink href="#appointments" label="Appointments" count={selected.appointments.length} />
                  <SummaryLink href="#prescriptions" label="Prescriptions" count={selected.prescriptions.length} />
                  <SummaryLink href="#reports" label="Reports" count={selected.reports.length} />
                  <SummaryLink href="#billing" label="Receipts" count={selected.invoices.length} />
                </section>

                <div className="mt-5 grid min-w-0 gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
                  <aside className="min-w-0 space-y-4">
                    <section className="min-w-0 rounded-[24px] bg-white p-5 ring-1 ring-slate-200">
                      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-blue-50 font-bold text-blue-700">{selected.patient.fullName.slice(0, 1).toUpperCase()}</span>
                      <h2 className="mt-4 break-words text-xl font-bold text-[#233A59] [overflow-wrap:anywhere]">{selected.patient.fullName}</h2>
                      <p className="mt-1 break-words text-sm text-slate-500 [overflow-wrap:anywhere]">{selected.patient.patientNumber}</p>
                      {selected.patient.profileAllowed ? (
                        <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-1">
                          <div><dt className="text-xs font-bold uppercase tracking-wide text-slate-400">Date of birth</dt><dd className="mt-1 font-semibold text-slate-700">{friendlyDate(selected.patient.dateOfBirth)}</dd></div>
                          <div><dt className="text-xs font-bold uppercase tracking-wide text-slate-400">Doctor</dt><dd className="mt-1 break-words font-semibold text-slate-700 [overflow-wrap:anywhere]">{selected.patient.doctorName}</dd></div>
                        </dl>
                      ) : <p className="mt-4 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">Profile details are not included in this access grant.</p>}
                      <p className="mt-4 text-sm font-semibold capitalize text-slate-700">Access: {selected.grant.relationship.replaceAll("_", " ")}</p>
                    </section>

                    <section id="help" className="scroll-mt-24 rounded-[24px] bg-[#071f33] p-5 text-white">
                      <HeartHandshake aria-hidden="true" className="text-[#E7C989]" />
                      <h2 className="mt-3 font-bold">Need help?</h2>
                      <p className="mt-2 text-sm leading-6 text-white/70">Call the clinic if a family member or document is missing.</p>
                      <a href="tel:+919019263709" className="mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-white px-4 text-sm font-bold text-[#233A59]">Call +91 90192 63709</a>
                    </section>
                  </aside>

                  <div className="min-w-0 space-y-5">
                    <PortalSection id="appointments" title="Appointments" icon={CalendarDays} count={selected.appointments.length}>
                      {selected.appointments.length ? selected.appointments.map((item) => (
                        <article key={item.id} className="flex min-w-0 items-start justify-between gap-3 rounded-2xl border border-slate-200 p-4">
                          <div className="min-w-0">
                            <p className="break-words font-bold text-[#233A59] [overflow-wrap:anywhere]">{friendlyDate(item.preferredDate)} · {item.preferredTime}</p>
                            <p className="mt-1 break-words text-sm text-slate-600 [overflow-wrap:anywhere]">{item.doctorName}</p>
                            <span className="mt-2 inline-flex rounded-full bg-blue-50 px-2 py-1 text-xs font-bold text-blue-700">{statusLabel(item.status)}</span>
                          </div>
                          {item.queueToken ? <span className="shrink-0 rounded-2xl bg-[#233A59] px-3 py-2 text-center text-white"><small className="block text-[10px] uppercase">Token</small><strong>{item.queueToken}</strong></span> : null}
                        </article>
                      )) : <Empty text="No linked appointments yet" actionHref="/#appointment" actionLabel="Book an appointment" />}
                    </PortalSection>

                    <div id="records" className="scroll-mt-24 space-y-5">
                      <PortalSection id="prescriptions" title="Prescriptions" icon={FileHeart} count={selected.prescriptions.length}>
                        {selected.prescriptions.length ? selected.prescriptions.map((item) => <DocumentRow key={item.id} title={friendlyDate(item.prescribedDate)} subtitle={item.doctorName || "Clinic prescription"} busy={activeAction.startsWith(`prescription:${item.id}:`)} onPrint={() => void secureDocument("prescription", item.id, "print")} onDownload={() => void secureDocument("prescription", item.id, "download")} />) : <Empty text="No prescriptions shared yet" />}
                      </PortalSection>
                      <PortalSection id="reports" title="Reports" icon={FileText} count={selected.reports.length}>
                        {selected.reports.length ? selected.reports.map((item) => <DocumentRow key={item.id} title={item.category || "Medical report"} subtitle={friendlyDate(item.reportDate)} busy={activeAction.startsWith(`report:${item.id}:`)} onPrint={() => void openReport(item, "print")} onDownload={() => void openReport(item, "download")} />) : <Empty text="No reports shared yet" />}
                      </PortalSection>
                      <PortalSection id="billing" title="Receipts & billing" icon={ReceiptIndianRupee} count={selected.invoices.length}>
                        {selected.invoices.length ? selected.invoices.map((item) => <DocumentRow key={item.id} title={item.invoiceNumber || "Payment receipt"} subtitle={`INR ${Number(item.amountPaid || 0).toLocaleString("en-IN")} received · INR ${Number(item.balance || 0).toLocaleString("en-IN")} due · ${statusLabel(item.paymentStatus)}`} busy={activeAction.startsWith(`receipt:${item.id}:`)} onPrint={() => void secureDocument("receipt", item.id, "print")} onDownload={() => void secureDocument("receipt", item.id, "download")} />) : <Empty text="No billing records shared yet" />}
                      </PortalSection>
                    </div>
                  </div>
                </div>
              </>
            ) : null}
          </>
        ) : null}

        <p className="mt-6 flex items-start gap-2 text-xs leading-5 text-slate-500"><ShieldCheck aria-hidden="true" className="mt-0.5 shrink-0" size={16} />Records are loaded live through an audited clinic service and are not cached for offline viewing. This portal locks after 20 minutes without activity.</p>
      </main>

      {selected ? (
        <nav aria-label="Family portal shortcuts" className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-2 pt-1.5 shadow-[0_-8px_28px_rgba(15,23,42,0.08)] backdrop-blur-xl lg:hidden" style={{ paddingBottom: "max(0.4rem, env(safe-area-inset-bottom))" }}>
          <div className="mx-auto grid max-w-md grid-cols-4">
            <MobileNavLink href="#overview" label="Home" icon={Home} />
            <MobileNavLink href="#appointments" label="Visits" icon={CalendarDays} />
            <MobileNavLink href="#records" label="Records" icon={Files} />
            <MobileNavLink href="#help" label="Help" icon={CircleHelp} />
          </div>
        </nav>
      ) : null}
    </div>
  );
}

function SummaryLink({ href, label, count }: { href: string; label: string; count: number }) {
  return (
    <a href={href} className="min-w-0 rounded-2xl bg-white p-3 ring-1 ring-slate-200 transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#233A59] sm:p-4">
      <strong className="block text-xl font-black text-[#233A59]">{count}</strong>
      <span className="mt-1 block truncate text-xs font-bold text-slate-500">{label}</span>
    </a>
  );
}

function MobileNavLink({ href, label, icon: Icon }: { href: string; label: string; icon: typeof Stethoscope }) {
  return (
    <a href={href} className="flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-bold text-slate-600 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#233A59]">
      <Icon aria-hidden="true" size={19} />{label}
    </a>
  );
}

function DocumentRow({ title, subtitle, busy, onPrint, onDownload }: { title: string; subtitle: string; busy: boolean; onPrint: () => void; onDownload: () => void }) {
  return (
    <article aria-busy={busy} className="min-w-0 rounded-2xl border border-slate-200 p-4">
      <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="break-words font-bold text-[#233A59] [overflow-wrap:anywhere]">{title}</p>
          <p className="mt-1 break-words text-sm leading-6 text-slate-500 [overflow-wrap:anywhere]">{subtitle}</p>
        </div>
        <div className="grid w-full shrink-0 grid-cols-2 gap-2 sm:w-auto">
          <button disabled={busy} type="button" onClick={onPrint} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-700 disabled:opacity-50">
            {busy ? <LoaderCircle aria-hidden="true" className="animate-spin" size={15} /> : <Printer aria-hidden="true" size={15} />}Print
          </button>
          <button disabled={busy} type="button" onClick={onDownload} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#233A59] px-3 text-xs font-bold text-white disabled:opacity-50">
            <Download aria-hidden="true" size={15} />Download
          </button>
        </div>
      </div>
    </article>
  );
}

function PortalSection({ id, title, icon: Icon, count, children }: { id: string; title: string; icon: typeof Stethoscope; count: number; children: React.ReactNode }) {
  return (
    <section id={id} className="min-w-0 scroll-mt-24 rounded-[24px] bg-white p-4 ring-1 ring-slate-200 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-50 text-[#A8864A]"><Icon aria-hidden="true" size={20} /></span>
          <h2 className="break-words text-lg font-bold text-[#233A59] [overflow-wrap:anywhere]">{title}</h2>
        </div>
        <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">{count}</span>
      </div>
      <div className="mt-4 space-y-3 sm:mt-5">{children}</div>
    </section>
  );
}

function Empty({ text, actionHref, actionLabel }: { text: string; actionHref?: string; actionLabel?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500 sm:p-6">
      <p>{text}</p>
      {actionHref && actionLabel ? <Link href={actionHref} className="mt-3 inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-100 px-4 font-bold text-[#233A59]">{actionLabel}</Link> : null}
    </div>
  );
}
