"use client";

import { useStaff } from "@/components/admin/StaffGuard";
import { firestore } from "@/firebase/config";
import { formatAppointmentTime } from "@/lib/appointments";
import {
  APPOINTMENT_STATUSES,
  APPOINTMENT_STATUS_OPTIONS,
  appointmentStatusLabel,
  type AppointmentStatus,
} from "@/lib/visit-workflow";
import {
  collection,
  collectionGroup,
  documentId,
  getCountFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  type DocumentData,
  type Query,
  type QueryDocumentSnapshot,
  Timestamp,
  where,
} from "firebase/firestore";
import {
  AlertCircle,
  ArrowRight,
  Banknote,
  CalendarCheck2,
  CheckCircle2,
  Clock3,
  CreditCard,
  FlaskConical,
  IndianRupee,
  ListTodo,
  LoaderCircle,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Stethoscope,
  TrendingUp,
  UserRoundCheck,
  UserRoundCog,
  UsersRound,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type DashboardRange = "today" | "month" | "all";
type DateValue = Timestamp | { toDate?: () => Date } | null | undefined;

type PatientRecord = {
  id: string;
  fullName: string;
  phone: string;
  doctorName?: string;
  caseType?: string;
  createdAt?: Timestamp;
};

type AppointmentRecord = {
  id: string;
  patientName: string;
  phone: string;
  doctorId: string;
  preferredDate: string;
  preferredTime: string;
  status: AppointmentStatus;
  queueToken?: number;
};

const ACTIVE_APPOINTMENT_STATUSES = new Set<AppointmentStatus>([
  "requested",
  "confirmed",
  "checked_in",
  "waiting",
  "in_consultation",
]);

const IN_CLINIC_APPOINTMENT_STATUSES = new Set<AppointmentStatus>([
  "checked_in",
  "waiting",
  "in_consultation",
]);

const APPOINTMENT_STATUS_TONES: Record<AppointmentStatus, string> = {
  requested: "bg-amber-500",
  confirmed: "bg-blue-600",
  checked_in: "bg-cyan-600",
  waiting: "bg-violet-600",
  in_consultation: "bg-fuchsia-600",
  completed: "bg-emerald-600",
  no_show: "bg-orange-500",
  cancelled: "bg-slate-400",
};

type InvoiceRecord = {
  id: string;
  patientId: string;
  patientName: string;
  invoiceNumber: string;
  total: number;
  amountPaid: number;
  balance: number;
  paymentStatus: string;
  paymentMethod: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  paidAt?: Timestamp;
};

type PaymentRecord = {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  patientId: string;
  patientName: string;
  amount: number;
  refundedAmount?: number;
  method: string;
  status: string;
  createdAt?: Timestamp;
};

function netPaymentAmount(payment: PaymentRecord) {
  return Math.max(0, Number(payment.amount || 0) - Number(payment.refundedAmount || 0));
}

type VisitRecord = {
  id: string;
  patientId: string;
  visitDate: string;
  doctorName: string;
};

type LabRecord = {
  id: string;
  status: string;
  priority: string;
};

type TaskRecord = {
  id: string;
  status: string;
  dueDate: string;
  priority: string;
};

type DashboardData = {
  patients: PatientRecord[];
  appointments: AppointmentRecord[];
  invoices: InvoiceRecord[];
  outstandingInvoices: InvoiceRecord[];
  payments: PaymentRecord[];
  visits: VisitRecord[];
  labs: LabRecord[];
  tasks: TaskRecord[];
  totalPatientCount: number;
  paymentAuditAvailable: boolean;
  visitRecordsAvailable: boolean;
  limitedSources: string[];
  unavailableSources: string[];
};

type VisitEvent = {
  key: string;
  date: string;
  doctorName: string;
  patientId: string;
};

const doctors = ["Dr. Lt Col Shafi Ahamad", "Dr. Shaik Reshma"] as const;

const emptyData: DashboardData = {
  patients: [],
  appointments: [],
  invoices: [],
  outstandingInvoices: [],
  payments: [],
  visits: [],
  labs: [],
  tasks: [],
  totalPatientCount: 0,
  paymentAuditAvailable: true,
  visitRecordsAvailable: true,
  limitedSources: [],
  unavailableSources: [],
};

const PERIOD_RECORD_LIMIT = 1_500;
const OPERATIONAL_RECORD_LIMIT = 500;
const PATIENT_LOOKUP_LIMIT = 1_500;

type BoundedDocuments = {
  documents: QueryDocumentSnapshot<DocumentData>[];
  available: boolean;
  limited: boolean;
};

function clinicDateKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function timestampDateKey(value: DateValue) {
  try {
    return value?.toDate ? clinicDateKey(value.toDate()) : "";
  } catch {
    return "";
  }
}

function matchesRange(date: string, range: DashboardRange, today: string) {
  if (range === "all") return true;
  if (range === "today") return date === today;
  return date.startsWith(today.slice(0, 7));
}

function normalisePhone(value: string) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function appointmentDoctor(doctorId: string) {
  if (doctorId === "pediatrics") return doctors[0];
  if (doctorId === "obg") return doctors[1];
  return doctorId || "Unassigned";
}

function doctorBucket(value?: string) {
  return doctors.includes(value as (typeof doctors)[number]) ? String(value) : "Unassigned / archived";
}

function money(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function number(value: number) {
  return new Intl.NumberFormat("en-IN").format(Number(value || 0));
}

function paymentMethodLabel(method: string) {
  const labels: Record<string, string> = {
    cash: "Cash",
    upi: "UPI",
    card: "Card",
    bank_transfer: "Bank transfer",
    online: "Razorpay / online",
    not_recorded: "Not recorded",
  };
  return labels[method] ?? (method || "Not recorded");
}

function rangeLabel(range: DashboardRange) {
  if (range === "today") return "Today";
  if (range === "month") return "This month";
  return "All time";
}

function timeInMinutes(value: string) {
  const [hour, minute] = String(value || "").split(":").map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return Number.POSITIVE_INFINITY;
  }
  return hour * 60 + minute;
}

function clinicTimeInMinutes(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value || 0);
  return part("hour") * 60 + part("minute");
}

function shiftDateKey(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return value.toISOString().slice(0, 10);
}

function nextMonthStart(dateKey: string) {
  const [year, month] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
}

function dashboardWindow(range: DashboardRange, today: string, includeSevenDayTrend: boolean) {
  if (range === "all") return null;

  const reportingStart = range === "today" ? today : `${today.slice(0, 7)}-01`;
  const reportingEnd = range === "today" ? shiftDateKey(today, 1) : nextMonthStart(today);
  const trendStart = shiftDateKey(today, -6);

  return {
    start: includeSevenDayTrend && trendStart < reportingStart ? trendStart : reportingStart,
    end: reportingEnd,
  };
}

function clinicTimestamp(dateKey: string) {
  return Timestamp.fromDate(new Date(`${dateKey}T00:00:00+05:30`));
}

function boundedRangeQuery(
  source: Query<DocumentData>,
  field: string,
  valueType: "date-key" | "timestamp",
  range: DashboardRange,
  today: string,
  includeSevenDayTrend: boolean,
  cap = PERIOD_RECORD_LIMIT,
) {
  const window = dashboardWindow(range, today, includeSevenDayTrend);
  if (!window) return query(source, limit(cap + 1));

  const start = valueType === "timestamp" ? clinicTimestamp(window.start) : window.start;
  const end = valueType === "timestamp" ? clinicTimestamp(window.end) : window.end;
  return query(
    source,
    where(field, ">=", start),
    where(field, "<", end),
    orderBy(field, "desc"),
    limit(cap + 1),
  );
}

async function loadBoundedDocuments(
  label: string,
  source: Query<DocumentData>,
  cap: number,
): Promise<BoundedDocuments> {
  try {
    const snapshot = await getDocs(source);
    return {
      documents: snapshot.docs.slice(0, cap),
      available: true,
      limited: snapshot.size > cap,
    };
  } catch (error) {
    console.error(`Dashboard ${label} could not be loaded`, error);
    return { documents: [], available: false, limited: false };
  }
}

function chunks<T>(values: T[], size: number) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, (index + 1) * size),
  );
}

async function loadReferencedPatients(patientIds: string[], knownPatientIds: Set<string>) {
  if (!firestore) return { records: [] as PatientRecord[], available: false, limited: false };
  const database = firestore;

  const unresolvedIds = [...new Set(patientIds.filter(Boolean))].filter((id) => !knownPatientIds.has(id));
  const limited = unresolvedIds.length > PATIENT_LOOKUP_LIMIT;
  const selectedIds = unresolvedIds.slice(0, PATIENT_LOOKUP_LIMIT);
  let available = true;

  const snapshots = await Promise.all(
    chunks(selectedIds, 30).map(async (ids) => {
      try {
        return await getDocs(query(collection(database, "patients"), where(documentId(), "in", ids)));
      } catch (error) {
        available = false;
        console.error("Dashboard patient attribution records could not be loaded", error);
        return null;
      }
    }),
  );

  return {
    records: snapshots.flatMap((snapshot) => snapshot ? mapDocuments<PatientRecord>(snapshot.docs) : []),
    available,
    limited,
  };
}

function mapDocuments<T extends { id: string }>(documents: QueryDocumentSnapshot<DocumentData>[]) {
  return documents.map((item) => ({ id: item.id, ...item.data() }) as T);
}

async function fetchDashboardData(range: DashboardRange, today: string): Promise<DashboardData> {
  if (!firestore) throw new Error("Firebase is not configured for this environment.");

  const [patientsResult, appointmentsResult, invoicesResult, labsResult, tasksResult, paymentsResult, visitsResult, outstandingResult, patientCountResult] = await Promise.all([
    loadBoundedDocuments(
      "patient registrations",
      boundedRangeQuery(collection(firestore, "patients"), "createdAt", "timestamp", range, today, true),
      PERIOD_RECORD_LIMIT,
    ),
    loadBoundedDocuments(
      "appointments",
      boundedRangeQuery(collection(firestore, "appointments"), "preferredDate", "date-key", range, today, false),
      PERIOD_RECORD_LIMIT,
    ),
    loadBoundedDocuments(
      "invoices",
      boundedRangeQuery(collection(firestore, "invoices"), "createdAt", "timestamp", range, today, true),
      PERIOD_RECORD_LIMIT,
    ),
    loadBoundedDocuments(
      "lab orders",
      query(collection(firestore, "labOrders"), limit(OPERATIONAL_RECORD_LIMIT + 1)),
      OPERATIONAL_RECORD_LIMIT,
    ),
    loadBoundedDocuments(
      "open staff tasks",
      query(collection(firestore, "staffTasks"), where("status", "==", "open"), limit(OPERATIONAL_RECORD_LIMIT + 1)),
      OPERATIONAL_RECORD_LIMIT,
    ),
    loadBoundedDocuments(
      "payment audit",
      boundedRangeQuery(collectionGroup(firestore, "payments"), "createdAt", "timestamp", range, today, true),
      PERIOD_RECORD_LIMIT,
    ),
    loadBoundedDocuments(
      "clinical visits",
      boundedRangeQuery(collectionGroup(firestore, "visits"), "visitDate", "date-key", range, today, true),
      PERIOD_RECORD_LIMIT,
    ),
    loadBoundedDocuments(
      "outstanding invoices",
      query(collection(firestore, "invoices"), where("balance", ">", 0), limit(PERIOD_RECORD_LIMIT + 1)),
      PERIOD_RECORD_LIMIT,
    ),
    getCountFromServer(collection(firestore, "patients"))
      .then((snapshot) => ({ count: snapshot.data().count, available: true }))
      .catch((error) => {
        console.error("Dashboard patient total could not be loaded", error);
        return { count: 0, available: false };
      }),
  ]);

  const patients = mapDocuments<PatientRecord>(patientsResult.documents);
  const appointments = mapDocuments<AppointmentRecord>(appointmentsResult.documents);
  const invoices = mapDocuments<InvoiceRecord>(invoicesResult.documents);
  const payments = mapDocuments<PaymentRecord>(paymentsResult.documents);
  const outstandingInvoices = mapDocuments<InvoiceRecord>(outstandingResult.documents);
  const visitRecords = visitsResult.documents.map((item) => ({
    id: item.id,
    patientId: item.ref.parent.parent?.id ?? "",
    ...item.data(),
  }) as VisitRecord);

  const referencedPatientIds = [
    ...invoices.map((invoice) => invoice.patientId),
    ...outstandingInvoices.map((invoice) => invoice.patientId),
    ...payments.map((payment) => payment.patientId),
    ...visitRecords.map((visit) => visit.patientId),
  ];
  const referencedPatients = await loadReferencedPatients(
    referencedPatientIds,
    new Set(patients.map((patient) => patient.id)),
  );
  const patientMap = new Map(patients.map((patient) => [patient.id, patient]));
  referencedPatients.records.forEach((patient) => patientMap.set(patient.id, patient));

  const sources = [
    ["patient registrations", patientsResult],
    ["appointments", appointmentsResult],
    ["invoices", invoicesResult],
    ["lab orders", labsResult],
    ["open staff tasks", tasksResult],
    ["payment audit", paymentsResult],
    ["clinical visits", visitsResult],
    ["outstanding invoices", outstandingResult],
  ] as const;
  const limitedSources: string[] = sources.filter(([, result]) => result.limited).map(([label]) => label);
  const unavailableSources: string[] = sources.filter(([, result]) => !result.available).map(([label]) => label);
  if (referencedPatients.limited) limitedSources.push("patient attribution");
  if (!referencedPatients.available) unavailableSources.push("patient attribution");
  if (!patientCountResult.available) unavailableSources.push("patient total");

  return {
    patients: [...patientMap.values()],
    appointments,
    invoices,
    outstandingInvoices,
    payments,
    visits: visitRecords,
    labs: mapDocuments<LabRecord>(labsResult.documents),
    tasks: mapDocuments<TaskRecord>(tasksResult.documents),
    totalPatientCount: patientCountResult.available ? patientCountResult.count : patientMap.size,
    paymentAuditAvailable: paymentsResult.available,
    visitRecordsAvailable: visitsResult.available,
    limitedSources,
    unavailableSources,
  };
}

function StaffAppHome({ role, displayName }: { role: "doctor" | "reception"; displayName: string }) {
  const isDoctor = role === "doctor";
  const actions = isDoctor
    ? [
        { href: "/admin/consultations", label: "Open consultations", detail: "Review the clinical queue", icon: Stethoscope, tone: "bg-cyan-50 text-cyan-900" },
        { href: "/admin/appointments", label: "Appointments", detail: "Today’s doctor schedule", icon: CalendarCheck2, tone: "bg-blue-50 text-blue-900" },
        { href: "/admin/patients", label: "Patient records", detail: "History and prescriptions", icon: UsersRound, tone: "bg-violet-50 text-violet-900" },
        { href: "/admin/lab", label: "Lab reports", detail: "Orders and results", icon: FlaskConical, tone: "bg-emerald-50 text-emerald-900" },
      ]
    : [
        { href: "/admin/patients", label: "Register patient", detail: "Create the visit and invoice", icon: UserRoundCheck, tone: "bg-blue-50 text-blue-900" },
        { href: "/admin/appointments", label: "Appointments", detail: "Book and manage the queue", icon: CalendarCheck2, tone: "bg-amber-50 text-amber-900" },
        { href: "/admin/billing", label: "Collect payment", detail: "QR, receipt, and balance", icon: IndianRupee, tone: "bg-emerald-50 text-emerald-900" },
        { href: "/admin/lab", label: "Lab desk", detail: "Orders and reports", icon: FlaskConical, tone: "bg-violet-50 text-violet-900" },
      ];

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <section className="overflow-hidden rounded-[30px] bg-gradient-to-br from-[#16314b] to-[#2f5878] p-6 text-white shadow-xl sm:p-8">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#efd193]">{isDoctor ? "Doctor workspace" : "Reception workspace"}</p>
        <h1 className="mt-2 text-3xl font-bold">Hello, {displayName.split(" ")[0] || "team"}.</h1>
        <p className="mt-3 max-w-xl leading-7 text-white/75">Choose a clinic task below. The phone app keeps your most-used actions one tap away.</p>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:gap-4">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <Link key={action.href} href={action.href} className={`flex min-h-36 flex-col justify-between rounded-[24px] p-5 shadow-sm ring-1 ring-black/5 transition active:scale-[0.98] ${action.tone}`}>
              <Icon size={26} />
              <div><h2 className="font-bold sm:text-lg">{action.label}</h2><p className="mt-1 text-xs leading-5 opacity-70 sm:text-sm">{action.detail}</p></div>
            </Link>
          );
        })}
      </section>

      <section className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
        <ShieldAlert className="mt-0.5 shrink-0" size={19} />
        <p>Clinic-wide financial analytics remain visible only to administrators. Your assigned operational tools are available above.</p>
      </section>
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone,
  loading,
}: {
  label: string;
  value: string;
  hint: string;
  icon: LucideIcon;
  tone: string;
  loading: boolean;
}) {
  return (
    <article className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-4">
        <span className={`inline-flex rounded-xl p-3 ${tone}`}><Icon size={22} /></span>
        {loading ? <LoaderCircle size={18} className="mt-2 animate-spin text-slate-300" /> : null}
      </div>
      <p className="mt-5 text-3xl font-bold tracking-tight text-[#233A59]">{loading ? "—" : value}</p>
      <p className="mt-1 font-semibold text-slate-800">{label}</p>
      <p className="mt-1 text-sm leading-5 text-slate-500">{hint}</p>
    </article>
  );
}

function MetricBar({ label, value, total, display, tone = "bg-[#233A59]" }: {
  label: string;
  value: number;
  total: number;
  display?: string;
  tone?: string;
}) {
  const width = total > 0 ? Math.max(value > 0 ? 4 : 0, Math.min(100, (value / total) * 100)) : 0;
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-semibold text-slate-700">{label}</span>
        <span className="font-bold text-[#233A59]">{display ?? number(value)}</span>
      </div>
      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full transition-all duration-500 ${tone}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

type MobileAdminMetrics = {
  visits: number;
  uniqueVisitors: number;
  collected: number;
  paymentCount: number;
  newPatients: number;
  totalPatients: number;
  billed: number;
  invoiceCount: number;
  outstanding: number;
  collectionRate: number;
  todayAppointments: number;
  requestedToday: number;
  inClinicToday: number;
  completedToday: number;
  openTasks: number;
  overdueTasks: number;
  urgentTasks: number;
  activeLabs: number;
  urgentLabs: number;
  outstandingInvoices: number;
  totalOutstanding: number;
  nextAppointment: {
    id: string;
    patientName: string;
    doctorName: string;
    preferredTime: string;
    status: AppointmentStatus;
  } | null;
  doctorMetrics: Array<{
    doctorName: string;
    visits: number;
    uniquePatients: number;
    billed: number;
    collected: number;
  }>;
};

function MobileAdminDashboard({
  metrics,
  range,
  loading,
  error,
  coverageMessage,
  lastUpdated,
  onRangeChange,
  onRefresh,
}: {
  metrics: MobileAdminMetrics;
  range: DashboardRange;
  loading: boolean;
  error: string;
  coverageMessage: string;
  lastUpdated: Date | null;
  onRangeChange: (range: DashboardRange) => void;
  onRefresh: () => void;
}) {
  const quickActions = [
    { href: "/admin/patients", label: "Register a patient", detail: "Create visit, fee and documents", icon: UserRoundCheck, tone: "bg-[#fff6d9] text-amber-950" },
    { href: "/admin/appointments", label: "Manage appointments", detail: "Confirm today’s clinic schedule", icon: CalendarCheck2, tone: "bg-blue-50 text-blue-950" },
    { href: "/admin/billing", label: "Collect a payment", detail: "Open QR, receipt and balances", icon: IndianRupee, tone: "bg-emerald-50 text-emerald-950" },
    { href: "/admin/consultations", label: "Doctor workspace", detail: "Open consultation and prescription tools", icon: Stethoscope, tone: "bg-violet-50 text-violet-950" },
  ];
  const summary = [
    { label: "Patients", value: number(metrics.visits), hint: `${number(metrics.uniqueVisitors)} unique`, icon: UserRoundCheck, tone: "bg-blue-50 text-blue-700" },
    { label: "Collected", value: money(metrics.collected), hint: `${number(metrics.paymentCount)} payments`, icon: IndianRupee, tone: "bg-emerald-50 text-emerald-700" },
    { label: "New patients", value: number(metrics.newPatients), hint: `${number(metrics.totalPatients)} total`, icon: UsersRound, tone: "bg-violet-50 text-violet-700" },
    { label: "Balance due", value: money(metrics.outstanding), hint: `${metrics.collectionRate.toFixed(0)}% collected`, icon: WalletCards, tone: "bg-rose-50 text-rose-700" },
  ];
  const priorities = [
    {
      href: "/admin/appointments?date=today&status=requested",
      label: "Booking requests",
      value: metrics.requestedToday,
      hint: metrics.requestedToday === 1 ? "Needs confirmation" : "Need confirmation",
      icon: CalendarCheck2,
      tone: "bg-amber-50 text-amber-800 ring-amber-200",
    },
    {
      href: "/admin/tasks?date=overdue&status=open",
      label: "Overdue tasks",
      value: metrics.overdueTasks,
      hint: metrics.urgentTasks > 0 ? `${number(metrics.urgentTasks)} urgent flagged` : "No urgent flags",
      icon: ListTodo,
      tone: "bg-rose-50 text-rose-800 ring-rose-200",
    },
    {
      href: "/admin/lab?priority=urgent",
      label: "Urgent labs",
      value: metrics.urgentLabs,
      hint: `${number(metrics.activeLabs)} active orders`,
      icon: FlaskConical,
      tone: "bg-violet-50 text-violet-800 ring-violet-200",
    },
    {
      href: "/admin/billing?status=due",
      label: "Balances due",
      value: metrics.outstandingInvoices,
      hint: money(metrics.totalOutstanding),
      icon: WalletCards,
      tone: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    },
  ];

  return (
    <div className="admin-mobile-dashboard space-y-4 xl:hidden">
      <section className="relative overflow-hidden rounded-[32px] bg-[#071f33] p-6 text-white shadow-xl">
        <div className="absolute -right-16 -top-20 h-48 w-48 rounded-full bg-[#d4a75f]/20 blur-3xl" />
        <div className="relative">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#e9c879]">Asher management</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight">Clinic at a glance.</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-white/70">Your essential clinic activity and fastest staff actions, designed for a phone.</p>
          <div className="mt-6 grid grid-cols-2 gap-3">
            <Link href="/admin/patients" className="flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-[#d4a75f] px-3 text-sm font-bold text-[#071f33]"><UserRoundCheck size={18} />New patient</Link>
            <Link href="/admin/appointments" className="flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-white/10 px-3 text-sm font-bold text-white ring-1 ring-white/15"><CalendarCheck2 size={18} />Bookings</Link>
          </div>
        </div>
      </section>

      <section className="rounded-[30px] bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#A8864A]">Today&apos;s action centre</p>
            <h2 className="mt-1 text-xl font-bold text-[#233A59]">Handle what needs attention</h2>
          </div>
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#233A59] text-white"><Clock3 size={20} /></span>
        </div>

        {metrics.nextAppointment ? (
          <Link href="/admin/appointments?date=today" prefetch={false} className="mt-4 flex items-center gap-3 rounded-2xl bg-[#071f33] p-4 text-white transition active:scale-[0.99]">
            <span className="grid h-12 min-w-16 shrink-0 place-items-center rounded-2xl bg-[#d4a75f] px-2 text-xs font-black text-[#071f33]">
              {formatAppointmentTime(metrics.nextAppointment.preferredTime).replace(" ", "\u00a0")}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-bold uppercase tracking-[0.14em] text-[#e9c879]">Next appointment</span>
              <span className="mt-1 block truncate font-bold">{metrics.nextAppointment.patientName || "Patient"}</span>
              <span className="mt-0.5 block truncate text-xs text-white/65">{metrics.nextAppointment.doctorName} · {appointmentStatusLabel(metrics.nextAppointment.status)}</span>
            </span>
            <ArrowRight className="shrink-0 text-white/70" size={19} />
          </Link>
        ) : (
          <div className="mt-4 flex items-center gap-3 rounded-2xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
            <CheckCircle2 className="shrink-0" size={20} />No upcoming appointment remains today.
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-3">
          {priorities.map((priority) => {
            const Icon = priority.icon;
            return (
              <Link key={priority.href} href={priority.href} prefetch={false} className={`min-h-32 rounded-2xl p-4 ring-1 transition active:scale-[0.98] ${priority.tone}`}>
                <div className="flex items-start justify-between gap-2">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/80"><Icon size={18} /></span>
                  <ArrowRight className="mt-1 opacity-50" size={17} />
                </div>
                <p className="mt-3 text-2xl font-black tracking-tight">{loading ? "—" : number(priority.value)}</p>
                <p className="mt-0.5 text-xs font-bold">{priority.label}</p>
                <p className="mt-1 truncate text-[11px] opacity-65">{priority.hint}</p>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="rounded-[30px] border border-amber-200/70 bg-[#fff9e8] p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Performance</p><h2 className="mt-1 text-xl font-bold text-[#233A59]">{rangeLabel(range)} summary</h2></div>
          <button type="button" onClick={onRefresh} disabled={loading} aria-label="Refresh clinic summary" className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white text-[#233A59] shadow-sm ring-1 ring-amber-200 disabled:opacity-50">{loading ? <LoaderCircle className="animate-spin" size={18} /> : <RefreshCw size={18} />}</button>
        </div>
        <div className="mt-4 grid grid-cols-3 rounded-2xl bg-white/80 p-1 ring-1 ring-amber-200/70">
          {(["today", "month", "all"] as DashboardRange[]).map((option) => <button key={option} type="button" onClick={() => onRangeChange(option)} aria-pressed={range === option} className={`min-h-10 rounded-xl px-2 text-xs font-bold ${range === option ? "bg-[#233A59] text-white" : "text-slate-600"}`}>{rangeLabel(option)}</button>)}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          {summary.map((item) => { const Icon = item.icon; return <article key={item.label} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5"><span className={`grid h-10 w-10 place-items-center rounded-xl ${item.tone}`}><Icon size={19} /></span><p className="mt-4 text-xl font-bold tracking-tight text-[#233A59]">{loading ? "—" : item.value}</p><p className="mt-1 text-sm font-bold text-slate-800">{item.label}</p><p className="mt-1 text-xs text-slate-500">{item.hint}</p></article>; })}
        </div>
        <p className="mt-4 text-xs text-slate-500">{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : "Loading live clinic records…"}</p>
      </section>

      {error ? <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700"><AlertCircle size={19} className="mt-0.5 shrink-0" />{error}</div> : null}
      {coverageMessage ? <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900"><ShieldAlert size={19} className="mt-0.5 shrink-0" /><p>{coverageMessage}</p></div> : null}

      <section className="space-y-3">
        <div className="px-1"><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#A8864A]">One-tap workflow</p><h2 className="mt-1 text-2xl font-bold text-[#233A59]">What would you like to do?</h2></div>
        {quickActions.map((action) => { const Icon = action.icon; return <Link key={action.href} href={action.href} className={`flex min-h-28 items-center gap-4 rounded-[28px] p-5 shadow-sm ring-1 ring-black/5 transition active:scale-[0.99] ${action.tone}`}><span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/75 shadow-sm"><Icon size={25} /></span><span className="min-w-0 flex-1"><span className="block text-lg font-bold">{action.label}</span><span className="mt-1 block text-sm leading-5 opacity-65">{action.detail}</span></span><ArrowRight className="shrink-0" size={20} /></Link>; })}
      </section>

      <section className="rounded-[30px] bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#A8864A]">Doctor-wise</p><h2 className="mt-1 text-xl font-bold text-[#233A59]">Visits and collections</h2></div><Stethoscope className="text-[#A8864A]" size={24} /></div>
        <div className="mt-4 space-y-3">
          {metrics.doctorMetrics.map((doctor) => <article key={doctor.doctorName} className="rounded-2xl bg-slate-50 p-4"><p className="font-bold text-[#233A59]">{doctor.doctorName}</p><div className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><p className="text-xl font-bold text-[#233A59]">{number(doctor.visits)}</p><p className="text-xs text-slate-500">Visits</p></div><div><p className="text-xl font-bold text-emerald-700">{money(doctor.collected)}</p><p className="text-xs text-slate-500">Collected</p></div></div></article>)}
        </div>
      </section>

      <section className="rounded-[30px] bg-[#233A59] p-5 text-white shadow-lg">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#D4B678]">Today at the clinic</p>
        <h2 className="mt-1 text-xl font-bold">Operational pulse</h2>
        <div className="mt-5 grid grid-cols-2 gap-3">
          {[ ["Appointments", metrics.todayAppointments], ["In clinic", metrics.inClinicToday], ["Completed", metrics.completedToday], ["Lab orders", metrics.activeLabs] ].map(([label, value]) => <div key={String(label)} className="rounded-2xl bg-white/10 p-4"><p className="text-2xl font-bold">{number(Number(value))}</p><p className="mt-1 text-xs font-semibold text-white/65">{label}</p></div>)}
        </div>
      </section>
    </div>
  );
}

function AdminDashboard() {
  const [data, setData] = useState<DashboardData>(emptyData);
  const [range, setRange] = useState<DashboardRange>("month");
  const [refreshToken, setRefreshToken] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const today = clinicDateKey();

  function refresh() {
    setLoading(true);
    setError("");
    setRefreshToken((value) => value + 1);
  }

  function changeRange(nextRange: DashboardRange) {
    if (nextRange === range) return;
    setLoading(true);
    setError("");
    setRange(nextRange);
  }

  useEffect(() => {
    let active = true;

    void fetchDashboardData(range, today)
      .then((nextData) => {
        if (!active) return;
        setData(nextData);
        setLastUpdated(new Date());
      })
      .catch((loadError) => {
        console.error(loadError);
        if (active) setError("The management dashboard could not be refreshed. Please check the connection and try again.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [range, refreshToken, today]);

  const analytics = useMemo(() => {
    const patientsById = new Map(data.patients.map((patient) => [patient.id, patient]));
    const patientsByPhone = new Map(
      data.patients
        .filter((patient) => normalisePhone(patient.phone))
        .map((patient) => [normalisePhone(patient.phone), patient]),
    );
    const events = new Map<string, VisitEvent>();

    data.patients.forEach((patient) => {
      const date = timestampDateKey(patient.createdAt);
      if (!date) return;
      const doctorName = patient.doctorName || "Unassigned";
      const key = `${patient.id}:${date}:${doctorName}`;
      events.set(key, { key, date, doctorName, patientId: patient.id });
    });

    data.visits.forEach((visit) => {
      if (!visit.visitDate) return;
      const doctorName = visit.doctorName || patientsById.get(visit.patientId)?.doctorName || "Unassigned";
      const key = `${visit.patientId || visit.id}:${visit.visitDate}:${doctorName}`;
      events.set(key, { key, date: visit.visitDate, doctorName, patientId: visit.patientId || visit.id });
    });

    data.appointments
      .filter((appointment) => appointment.status === "completed")
      .forEach((appointment) => {
        const matchedPatient = patientsByPhone.get(normalisePhone(appointment.phone));
        const doctorName = appointmentDoctor(appointment.doctorId);
        const patientId = matchedPatient?.id || `appointment-${normalisePhone(appointment.phone) || appointment.patientName.toLowerCase()}`;
        const key = `${patientId}:${appointment.preferredDate}:${doctorName}`;
        events.set(key, { key, date: appointment.preferredDate, doctorName, patientId });
      });

    const visitEvents = [...events.values()];
    const periodVisits = visitEvents.filter((visit) => matchesRange(visit.date, range, today));
    const periodPatients = data.patients.filter((patient) => matchesRange(timestampDateKey(patient.createdAt), range, today));
    const periodAppointments = data.appointments.filter((appointment) => matchesRange(appointment.preferredDate, range, today));
    const periodInvoices = data.invoices.filter((invoice) => matchesRange(timestampDateKey(invoice.createdAt), range, today));

    const fallbackPayments: PaymentRecord[] = data.invoices
      .filter((invoice) => Number(invoice.amountPaid || 0) > 0)
      .map((invoice) => ({
        id: `invoice-${invoice.id}`,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        patientId: invoice.patientId,
        patientName: invoice.patientName,
        amount: Number(invoice.amountPaid || 0),
        method: invoice.paymentMethod,
        status: "received",
        createdAt: invoice.paidAt || invoice.updatedAt || invoice.createdAt,
      }));
    const paymentRecords = data.paymentAuditAvailable ? data.payments : fallbackPayments;
    const receivedPayments = paymentRecords.filter((payment) => ["received", "refunded"].includes(payment.status));
    const periodPayments = receivedPayments.filter((payment) => matchesRange(timestampDateKey(payment.createdAt), range, today));

    const billed = periodInvoices.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0);
    const invoiceCollections = periodInvoices.reduce((sum, invoice) => sum + Number(invoice.amountPaid || 0), 0);
    const collected = periodPayments.reduce((sum, payment) => sum + netPaymentAmount(payment), 0);
    const outstanding = periodInvoices.reduce((sum, invoice) => sum + Number(invoice.balance || 0), 0);
    const collectionRate = billed > 0 ? Math.min(100, (invoiceCollections / billed) * 100) : 0;

    const methodTotals = new Map<string, number>();
    periodPayments.forEach((payment) => {
      methodTotals.set(payment.method, (methodTotals.get(payment.method) || 0) + netPaymentAmount(payment));
    });

    const doctorMetrics = [...doctors, "Unassigned / archived"].map((doctorName) => {
      const doctorVisits = periodVisits.filter((visit) => doctorBucket(visit.doctorName) === doctorName);
      const doctorInvoices = periodInvoices.filter((invoice) => doctorBucket(patientsById.get(invoice.patientId)?.doctorName) === doctorName);
      const doctorPayments = periodPayments.filter((payment) => doctorBucket(patientsById.get(payment.patientId)?.doctorName) === doctorName);
      return {
        doctorName,
        visits: doctorVisits.length,
        uniquePatients: new Set(doctorVisits.map((visit) => visit.patientId)).size,
        billed: doctorInvoices.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0),
        collected: doctorPayments.reduce((sum, payment) => sum + netPaymentAmount(payment), 0),
      };
    }).filter((doctor) => doctor.doctorName !== "Unassigned / archived" || doctor.visits > 0 || doctor.billed > 0 || doctor.collected > 0);

    const lastSevenDays = Array.from({ length: 7 }, (_, index) => {
      const date = new Date();
      date.setDate(date.getDate() - (6 - index));
      const key = clinicDateKey(date);
      return {
        key,
        label: new Intl.DateTimeFormat("en-IN", { weekday: "short", timeZone: "Asia/Kolkata" }).format(date),
        visits: visitEvents.filter((visit) => visit.date === key).length,
        collected: receivedPayments
          .filter((payment) => timestampDateKey(payment.createdAt) === key)
          .reduce((sum, payment) => sum + netPaymentAmount(payment), 0),
      };
    });

    const appointmentStatus = Object.fromEntries(
      APPOINTMENT_STATUSES.map((status) => [
        status,
        periodAppointments.filter((appointment) => appointment.status === status).length,
      ]),
    ) as Record<AppointmentStatus, number>;
    const openTasks = data.tasks.filter((task) => task.status === "open");
    const activeLabs = data.labs.filter((lab) => !["completed", "cancelled"].includes(lab.status));
    const todayActiveAppointments = data.appointments
      .filter((appointment) => appointment.preferredDate === today && ACTIVE_APPOINTMENT_STATUSES.has(appointment.status))
      .sort((left, right) => {
        const leftInClinic = IN_CLINIC_APPOINTMENT_STATUSES.has(left.status) ? 0 : 1;
        const rightInClinic = IN_CLINIC_APPOINTMENT_STATUSES.has(right.status) ? 0 : 1;
        if (leftInClinic !== rightInClinic) return leftInClinic - rightInClinic;
        return timeInMinutes(left.preferredTime) - timeInMinutes(right.preferredTime);
      });
    const nowMinutes = clinicTimeInMinutes();
    const nextAppointmentRecord = todayActiveAppointments.find((appointment) => IN_CLINIC_APPOINTMENT_STATUSES.has(appointment.status))
      ?? todayActiveAppointments.find((appointment) => {
        const appointmentMinutes = timeInMinutes(appointment.preferredTime);
        return Number.isFinite(appointmentMinutes) && appointmentMinutes >= nowMinutes;
      })
      ?? todayActiveAppointments[0]
      ?? null;
    const todayAppointments = data.appointments.filter((appointment) => appointment.preferredDate === today);
    const outstandingInvoices = data.outstandingInvoices;

    return {
      totalPatients: data.totalPatientCount,
      newPatients: range === "all" ? data.totalPatientCount : periodPatients.length,
      visits: periodVisits.length,
      uniqueVisitors: new Set(periodVisits.map((visit) => visit.patientId)).size,
      billed,
      collected,
      outstanding,
      collectionRate,
      periodInvoices,
      periodPayments,
      methodTotals: [...methodTotals.entries()].sort((left, right) => right[1] - left[1]),
      doctorMetrics,
      lastSevenDays,
      appointmentStatus,
      todayAppointments: todayAppointments.filter((appointment) => !["cancelled", "no_show"].includes(appointment.status)).length,
      requestedToday: todayAppointments.filter((appointment) => appointment.status === "requested").length,
      inClinicToday: todayAppointments.filter((appointment) => IN_CLINIC_APPOINTMENT_STATUSES.has(appointment.status)).length,
      completedToday: todayAppointments.filter((appointment) => appointment.status === "completed").length,
      openTasks: openTasks.length,
      overdueTasks: openTasks.filter((task) => task.dueDate && task.dueDate < today).length,
      urgentTasks: openTasks.filter((task) => task.priority === "urgent").length,
      activeLabs: activeLabs.length,
      urgentLabs: activeLabs.filter((lab) => lab.priority === "urgent").length,
      outstandingInvoices: outstandingInvoices.length,
      totalOutstanding: outstandingInvoices.reduce((sum, invoice) => sum + Number(invoice.balance || 0), 0),
      nextAppointment: nextAppointmentRecord ? {
        id: nextAppointmentRecord.id,
        patientName: nextAppointmentRecord.patientName,
        doctorName: appointmentDoctor(nextAppointmentRecord.doctorId),
        preferredTime: nextAppointmentRecord.preferredTime,
        status: nextAppointmentRecord.status,
      } : null,
      recentPayments: [...periodPayments]
        .sort((left, right) => (right.createdAt?.toMillis?.() ?? 0) - (left.createdAt?.toMillis?.() ?? 0))
        .slice(0, 5),
    };
  }, [data, range, today]);

  const maxDoctorVisits = Math.max(1, ...analytics.doctorMetrics.map((doctor) => doctor.visits));
  const maxMethodTotal = Math.max(1, ...analytics.methodTotals.map((entry) => entry[1]));
  const maxDailyVisits = Math.max(1, ...analytics.lastSevenDays.map((day) => day.visits));
  const appointmentTotal = Object.values(analytics.appointmentStatus).reduce((sum, value) => sum + value, 0);
  const coverageMessage = [
    data.limitedSources.length > 0
      ? `Safety limits were reached for ${data.limitedSources.join(", ")}. Those figures are partial; choose Today or This month for a complete focused view.`
      : "",
    data.unavailableSources.length > 0
      ? `Temporarily unavailable: ${data.unavailableSources.join(", ")}. Other dashboard sections remain live.`
      : "",
  ].filter(Boolean).join(" ");

  return (
    <>
      <MobileAdminDashboard
        metrics={{
          visits: analytics.visits,
          uniqueVisitors: analytics.uniqueVisitors,
          collected: analytics.collected,
          paymentCount: analytics.periodPayments.length,
          newPatients: analytics.newPatients,
          totalPatients: analytics.totalPatients,
          billed: analytics.billed,
          invoiceCount: analytics.periodInvoices.length,
          outstanding: analytics.outstanding,
          collectionRate: analytics.collectionRate,
          todayAppointments: analytics.todayAppointments,
          requestedToday: analytics.requestedToday,
          inClinicToday: analytics.inClinicToday,
          completedToday: analytics.completedToday,
          openTasks: analytics.openTasks,
          overdueTasks: analytics.overdueTasks,
          urgentTasks: analytics.urgentTasks,
          activeLabs: analytics.activeLabs,
          urgentLabs: analytics.urgentLabs,
          outstandingInvoices: analytics.outstandingInvoices,
          totalOutstanding: analytics.totalOutstanding,
          nextAppointment: analytics.nextAppointment,
          doctorMetrics: analytics.doctorMetrics,
        }}
        range={range}
        loading={loading}
        error={error}
        coverageMessage={coverageMessage}
        lastUpdated={lastUpdated}
        onRangeChange={changeRange}
        onRefresh={refresh}
      />
      <div className="admin-desktop-dashboard hidden xl:block">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.16em] text-[#A8864A]">
            <ShieldCheck size={17} /> Admin-only management dashboard
          </div>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-[#233A59] sm:text-4xl">Clinic performance at a glance</h1>
          <p className="mt-3 max-w-3xl text-slate-600">Patients, consultations, collections, doctor activity, pending work, and daily operations in one secure view.</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="inline-flex rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200" aria-label="Dashboard reporting period">
            {(["today", "month", "all"] as DashboardRange[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => changeRange(option)}
                aria-pressed={range === option}
                className={`min-h-10 rounded-lg px-3 text-sm font-bold transition ${range === option ? "bg-[#233A59] text-white shadow-sm" : "text-slate-600 hover:bg-slate-50"}`}
              >
                {rangeLabel(option)}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-[#233A59] shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? <LoaderCircle size={17} className="animate-spin" /> : <RefreshCw size={17} />}
            Refresh
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-500">
        <span className="rounded-full bg-[#233A59]/5 px-3 py-1.5 font-bold text-[#233A59]">Reporting: {rangeLabel(range)}</span>
        {lastUpdated ? <span>Updated {lastUpdated.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span> : null}
        {!data.paymentAuditAvailable ? <span className="font-semibold text-amber-700">Payment totals are using invoice fallback data.</span> : null}
        {!data.visitRecordsAvailable ? <span className="font-semibold text-amber-700">Clinical visit records are temporarily unavailable.</span> : null}
      </div>

      {error ? (
        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm font-semibold text-red-700">
          <AlertCircle size={19} className="mt-0.5 shrink-0" />{error}
        </div>
      ) : null}
      {coverageMessage ? (
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm leading-6 text-amber-900">
          <ShieldAlert size={19} className="mt-0.5 shrink-0" /><p>{coverageMessage}</p>
        </div>
      ) : null}

      <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <KpiCard loading={loading} label="Patients visited" value={number(analytics.visits)} hint={`${number(analytics.uniqueVisitors)} unique patients`} icon={UserRoundCheck} tone="bg-blue-50 text-blue-700" />
        <KpiCard loading={loading} label="Payments collected" value={money(analytics.collected)} hint={`${number(analytics.periodPayments.length)} payment entries`} icon={IndianRupee} tone="bg-emerald-50 text-emerald-700" />
        <KpiCard loading={loading} label="New patients" value={number(analytics.newPatients)} hint={`${number(analytics.totalPatients)} total registered`} icon={UsersRound} tone="bg-violet-50 text-violet-700" />
        <KpiCard loading={loading} label="Fees billed" value={money(analytics.billed)} hint={`${number(analytics.periodInvoices.length)} invoices created`} icon={Banknote} tone="bg-amber-50 text-amber-700" />
        <KpiCard loading={loading} label="Balance due" value={money(analytics.outstanding)} hint="Outstanding on selected invoices" icon={WalletCards} tone="bg-rose-50 text-rose-700" />
        <KpiCard loading={loading} label="Collection rate" value={`${analytics.collectionRate.toFixed(0)}%`} hint="Received against selected invoices" icon={TrendingUp} tone="bg-cyan-50 text-cyan-700" />
      </section>

      <section className="mt-6 grid gap-5 2xl:grid-cols-[1.35fr_0.65fr]">
        <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#A8864A]">Doctor-wise performance</p>
              <h2 className="mt-1 text-xl font-bold text-[#233A59]">Patient visits and fee collection</h2>
            </div>
            <Stethoscope className="text-[#A8864A]" size={27} />
          </div>
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            {analytics.doctorMetrics.map((doctor, index) => (
              <article key={doctor.doctorName} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-bold text-[#233A59]">{doctor.doctorName}</p>
                    <p className="mt-1 text-xs text-slate-500">{doctor.doctorName === doctors[0] ? "Pediatrics" : doctor.doctorName === doctors[1] ? "Obstetrics & Gynaecology" : "Historical or unassigned records"}</p>
                  </div>
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-[#233A59] shadow-sm"><Stethoscope size={19} /></span>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-white p-3"><p className="text-2xl font-bold text-[#233A59]">{number(doctor.visits)}</p><p className="mt-1 text-xs font-semibold text-slate-500">Patient visits</p></div>
                  <div className="rounded-xl bg-white p-3"><p className="text-2xl font-bold text-[#233A59]">{number(doctor.uniquePatients)}</p><p className="mt-1 text-xs font-semibold text-slate-500">Unique patients</p></div>
                </div>
                <div className="mt-4 space-y-3">
                  <MetricBar label="Share of visits" value={doctor.visits} total={maxDoctorVisits} display={number(doctor.visits)} tone={index === 0 ? "bg-blue-600" : index === 1 ? "bg-violet-600" : "bg-slate-500"} />
                  <div className="flex items-center justify-between border-t border-slate-200 pt-3 text-sm"><span className="text-slate-500">Fees billed</span><strong className="text-[#233A59]">{money(doctor.billed)}</strong></div>
                  <div className="flex items-center justify-between text-sm"><span className="text-slate-500">Collected</span><strong className="text-emerald-700">{money(doctor.collected)}</strong></div>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="rounded-3xl bg-[#233A59] p-5 text-white shadow-lg shadow-[#233A59]/10 sm:p-7">
          <div className="flex items-center justify-between">
            <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#D4B678]">Today at the clinic</p><h2 className="mt-1 text-xl font-bold">Operational pulse</h2></div>
            <CalendarCheck2 className="text-[#D4B678]" size={28} />
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-white/10 p-4"><p className="text-3xl font-bold">{number(analytics.todayAppointments)}</p><p className="mt-1 text-xs font-semibold text-white/70">Appointments today</p></div>
            <div className="rounded-2xl bg-white/10 p-4"><p className="text-3xl font-bold">{number(analytics.inClinicToday)}</p><p className="mt-1 text-xs font-semibold text-white/70">Patients in clinic</p></div>
            <div className="rounded-2xl bg-white/10 p-4"><p className="text-3xl font-bold">{number(analytics.completedToday)}</p><p className="mt-1 text-xs font-semibold text-white/70">Completed today</p></div>
            <div className="rounded-2xl bg-white/10 p-4"><p className="text-3xl font-bold">{number(analytics.activeLabs)}</p><p className="mt-1 text-xs font-semibold text-white/70">Active lab orders</p></div>
          </div>
          <div className="mt-5 space-y-2 text-sm">
            {analytics.urgentLabs > 0 ? <p className="flex items-center gap-2 rounded-xl bg-red-400/15 px-3 py-2 font-semibold text-red-100"><AlertCircle size={16} />{analytics.urgentLabs} urgent lab order{analytics.urgentLabs === 1 ? "" : "s"}</p> : null}
            {analytics.urgentTasks > 0 ? <p className="flex items-center gap-2 rounded-xl bg-amber-300/15 px-3 py-2 font-semibold text-amber-100"><Clock3 size={16} />{analytics.urgentTasks} urgent staff task{analytics.urgentTasks === 1 ? "" : "s"}</p> : null}
          </div>
          <Link href="/admin/appointments" className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-bold text-[#233A59] transition hover:bg-[#F8F4EA]">Open appointment desk <ArrowRight size={16} /></Link>
        </div>
      </section>

      <section className="mt-6 grid gap-5 xl:grid-cols-3">
        <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-7">
          <div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#A8864A]">Last 7 days</p><h2 className="mt-1 text-xl font-bold text-[#233A59]">Visit trend</h2></div><TrendingUp size={25} className="text-emerald-600" /></div>
          <div className="mt-7 flex h-44 items-end justify-between gap-2" aria-label="Patient visits during the last seven days">
            {analytics.lastSevenDays.map((day) => {
              const height = day.visits > 0 ? Math.max(18, (day.visits / maxDailyVisits) * 100) : 5;
              return (
                <div key={day.key} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
                  <span className="text-xs font-bold text-[#233A59]">{day.visits}</span>
                  <div className="w-full max-w-8 rounded-t-lg bg-gradient-to-t from-[#233A59] to-[#5B7698]" style={{ height: `${height}%` }} title={`${day.visits} visits · ${money(day.collected)} collected`} />
                  <span className="text-[11px] font-semibold text-slate-500">{day.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-7">
          <div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#A8864A]">Collections</p><h2 className="mt-1 text-xl font-bold text-[#233A59]">Payment methods</h2></div><CreditCard size={25} className="text-[#A8864A]" /></div>
          <div className="mt-6 space-y-5">
            {analytics.methodTotals.map(([method, total], index) => (
              <MetricBar key={method} label={paymentMethodLabel(method)} value={total} total={maxMethodTotal} display={money(total)} tone={index === 0 ? "bg-emerald-600" : index === 1 ? "bg-blue-600" : "bg-[#A8864A]"} />
            ))}
            {!loading && analytics.methodTotals.length === 0 ? <p className="rounded-2xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">No payments in this period.</p> : null}
          </div>
        </div>

        <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-7">
          <div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#A8864A]">Bookings</p><h2 className="mt-1 text-xl font-bold text-[#233A59]">Appointment status</h2></div><CalendarCheck2 size={25} className="text-blue-600" /></div>
          <div className="mt-6 space-y-5">
            {APPOINTMENT_STATUS_OPTIONS.map((status) => (
              <MetricBar
                key={status.value}
                label={status.label}
                value={analytics.appointmentStatus[status.value]}
                total={appointmentTotal}
                tone={APPOINTMENT_STATUS_TONES[status.value]}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="mt-6 grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#A8864A]">Financial activity</p><h2 className="mt-1 text-xl font-bold text-[#233A59]">Recent payments</h2></div><Link href="/admin/billing" className="inline-flex items-center gap-1 text-sm font-bold text-[#233A59] hover:text-[#A8864A]">Open billing <ArrowRight size={15} /></Link></div>
          <div className="mt-5 divide-y divide-slate-100">
            {analytics.recentPayments.map((payment) => (
              <article key={payment.id} className="flex flex-col gap-2 py-4 first:pt-0 sm:flex-row sm:items-center sm:justify-between">
                <div><p className="font-bold text-slate-800">{payment.patientName || "Clinic payment"}</p><p className="mt-1 text-xs text-slate-500">{payment.invoiceNumber || "Invoice"} · {paymentMethodLabel(payment.method)}</p></div>
                <div className="sm:text-right"><p className="font-bold text-emerald-700">{money(netPaymentAmount(payment))}</p><p className="mt-1 text-xs text-slate-500">{timestampDateKey(payment.createdAt) || "Recently"}</p></div>
              </article>
            ))}
            {!loading && analytics.recentPayments.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">No payment activity in this period.</p> : null}
          </div>
        </div>

        <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-7">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#A8864A]">Management shortcuts</p>
          <h2 className="mt-1 text-xl font-bold text-[#233A59]">Act on what matters</h2>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <Link href="/admin/patients" className="flex items-center justify-between rounded-2xl bg-blue-50 p-4 font-bold text-blue-800 transition hover:bg-blue-100"><span className="flex items-center gap-3"><UsersRound size={21} />Patient register</span><ArrowRight size={17} /></Link>
            <Link href="/admin/billing" className="flex items-center justify-between rounded-2xl bg-emerald-50 p-4 font-bold text-emerald-800 transition hover:bg-emerald-100"><span className="flex items-center gap-3"><IndianRupee size={21} />Billing & receipts</span><ArrowRight size={17} /></Link>
            <Link href="/admin/lab" className="flex items-center justify-between rounded-2xl bg-violet-50 p-4 font-bold text-violet-800 transition hover:bg-violet-100"><span className="flex items-center gap-3"><FlaskConical size={21} />Laboratory desk</span><ArrowRight size={17} /></Link>
            <Link href="/admin/tasks" className="flex items-center justify-between rounded-2xl bg-amber-50 p-4 font-bold text-amber-800 transition hover:bg-amber-100"><span className="flex items-center gap-3"><ListTodo size={21} />Tasks & follow-ups</span><ArrowRight size={17} /></Link>
            <Link href="/admin/staff" className="flex items-center justify-between rounded-2xl bg-slate-100 p-4 font-bold text-[#233A59] transition hover:bg-slate-200"><span className="flex items-center gap-3"><UserRoundCog size={21} />Staff access</span><ArrowRight size={17} /></Link>
          </div>
        </div>
      </section>

      <p className="mt-5 flex items-center gap-2 text-xs leading-5 text-slate-500"><CheckCircle2 size={15} className="shrink-0 text-emerald-600" />Doctor-wise collections are attributed using each patient’s assigned consulting doctor. Visit totals combine registrations, completed appointments, and clinical visit entries without counting the same patient twice on the same day with the same doctor.</p>
      </div>
    </>
  );
}

function DashboardAccess() {
  const { profile } = useStaff();
  return profile.role === "admin"
    ? <AdminDashboard />
    : <StaffAppHome role={profile.role} displayName={profile.displayName} />;
}

export default function AdminPage() {
  return <DashboardAccess />;
}
