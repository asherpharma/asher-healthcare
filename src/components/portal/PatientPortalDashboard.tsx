"use client";

import PatientPortalPwa from "@/components/portal/PatientPortalPwa";
import { patientFirebaseAuth } from "@/firebase/config";
import { downloadPrescriptionPdf, printPrescriptionPdf, type PrescriptionPdfRecord } from "@/lib/prescription-pdf";
import { downloadReceiptPdf, printReceiptPdf, type ReceiptInvoice } from "@/lib/receipt-pdf";
import { onAuthStateChanged } from "firebase/auth";
import {
  CalendarDays,
  ChevronRight,
  Download,
  FileHeart,
  FileText,
  HeartHandshake,
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

const IDLE_TIMEOUT_MS = 20 * 60 * 1000;

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
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [activeAction, setActiveAction] = useState("");

  const closeSession = useCallback(async (reason = "") => {
    setDashboard(null);
    setSelectedPatientId("");
    window.sessionStorage.removeItem("asher.portal.lastActivityAt");
    if (patientFirebaseAuth) await patientFirebaseAuth.signOut().catch(() => {});
    router.replace(reason ? `/portal/login?reason=${encodeURIComponent(reason)}` : "/portal/login");
  }, [router]);

  const loadDashboard = useCallback(async () => {
    const user = patientFirebaseAuth?.currentUser;
    if (!user) return;
    const persistedActivity = Number(window.sessionStorage.getItem("asher.portal.lastActivityAt"));
    if (!Number.isFinite(persistedActivity) || Date.now() - persistedActivity >= IDLE_TIMEOUT_MS) {
      await closeSession("inactivity");
      return;
    }
    lastActivityAt.current = persistedActivity;
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
      if (!response.ok) {
        if ([401, 403, 404].includes(response.status)) await closeSession("access_changed");
        throw new Error(result.error || "Your family records could not be loaded.");
      }
      setDashboard(result as Dashboard);
      setSelectedPatientId((current) => (result as Dashboard).family.some((entry) => entry.patient.id === current)
        ? current
        : (result as Dashboard).family[0]?.patient.id || "");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Your family records could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [closeSession]);

  useEffect(() => {
    const auth = patientFirebaseAuth;
    if (!auth) return;
    return onAuthStateChanged(auth, (user) => {
      if (!user) { router.replace("/portal/login"); return; }
      void loadDashboard();
    });
  }, [loadDashboard, router]);

  useEffect(() => {
    const auth = patientFirebaseAuth;
    if (!auth) return;
    const scheduleIdleLock = () => {
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
      const remaining = IDLE_TIMEOUT_MS - (Date.now() - lastActivityAt.current);
      if (remaining <= 0) { void closeSession("inactivity"); return; }
      idleTimer.current = window.setTimeout(() => void closeSession("inactivity"), remaining);
    };
    const recordActivity = () => {
      lastActivityAt.current = Date.now();
      window.sessionStorage.setItem("asher.portal.lastActivityAt", String(lastActivityAt.current));
      scheduleIdleLock();
    };
    const revalidate = () => {
      if (Date.now() - lastActivityAt.current >= IDLE_TIMEOUT_MS) {
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
  }, [closeSession, loadDashboard]);

  const selected = useMemo(
    () => dashboard?.family.find((entry) => entry.patient.id === selectedPatientId) || dashboard?.family[0] || null,
    [dashboard, selectedPatientId],
  );

  async function secureDocument(
    documentType: "prescription" | "receipt",
    documentId: string,
    action: "print" | "download",
  ) {
    if (!patientFirebaseAuth?.currentUser || !selected) return;
    const popup = action === "print" ? window.open("", "_blank") : null;
    if (popup) {
      popup.opener = null;
      popup.document.body.textContent = "Preparing secure document…";
    }
    setActiveAction(`${documentType}:${documentId}:${action}`);
    setMessage("");
    try {
      const idToken = await patientFirebaseAuth.currentUser.getIdToken();
      const response = await fetch("/api/patient/document", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ patientId: selected.patient.id, documentId, documentType, action }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        popup?.close();
        if ([401, 403, 404].includes(response.status)) await closeSession("access_changed");
        throw new Error(result.error || "This patient document is not available.");
      }
      if (documentType === "prescription") {
        const prescription = result.document as PrescriptionPdfRecord;
        if (action === "print") await printPrescriptionPdf(selected.patient, prescription, popup || undefined);
        else await downloadPrescriptionPdf(selected.patient, prescription, "prescription.pdf");
      } else {
        const data = result.document as Omit<ReceiptInvoice, "patientName" | "patientPhone" | "paymentReference" | "notes" | "createdAt"> & { createdAt?: string };
        const invoice: ReceiptInvoice = {
          ...data,
          patientName: selected.patient.fullName,
          patientPhone: selected.patient.phone,
          paymentReference: "",
          notes: "",
          createdAt: data.createdAt ? { toDate: () => new Date(data.createdAt as string) } : undefined,
        };
        if (action === "print") await printReceiptPdf(invoice, popup || undefined);
        else await downloadReceiptPdf(invoice, "payment-receipt.pdf");
      }
    } catch (error) {
      popup?.close();
      setMessage(error instanceof Error ? error.message : "This patient document is not available.");
    } finally {
      setActiveAction("");
    }
  }

  async function openReport(report: Report, action: "print" | "download") {
    if (!patientFirebaseAuth?.currentUser || !selected) return;
    const popup = action === "print" ? window.open("", "_blank") : null;
    if (popup) { popup.opener = null; popup.document.body.textContent = "Preparing secure report…"; }
    setActiveAction(`report:${report.id}:${action}`);
    setMessage("");
    try {
      const idToken = await patientFirebaseAuth.currentUser.getIdToken();
      const response = await fetch("/api/patient/report", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ patientId: selected.patient.id, reportId: report.id, action }),
      });
      if (!response.ok) {
        popup?.close();
        if ([401, 403, 404].includes(response.status)) await closeSession("access_changed");
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || "This report could not be opened.");
      }
      const contentType = response.headers.get("Content-Type") || report.contentType;
      const blobUrl = URL.createObjectURL(await response.blob());
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
      setMessage(error instanceof Error ? error.message : "This report could not be opened.");
    } finally {
      setActiveAction("");
    }
  }

  if (!patientFirebaseAuth) {
    return <main className="grid min-h-dvh place-items-center bg-slate-50 p-6 text-center font-semibold text-[#233A59]">The secure patient connection is not configured.</main>;
  }
  if (loading && !dashboard) {
    return <main id="main-content" className="grid min-h-dvh place-items-center bg-slate-50"><p className="flex items-center gap-3 font-bold text-[#233A59]"><LoaderCircle className="animate-spin" />Opening your secure family portal…</p></main>;
  }

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-950">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-3 py-2.5 sm:px-6 sm:py-4">
          <Link href="/portal" className="flex min-w-0 items-center gap-2.5"><Image src="/images/logo.png" alt="Asher Healthcare" width={44} height={44} className="h-10 w-10 rounded-xl object-contain" /><div className="min-w-0"><p className="truncate font-bold text-[#233A59]">Asher Family</p><p className="truncate text-xs text-slate-500">Private patient portal</p></div></Link>
          <div className="flex items-center gap-2"><PatientPortalPwa /><button type="button" onClick={() => void closeSession()} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700"><LockKeyhole size={15} />Sign out</button></div>
        </div>
      </header>
      <main id="main-content" className="mx-auto max-w-6xl px-3 py-5 pb-24 sm:px-6 sm:py-8">
        <section className="overflow-hidden rounded-[28px] bg-[#233A59] p-6 text-white sm:p-8"><p className="text-xs font-bold uppercase tracking-[0.17em] text-[#E7C989]">Your family care space</p><h1 className="mt-3 text-3xl font-bold">Welcome, {dashboard?.account.displayName || "Family"}.</h1><p className="mt-3 max-w-3xl leading-7 text-white/75">Review only the patient records that Asher Healthcare has explicitly approved for this account.</p><div className="mt-6 flex flex-wrap gap-3"><Link href="/#appointment" className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-[#A8864A] px-4 text-sm font-bold text-white"><CalendarDays size={18} />Book appointment</Link><button type="button" onClick={() => void loadDashboard()} disabled={loading} className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-white/10 px-4 text-sm font-bold text-white ring-1 ring-white/20">{loading ? <LoaderCircle className="animate-spin" size={18} /> : <RefreshCw size={18} />}Refresh</button></div></section>
        {message ? <p role="alert" className="mt-5 rounded-2xl bg-amber-50 p-4 text-sm font-semibold leading-6 text-amber-900">{message}</p> : null}
        {dashboard && dashboard.family.length === 0 ? <section className="mt-5 rounded-[28px] bg-white p-8 text-center ring-1 ring-slate-200"><ShieldCheck className="mx-auto text-[#A8864A]" size={38} /><h2 className="mt-4 text-xl font-bold text-[#233A59]">No active patient access</h2><p className="mt-2 text-slate-600">Ask reception to review this family account. Access may be pending, expired or revoked.</p></section> : null}
        {dashboard && dashboard.family.length > 0 ? <>
          <section className="mt-5 rounded-[24px] bg-white p-4 ring-1 ring-slate-200"><p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500"><UsersRound size={16} />Choose family member</p><div className="mt-3 flex gap-2 overflow-x-auto pb-1">{dashboard.family.map((entry) => <button key={entry.patient.id} type="button" onClick={() => setSelectedPatientId(entry.patient.id)} className={(selected?.patient.id === entry.patient.id ? "bg-[#233A59] text-white" : "bg-slate-50 text-[#233A59]") + " min-w-44 rounded-2xl px-4 py-3 text-left transition"}><strong className="block truncate text-sm">{entry.patient.fullName}</strong><span className="mt-1 block text-xs opacity-70 capitalize">{entry.grant.relationship.replaceAll("_", " ")}</span></button>)}</div></section>
          {selected ? <div className="mt-5 grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
            <aside className="space-y-4"><section className="rounded-[24px] bg-white p-5 ring-1 ring-slate-200"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-blue-50 font-bold text-blue-700">{selected.patient.fullName.slice(0, 1).toUpperCase()}</span><h2 className="mt-4 text-xl font-bold text-[#233A59]">{selected.patient.fullName}</h2><p className="mt-1 text-sm text-slate-500">{selected.patient.patientNumber}</p>{selected.patient.profileAllowed ? <dl className="mt-5 space-y-3 text-sm"><div><dt className="text-xs font-bold uppercase tracking-wide text-slate-400">Date of birth</dt><dd className="mt-1 font-semibold text-slate-700">{friendlyDate(selected.patient.dateOfBirth)}</dd></div><div><dt className="text-xs font-bold uppercase tracking-wide text-slate-400">Doctor</dt><dd className="mt-1 font-semibold text-slate-700">{selected.patient.doctorName}</dd></div></dl> : <p className="mt-4 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">Profile details are not included in this access grant.</p>}<p className="mt-4 text-sm font-semibold capitalize text-slate-700">Access: {selected.grant.relationship.replaceAll("_", " ")}</p></section><section className="rounded-[24px] bg-[#071f33] p-5 text-white"><HeartHandshake className="text-[#E7C989]" /><h2 className="mt-3 font-bold">Need help?</h2><p className="mt-2 text-sm leading-6 text-white/70">Call the clinic if a family member or document is missing.</p><a href="tel:+919019263709" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-white px-4 text-sm font-bold text-[#233A59]">Call +91 90192 63709</a></section></aside>
            <div className="space-y-5">
              <PortalSection title="Appointments" icon={CalendarDays} count={selected.appointments.length}>{selected.appointments.length ? selected.appointments.map((item) => <article key={item.id} className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 p-4"><div><p className="font-bold text-[#233A59]">{friendlyDate(item.preferredDate)} · {item.preferredTime}</p><p className="mt-1 text-sm text-slate-600">{item.doctorName}</p><span className="mt-2 inline-flex rounded-full bg-blue-50 px-2 py-1 text-xs font-bold text-blue-700">{statusLabel(item.status)}</span></div>{item.queueToken ? <span className="rounded-2xl bg-[#233A59] px-3 py-2 text-center text-white"><small className="block text-[10px] uppercase">Token</small><strong>{item.queueToken}</strong></span> : <ChevronRight className="text-slate-300" />}</article>) : <Empty text="No linked appointments yet" />}</PortalSection>
              <PortalSection title="Prescriptions" icon={FileHeart} count={selected.prescriptions.length}>{selected.prescriptions.length ? selected.prescriptions.map((item) => <DocumentRow key={item.id} title={friendlyDate(item.prescribedDate)} subtitle={item.doctorName || "Clinic prescription"} busy={activeAction.startsWith(`prescription:${item.id}:`)} onPrint={() => void secureDocument("prescription", item.id, "print")} onDownload={() => void secureDocument("prescription", item.id, "download")} />) : <Empty text="No prescriptions shared yet" />}</PortalSection>
              <PortalSection title="Reports" icon={FileText} count={selected.reports.length}>{selected.reports.length ? selected.reports.map((item) => <DocumentRow key={item.id} title={item.category || "Medical report"} subtitle={friendlyDate(item.reportDate)} busy={activeAction.startsWith(`report:${item.id}:`)} onPrint={() => void openReport(item, "print")} onDownload={() => void openReport(item, "download")} />) : <Empty text="No reports shared yet" />}</PortalSection>
              <PortalSection title="Receipts & billing" icon={ReceiptIndianRupee} count={selected.invoices.length}>{selected.invoices.length ? selected.invoices.map((item) => <DocumentRow key={item.id} title={item.invoiceNumber || "Payment receipt"} subtitle={`INR ${Number(item.amountPaid || 0).toLocaleString("en-IN")} received · INR ${Number(item.balance || 0).toLocaleString("en-IN")} due · ${statusLabel(item.paymentStatus)}`} busy={activeAction.startsWith(`receipt:${item.id}:`)} onPrint={() => void secureDocument("receipt", item.id, "print")} onDownload={() => void secureDocument("receipt", item.id, "download")} />) : <Empty text="No billing records shared yet" />}</PortalSection>
            </div>
          </div> : null}
        </> : null}
        <p className="mt-6 flex items-start gap-2 text-xs leading-5 text-slate-500"><ShieldCheck className="mt-0.5 shrink-0" size={16} />Records are loaded live through an audited clinic service and are not cached for offline viewing. This portal locks after 20 minutes without activity.</p>
      </main>
    </div>
  );
}

function DocumentRow({ title, subtitle, busy, onPrint, onDownload }: { title: string; subtitle: string; busy: boolean; onPrint: () => void; onDownload: () => void }) {
  return <article className="rounded-2xl border border-slate-200 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-bold text-[#233A59]">{title}</p><p className="mt-1 text-sm text-slate-500">{subtitle}</p></div><div className="flex gap-2"><button disabled={busy} type="button" onClick={onPrint} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-bold disabled:opacity-50">{busy ? <LoaderCircle className="animate-spin" size={15} /> : <Printer size={15} />}Print</button><button disabled={busy} type="button" onClick={onDownload} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#233A59] px-3 text-xs font-bold text-white disabled:opacity-50"><Download size={15} />Download</button></div></div></article>;
}

function PortalSection({ title, icon: Icon, count, children }: { title: string; icon: typeof Stethoscope; count: number; children: React.ReactNode }) {
  return <section className="rounded-[24px] bg-white p-5 ring-1 ring-slate-200 sm:p-6"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-slate-50 text-[#A8864A]"><Icon size={20} /></span><h2 className="text-lg font-bold text-[#233A59]">{title}</h2></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">{count}</span></div><div className="mt-5 space-y-3">{children}</div></section>;
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">{text}</div>;
}
