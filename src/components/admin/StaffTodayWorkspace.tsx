"use client";

import { useStaff } from "@/components/admin/StaffGuard";
import { firestore } from "@/firebase/config";
import { formatAppointmentTime } from "@/lib/appointments";
import {
  stageAdminNavigationHandoff,
} from "@/lib/admin-navigation-handoff";
import {
  STAFF_TODAY_APPOINTMENT_LIMIT,
  STAFF_TODAY_TASK_LIMIT,
  appointmentTodayCounts,
  clinicDateInIndia,
  dueStaffTasks,
  operationalAppointments,
  staffDoctorId,
  urgentDoctorLabs,
  type StaffTodayAppointment,
  type StaffTodayLabOrder,
  type StaffTodayTask,
} from "@/lib/staff-today";
import {
  appointmentStatusLabel,
  appointmentStatusTone,
  queueTokenLabel,
} from "@/lib/visit-workflow";
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import {
  AlertCircle,
  ArrowRight,
  CalendarCheck2,
  CheckCircle2,
  ClipboardList,
  Clock3,
  FlaskConical,
  Hash,
  IndianRupee,
  ListTodo,
  LoaderCircle,
  Stethoscope,
  UserRoundCheck,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

const IN_CONSULTATION = "in_consultation";

function friendlyToday(value: string) {
  const date = new Date(`${value}T12:00:00+05:30`);
  return Number.isNaN(date.getTime())
    ? "Today"
    : date.toLocaleDateString("en-IN", {
        timeZone: "Asia/Kolkata",
        weekday: "long",
        day: "numeric",
        month: "long",
      });
}

function greeting() {
  const hour = Number(new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    hour12: false,
  }).format(new Date()));
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function doctorLabel(doctorId: string) {
  if (doctorId === "obg") return "Dr. Shaik Reshma";
  if (doctorId === "pediatrics") return "Dr. Lt Col Shafi Ahamad";
  return "Clinic doctor";
}

function taskTypeLabel(type: string) {
  return ({
    follow_up: "Follow-up",
    vaccination: "Vaccination",
    lab: "Lab",
    payment: "Payment",
    callback: "Callback",
    general: "Clinic task",
  } as Record<string, string>)[type] || "Clinic task";
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  tone,
  loading,
  unavailable = false,
  incomplete = false,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  tone: string;
  loading: boolean;
  unavailable?: boolean;
  incomplete?: boolean;
}) {
  const displayedValue = loading || unavailable
    ? "—"
    : incomplete
      ? `${value}+`
      : value;
  const displayedLabel = unavailable
    ? `${label} unavailable`
    : incomplete
      ? `${label} (partial)`
      : label;

  return (
    <article className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <span className={`grid h-10 w-10 place-items-center rounded-xl ${tone}`}><Icon aria-hidden="true" size={19} /></span>
      <p className="mt-4 text-2xl font-black tracking-tight text-[#233A59]">{displayedValue}</p>
      <p className="mt-1 text-xs font-bold text-slate-600">{displayedLabel}</p>
    </article>
  );
}

function LoadingRows() {
  return (
    <div className="space-y-3" aria-label="Loading today’s clinic work">
      {[0, 1, 2].map((item) => <div key={item} className="h-28 animate-pulse rounded-2xl bg-slate-100" />)}
    </div>
  );
}

function UnavailablePanel({
  message,
  href,
  action,
}: {
  message: string;
  href: string;
  action: string;
}) {
  return (
    <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
      <p className="flex items-start gap-2 text-sm font-semibold leading-6"><AlertCircle className="mt-0.5 shrink-0" size={17} />{message}</p>
      <Link href={href} prefetch={false} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-amber-900 px-4 text-sm font-bold text-white">{action}<ArrowRight size={15} /></Link>
    </div>
  );
}

export default function StaffTodayWorkspace() {
  const router = useRouter();
  const { user, profile } = useStaff();
  const role = profile.role === "doctor" ? "doctor" : "reception";
  const today = clinicDateInIndia();
  const doctorId = staffDoctorId(profile.doctorName);
  const [appointments, setAppointments] = useState<StaffTodayAppointment[]>([]);
  const [tasks, setTasks] = useState<StaffTodayTask[]>([]);
  const [labOrders, setLabOrders] = useState<StaffTodayLabOrder[]>([]);
  const [appointmentsLoading, setAppointmentsLoading] = useState(true);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [labsLoading, setLabsLoading] = useState(role === "doctor");
  const [labsTruncated, setLabsTruncated] = useState(false);
  const [appointmentsError, setAppointmentsError] = useState("");
  const [tasksError, setTasksError] = useState("");
  const [labsError, setLabsError] = useState("");

  useEffect(() => {
    if (!firestore) {
      const timer = window.setTimeout(() => {
        setAppointmentsLoading(false);
        setAppointmentsError("Today’s appointment queue is not connected.");
      }, 0);
      return () => window.clearTimeout(timer);
    }
    if (role === "doctor" && !doctorId) {
      const timer = window.setTimeout(() => {
        setAppointmentsLoading(false);
        setAppointmentsError("This login is not linked to a clinic doctor. Ask an administrator to update staff access.");
      }, 0);
      return () => window.clearTimeout(timer);
    }

    const appointmentsQuery = role === "doctor"
      ? query(
          collection(firestore, "appointments"),
          where("doctorId", "==", doctorId),
          where("preferredDate", "==", today),
          limit(STAFF_TODAY_APPOINTMENT_LIMIT),
        )
      : query(
          collection(firestore, "appointments"),
          where("preferredDate", "==", today),
          orderBy("preferredDate", "desc"),
          limit(STAFF_TODAY_APPOINTMENT_LIMIT),
        );

    return onSnapshot(appointmentsQuery, (snapshot) => {
      setAppointments(snapshot.docs.map((item) => ({
        id: item.id,
        ...(item.data() as Omit<StaffTodayAppointment, "id">),
      })));
      setAppointmentsError("");
      setAppointmentsLoading(false);
    }, (loadError) => {
      console.error("Staff Today appointments could not be loaded", loadError);
      setAppointments([]);
      setAppointmentsError("Today’s appointment queue could not be loaded. Open the appointment desk to retry.");
      setAppointmentsLoading(false);
    });
  }, [doctorId, role, today]);

  useEffect(() => {
    if (!firestore) {
      const timer = window.setTimeout(() => {
        setTasksLoading(false);
        setTasksError("Assigned tasks are not connected.");
      }, 0);
      return () => window.clearTimeout(timer);
    }

    const tasksQuery = query(
      collection(firestore, "staffTasks"),
      where("assignedTo", "==", profile.uid),
      where("status", "==", "open"),
      where("dueDate", "<=", today),
      orderBy("dueDate", "asc"),
      limit(STAFF_TODAY_TASK_LIMIT),
    );
    return onSnapshot(tasksQuery, (snapshot) => {
      setTasks(snapshot.docs.map((item) => ({
        id: item.id,
        ...(item.data() as Omit<StaffTodayTask, "id">),
      })));
      setTasksError("");
      setTasksLoading(false);
    }, (loadError) => {
      console.error("Staff Today tasks could not be loaded", loadError);
      setTasks([]);
      setTasksError("Assigned tasks could not be loaded. Open Tasks & follow-ups to retry.");
      setTasksLoading(false);
    });
  }, [profile.uid, today]);

  useEffect(() => {
    if (role !== "doctor") {
      const timer = window.setTimeout(() => {
        setLabOrders([]);
        setLabsLoading(false);
        setLabsTruncated(false);
        setLabsError("");
      }, 0);
      return () => window.clearTimeout(timer);
    }
    if (!profile.doctorName?.trim()) {
      const timer = window.setTimeout(() => {
        setLabsLoading(false);
        setLabsTruncated(false);
        setLabsError("This login is not linked to a clinic doctor.");
      }, 0);
      return () => window.clearTimeout(timer);
    }

    let active = true;
    const loadLabs = async () => {
      try {
        const idToken = await user.getIdToken();
        const response = await fetch("/api/staff/labs/directory", {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        const result = await response.json().catch(() => ({})) as {
          labOrders?: StaffTodayLabOrder[];
          truncated?: boolean;
          error?: string;
        };
        if (!response.ok) throw new Error(result.error || "The secure lab directory could not be loaded.");
        if (!active) return;
        setLabOrders(Array.isArray(result.labOrders) ? result.labOrders : []);
        setLabsTruncated(result.truncated === true);
        setLabsError("");
      } catch (loadError) {
        if (!active) return;
        console.error("Staff Today lab urgency could not be loaded", loadError);
        setLabOrders([]);
        setLabsTruncated(false);
        setLabsError("Urgent laboratory work could not be checked. Open the lab desk to retry.");
      } finally {
        if (active) setLabsLoading(false);
      }
    };

    void loadLabs();
    const refresh = () => void loadLabs();
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
    };
  }, [profile.doctorName, role, user]);

  const queue = useMemo(
    () => operationalAppointments(appointments, role),
    [appointments, role],
  );
  const counts = useMemo(() => appointmentTodayCounts(appointments), [appointments]);
  const dueTasks = useMemo(() => dueStaffTasks(tasks, today), [tasks, today]);
  const urgentLabs = useMemo(
    () => urgentDoctorLabs(labOrders, profile.doctorName || ""),
    [labOrders, profile.doctorName],
  );
  const firstName = profile.displayName.trim().split(/\s+/u)[0] || "team";
  const appointmentHref = role === "reception" && counts.requested > 0
    ? "/admin/appointments?date=today&status=requested"
    : "/admin/appointments?date=today";
  const summary = role === "doctor"
    ? [
        { label: "Waiting", value: counts.waiting, icon: Clock3, tone: "bg-violet-50 text-violet-700", source: "appointments" },
        { label: "With doctor", value: counts.consulting, icon: Stethoscope, tone: "bg-fuchsia-50 text-fuchsia-700", source: "appointments" },
        { label: "Completed", value: counts.completed, icon: CheckCircle2, tone: "bg-emerald-50 text-emerald-700", source: "appointments" },
        { label: "Urgent labs", value: urgentLabs.length, icon: FlaskConical, tone: "bg-rose-50 text-rose-700", source: "labs" },
      ]
    : [
        { label: "Requests", value: counts.requested, icon: CalendarCheck2, tone: "bg-amber-50 text-amber-700", source: "appointments" },
        { label: "Expected", value: counts.expected, icon: UsersRound, tone: "bg-blue-50 text-blue-700", source: "appointments" },
        { label: "In clinic", value: counts.inClinic, icon: UserRoundCheck, tone: "bg-violet-50 text-violet-700", source: "appointments" },
        { label: "Completed", value: counts.completed, icon: CheckCircle2, tone: "bg-emerald-50 text-emerald-700", source: "appointments" },
      ];

  function openDoctorAppointment(appointment: StaffTodayAppointment) {
    if (appointment.status === IN_CONSULTATION) {
      stageAdminNavigationHandoff({
        destination: "/admin/consultations",
        intent: "open-appointment-consultation",
        appointmentId: appointment.id,
      });
    }
    router.push("/admin/consultations");
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <section className="relative overflow-hidden rounded-[30px] bg-gradient-to-br from-[#102b43] via-[#233A59] to-[#315e7f] p-5 text-white shadow-xl sm:p-8">
        <div className="absolute -right-16 -top-20 h-52 w-52 rounded-full bg-[#d4b36f]/20 blur-3xl" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#efd393]">{role === "doctor" ? "Doctor today" : "Front desk today"}</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">{greeting()}, {firstName}.</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/75 sm:text-base">{friendlyToday(today)} · Live work requiring your attention, without searching through every desk.</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            {role === "reception" ? <Link href="/admin/reception" prefetch={false} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#d4b36f] px-4 text-sm font-bold text-[#102b43]"><UserRoundCheck size={18} />New arrival</Link> : <Link href="/admin/consultations" prefetch={false} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#d4b36f] px-4 text-sm font-bold text-[#102b43]"><Stethoscope size={18} />Doctor desk</Link>}
            <Link href="/admin/patients" prefetch={false} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-white/10 px-4 text-sm font-bold text-white ring-1 ring-white/15"><UsersRound size={18} />Patients</Link>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {summary.map((item) => {
          const labSummary = item.source === "labs";
          return (
            <SummaryCard
              key={item.label}
              {...item}
              loading={labSummary ? labsLoading : appointmentsLoading}
              unavailable={Boolean(labSummary ? labsError : appointmentsError)}
              incomplete={labSummary && labsTruncated}
            />
          );
        })}
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
        <section className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6" aria-labelledby="today-queue-title">
          <div className="flex items-start justify-between gap-3">
            <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#A8864A]">Live clinic flow</p><h2 id="today-queue-title" className="mt-1 text-xl font-bold text-[#233A59]">{role === "doctor" ? "Your patient queue" : "Today’s arrivals"}</h2></div>
            <Link href={role === "doctor" ? "/admin/consultations" : appointmentHref} prefetch={false} className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl bg-slate-100 px-3 text-xs font-bold text-[#233A59]">Open desk <ArrowRight size={15} /></Link>
          </div>

          <div className="mt-5">
            {appointmentsLoading ? <LoadingRows /> : appointmentsError ? (
              <UnavailablePanel message={appointmentsError} href={role === "doctor" ? "/admin/consultations" : appointmentHref} action={role === "doctor" ? "Open doctor desk" : "Open appointment desk"} />
            ) : queue.length === 0 ? (
              <div className="rounded-2xl bg-emerald-50 px-5 py-10 text-center ring-1 ring-emerald-100"><CheckCircle2 className="mx-auto text-emerald-600" size={32} /><p className="mt-3 font-bold text-emerald-900">No active patients in this queue</p><p className="mt-1 text-sm text-emerald-800">New arrivals and status changes will appear here automatically.</p></div>
            ) : (
              <div className="space-y-3">
                {queue.slice(0, 8).map((appointment) => {
                  const actionLabel = role === "doctor"
                    ? appointment.status === IN_CONSULTATION ? "Continue consultation" : "Open doctor queue"
                    : appointment.status === "requested" ? "Review request" : "Open visit";
                  return (
                    <article key={appointment.id} className="rounded-2xl border border-slate-200 p-4 transition hover:border-[#A8864A]">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="truncate font-bold text-[#233A59]">{appointment.patientName || "Patient"}</h3>
                            {appointment.queueToken ? <span className="inline-flex items-center gap-1 rounded-lg bg-[#233A59] px-2 py-1 text-[11px] font-black text-white"><Hash size={11} />{queueTokenLabel(appointment.queueToken, appointment.doctorId)}</span> : null}
                          </div>
                          <p className="mt-1 text-xs font-semibold text-slate-500">{formatAppointmentTime(appointment.preferredTime)} · {doctorLabel(appointment.doctorId)}</p>
                        </div>
                        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ${appointmentStatusTone(appointment.status)}`}>{appointmentStatusLabel(appointment.status)}</span>
                      </div>
                      {role === "doctor" ? (
                        <button type="button" onClick={() => openDoctorAppointment(appointment)} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#233A59] px-4 text-xs font-bold text-white"><Stethoscope size={15} />{actionLabel}</button>
                      ) : (
                        <Link href={appointment.status === "requested" ? "/admin/appointments?date=today&status=requested" : "/admin/appointments?date=today"} prefetch={false} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#233A59] px-4 text-xs font-bold text-white">{actionLabel}<ArrowRight size={15} /></Link>
                      )}
                    </article>
                  );
                })}
                {queue.length > 8 ? <Link href={role === "doctor" ? "/admin/consultations" : appointmentHref} prefetch={false} className="flex min-h-11 items-center justify-center rounded-xl bg-slate-100 px-4 text-sm font-bold text-[#233A59]">View {queue.length - 8} more active patient{queue.length - 8 === 1 ? "" : "s"}</Link> : null}
              </div>
            )}
          </div>
        </section>

        <div className="space-y-5">
          <section className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-slate-200" aria-labelledby="today-tasks-title">
            <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#A8864A]">Assigned to you</p><h2 id="today-tasks-title" className="mt-1 text-xl font-bold text-[#233A59]">Due follow-ups</h2></div><span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-amber-50 text-amber-700"><ListTodo size={20} /></span></div>
            <div className="mt-4">
              {tasksLoading ? <div className="flex min-h-24 items-center justify-center gap-2 text-sm font-semibold text-slate-500"><LoaderCircle className="animate-spin" size={17} />Loading assigned tasks…</div> : tasksError ? <UnavailablePanel message={tasksError} href="/admin/tasks?status=open" action="Open Tasks & follow-ups" /> : dueTasks.length === 0 ? <p className="rounded-2xl bg-emerald-50 p-4 text-sm font-semibold leading-6 text-emerald-800">No assigned task is overdue or due today.</p> : <div className="space-y-2">{dueTasks.slice(0, 4).map((task) => { const overdue = task.dueDate < today; return <Link key={task.id} href={overdue ? "/admin/tasks?date=overdue&status=open" : "/admin/tasks?date=today&status=open"} prefetch={false} className={`block rounded-2xl p-3 ring-1 ${overdue ? "bg-red-50 text-red-950 ring-red-200" : "bg-amber-50 text-amber-950 ring-amber-200"}`}><div className="flex items-start justify-between gap-2"><p className="text-sm font-bold leading-5">{task.title}</p><span className="shrink-0 text-[10px] font-black uppercase tracking-wide">{overdue ? "Overdue" : task.dueTime}</span></div><p className="mt-1 truncate text-xs opacity-65">{taskTypeLabel(task.type)}{task.patientName ? ` · ${task.patientName}` : ""}</p></Link>; })}</div>}
            </div>
            <Link href="/admin/tasks?status=open" prefetch={false} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-100 px-4 text-sm font-bold text-[#233A59]">Open all tasks <ArrowRight size={15} /></Link>
          </section>

          {role === "doctor" ? (
            <section className="rounded-[28px] bg-[#fff4f3] p-5 shadow-sm ring-1 ring-rose-200" aria-labelledby="urgent-labs-title">
              <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-rose-700">Clinical attention</p><h2 id="urgent-labs-title" className="mt-1 text-xl font-bold text-[#233A59]">Urgent laboratory work</h2></div><FlaskConical className="text-rose-700" size={24} /></div>
              {labsLoading ? <p className="mt-4 flex items-center gap-2 text-sm font-semibold text-slate-600"><LoaderCircle className="animate-spin" size={17} />Checking secure lab desk…</p> : labsError ? <div className="mt-4"><UnavailablePanel message={labsError} href="/admin/lab" action="Open lab desk" /></div> : (
                <div className="mt-4 space-y-3">
                  {labsTruncated ? <p role="status" className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold leading-6 text-amber-950"><AlertCircle className="mt-0.5 shrink-0" size={17} />This is a partial lab snapshot. More than 300 recent orders exist, so older urgent work may not appear here. Open the lab desk and do not treat this summary as all clear.</p> : null}
                  {urgentLabs.length === 0 ? (
                    labsTruncated ? null : <p className="rounded-2xl bg-white/70 p-4 text-sm font-semibold text-emerald-800 ring-1 ring-rose-100">No active urgent lab order is assigned to you.</p>
                  ) : <div className="space-y-2">{urgentLabs.slice(0, 3).map((order) => <Link key={order.id} href="/admin/lab" prefetch={false} className="block rounded-2xl bg-white p-3 ring-1 ring-rose-200"><div className="flex items-center justify-between gap-2"><p className="truncate text-sm font-bold text-[#233A59]">{order.patientName || "Patient"}</p><span className="shrink-0 rounded-full bg-rose-100 px-2 py-1 text-[10px] font-black uppercase text-rose-800">{order.status}</span></div><p className="mt-1 truncate text-xs text-slate-500">{order.orderNumber} · {order.tests?.length || 0} test{order.tests?.length === 1 ? "" : "s"}</p></Link>)}</div>}
                </div>
              )}
              <Link href="/admin/lab" prefetch={false} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-rose-700 px-4 text-sm font-bold text-white">Open lab desk <ArrowRight size={15} /></Link>
            </section>
          ) : (
            <section className="rounded-[28px] bg-[#233A59] p-5 text-white shadow-lg">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#D4B678]">Fast front desk</p><h2 className="mt-1 text-xl font-bold">Finish the visit in fewer steps</h2><p className="mt-3 text-sm leading-6 text-white/70">Express Reception keeps registration, consultation fee, manual collection, queue token, receipt and blank prescription together.</p>
              <div className="mt-4 grid grid-cols-2 gap-2"><Link href="/admin/reception" prefetch={false} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-white px-3 text-sm font-bold text-[#233A59]"><ClipboardList size={17} />Register</Link><Link href="/admin/billing?status=due" prefetch={false} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-white/10 px-3 text-sm font-bold text-white ring-1 ring-white/15"><IndianRupee size={17} />Balances</Link></div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
