"use client";

import AdminShell from "@/components/admin/AdminShell";
import { useStaff } from "@/components/admin/StaffGuard";
import { firestore } from "@/firebase/config";
import {
  collection,
  collectionGroup,
  getDocs,
  type QueryDocumentSnapshot,
  type Timestamp,
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
  status: "requested" | "confirmed" | "completed" | "cancelled";
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
  method: string;
  status: string;
  createdAt?: Timestamp;
};

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
  payments: PaymentRecord[];
  visits: VisitRecord[];
  labs: LabRecord[];
  tasks: TaskRecord[];
  paymentAuditAvailable: boolean;
  visitRecordsAvailable: boolean;
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
  payments: [],
  visits: [],
  labs: [],
  tasks: [],
  paymentAuditAvailable: true,
  visitRecordsAvailable: true,
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

function mapDocuments<T extends { id: string }>(documents: QueryDocumentSnapshot[]) {
  return documents.map((item) => ({ id: item.id, ...item.data() }) as T);
}

async function fetchDashboardData(): Promise<DashboardData> {
  if (!firestore) throw new Error("Firebase is not configured for this environment.");

  const [patients, appointments, invoices, labs, tasks, paymentsResult, visitsResult] = await Promise.all([
    getDocs(collection(firestore, "patients")),
    getDocs(collection(firestore, "appointments")),
    getDocs(collection(firestore, "invoices")),
    getDocs(collection(firestore, "labOrders")),
    getDocs(collection(firestore, "staffTasks")),
    getDocs(collectionGroup(firestore, "payments")).catch((error) => {
      console.error("Dashboard payment audit could not be loaded", error);
      return null;
    }),
    getDocs(collectionGroup(firestore, "visits")).catch((error) => {
      console.error("Dashboard clinical visits could not be loaded", error);
      return null;
    }),
  ]);

  const visitRecords = visitsResult
    ? visitsResult.docs.map((item) => ({
        id: item.id,
        patientId: item.ref.parent.parent?.id ?? "",
        ...item.data(),
      }) as VisitRecord)
    : [];

  return {
    patients: mapDocuments<PatientRecord>(patients.docs),
    appointments: mapDocuments<AppointmentRecord>(appointments.docs),
    invoices: mapDocuments<InvoiceRecord>(invoices.docs),
    payments: paymentsResult ? mapDocuments<PaymentRecord>(paymentsResult.docs) : [],
    visits: visitRecords,
    labs: mapDocuments<LabRecord>(labs.docs),
    tasks: mapDocuments<TaskRecord>(tasks.docs),
    paymentAuditAvailable: paymentsResult !== null,
    visitRecordsAvailable: visitsResult !== null,
  };
}

function AdminOnlyMessage() {
  return (
    <section className="mx-auto max-w-2xl rounded-3xl border border-amber-200 bg-white p-7 text-center shadow-sm sm:p-10">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-amber-50 text-amber-700">
        <ShieldAlert size={28} />
      </span>
      <p className="mt-6 text-xs font-bold uppercase tracking-[0.18em] text-[#A8864A]">Administrator access</p>
      <h1 className="mt-2 text-3xl font-bold text-[#233A59]">Management dashboard is private</h1>
      <p className="mx-auto mt-3 max-w-xl leading-7 text-slate-600">
        Financial totals and clinic-wide performance are available only to administrators. Your clinical and reception tools remain available below.
      </p>
      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <Link href="/admin/appointments" className="rounded-xl bg-[#233A59] px-5 py-3 text-sm font-bold text-white">Appointments</Link>
        <Link href="/admin/patients" className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-bold text-[#233A59]">Patients</Link>
      </div>
    </section>
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

function AdminDashboard() {
  const [data, setData] = useState<DashboardData>(emptyData);
  const [range, setRange] = useState<DashboardRange>("month");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const today = clinicDateKey();

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      setData(await fetchDashboardData());
      setLastUpdated(new Date());
    } catch (loadError) {
      console.error(loadError);
      setError("The management dashboard could not be refreshed. Please check the connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

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
    const receivedPayments = paymentRecords.filter((payment) => payment.status === "received");
    const periodPayments = receivedPayments.filter((payment) => matchesRange(timestampDateKey(payment.createdAt), range, today));

    const billed = periodInvoices.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0);
    const invoiceCollections = periodInvoices.reduce((sum, invoice) => sum + Number(invoice.amountPaid || 0), 0);
    const collected = periodPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const outstanding = periodInvoices.reduce((sum, invoice) => sum + Number(invoice.balance || 0), 0);
    const collectionRate = billed > 0 ? Math.min(100, (invoiceCollections / billed) * 100) : 0;

    const methodTotals = new Map<string, number>();
    periodPayments.forEach((payment) => {
      methodTotals.set(payment.method, (methodTotals.get(payment.method) || 0) + Number(payment.amount || 0));
    });

    const doctorMetrics = doctors.map((doctorName) => {
      const doctorVisits = periodVisits.filter((visit) => visit.doctorName === doctorName);
      const doctorInvoices = periodInvoices.filter((invoice) => patientsById.get(invoice.patientId)?.doctorName === doctorName);
      const doctorPayments = periodPayments.filter((payment) => patientsById.get(payment.patientId)?.doctorName === doctorName);
      return {
        doctorName,
        visits: doctorVisits.length,
        uniquePatients: new Set(doctorVisits.map((visit) => visit.patientId)).size,
        billed: doctorInvoices.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0),
        collected: doctorPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
      };
    });

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
          .reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
      };
    });

    const requested = periodAppointments.filter((appointment) => appointment.status === "requested").length;
    const confirmed = periodAppointments.filter((appointment) => appointment.status === "confirmed").length;
    const completed = periodAppointments.filter((appointment) => appointment.status === "completed").length;
    const cancelled = periodAppointments.filter((appointment) => appointment.status === "cancelled").length;
    const openTasks = data.tasks.filter((task) => task.status === "open");
    const activeLabs = data.labs.filter((lab) => !["completed", "cancelled"].includes(lab.status));

    return {
      totalPatients: data.patients.length,
      newPatients: periodPatients.length,
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
      appointmentStatus: { requested, confirmed, completed, cancelled },
      todayAppointments: data.appointments.filter((appointment) => appointment.preferredDate === today && appointment.status !== "cancelled").length,
      openTasks: openTasks.length,
      overdueTasks: openTasks.filter((task) => task.dueDate && task.dueDate < today).length,
      urgentTasks: openTasks.filter((task) => task.priority === "urgent").length,
      activeLabs: activeLabs.length,
      urgentLabs: activeLabs.filter((lab) => lab.priority === "urgent").length,
      recentPayments: [...periodPayments]
        .sort((left, right) => (right.createdAt?.toMillis?.() ?? 0) - (left.createdAt?.toMillis?.() ?? 0))
        .slice(0, 5),
    };
  }, [data, range, today]);

  const maxDoctorVisits = Math.max(1, ...analytics.doctorMetrics.map((doctor) => doctor.visits));
  const maxMethodTotal = Math.max(1, ...analytics.methodTotals.map((entry) => entry[1]));
  const maxDailyVisits = Math.max(1, ...analytics.lastSevenDays.map((day) => day.visits));
  const appointmentTotal = Object.values(analytics.appointmentStatus).reduce((sum, value) => sum + value, 0);

  return (
    <div>
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
                onClick={() => setRange(option)}
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
                    <p className="mt-1 text-xs text-slate-500">{index === 0 ? "Pediatrics" : "Obstetrics & Gynaecology"}</p>
                  </div>
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-[#233A59] shadow-sm"><Stethoscope size={19} /></span>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-white p-3"><p className="text-2xl font-bold text-[#233A59]">{number(doctor.visits)}</p><p className="mt-1 text-xs font-semibold text-slate-500">Patient visits</p></div>
                  <div className="rounded-xl bg-white p-3"><p className="text-2xl font-bold text-[#233A59]">{number(doctor.uniquePatients)}</p><p className="mt-1 text-xs font-semibold text-slate-500">Unique patients</p></div>
                </div>
                <div className="mt-4 space-y-3">
                  <MetricBar label="Share of visits" value={doctor.visits} total={maxDoctorVisits} display={number(doctor.visits)} tone={index === 0 ? "bg-blue-600" : "bg-violet-600"} />
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
            <div className="rounded-2xl bg-white/10 p-4"><p className="text-3xl font-bold">{number(analytics.openTasks)}</p><p className="mt-1 text-xs font-semibold text-white/70">Open tasks</p></div>
            <div className="rounded-2xl bg-white/10 p-4"><p className="text-3xl font-bold">{number(analytics.overdueTasks)}</p><p className="mt-1 text-xs font-semibold text-white/70">Overdue tasks</p></div>
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
            <MetricBar label="Requested" value={analytics.appointmentStatus.requested} total={appointmentTotal} tone="bg-amber-500" />
            <MetricBar label="Confirmed" value={analytics.appointmentStatus.confirmed} total={appointmentTotal} tone="bg-blue-600" />
            <MetricBar label="Completed" value={analytics.appointmentStatus.completed} total={appointmentTotal} tone="bg-emerald-600" />
            <MetricBar label="Cancelled" value={analytics.appointmentStatus.cancelled} total={appointmentTotal} tone="bg-slate-400" />
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
                <div className="sm:text-right"><p className="font-bold text-emerald-700">{money(payment.amount)}</p><p className="mt-1 text-xs text-slate-500">{timestampDateKey(payment.createdAt) || "Recently"}</p></div>
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
          </div>
        </div>
      </section>

      <p className="mt-5 flex items-center gap-2 text-xs leading-5 text-slate-500"><CheckCircle2 size={15} className="shrink-0 text-emerald-600" />Doctor-wise collections are attributed using each patient’s assigned consulting doctor. Visit totals combine registrations, completed appointments, and clinical visit entries without counting the same patient twice on the same day with the same doctor.</p>
    </div>
  );
}

function DashboardAccess() {
  const { profile } = useStaff();
  return profile.role === "admin" ? <AdminDashboard /> : <AdminOnlyMessage />;
}

export default function AdminPage() {
  return <AdminShell><DashboardAccess /></AdminShell>;
}
