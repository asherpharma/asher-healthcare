"use client";

import { useStaff } from "@/components/admin/StaffGuard";
import { firestore } from "@/firebase/config";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type Timestamp,
} from "firebase/firestore";
import {
  AlertCircle,
  CalendarClock,
  Check,
  CheckCircle2,
  ClipboardList,
  Clock3,
  LoaderCircle,
  Plus,
  RotateCcw,
  Search,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";

type TaskType = "follow_up" | "vaccination" | "lab" | "payment" | "callback" | "general";
type TaskPriority = "low" | "medium" | "high" | "urgent";
type TaskStatus = "open" | "completed";

type StaffTask = {
  id: string;
  title: string;
  details: string;
  type: TaskType;
  priority: TaskPriority;
  status: TaskStatus;
  dueDate: string;
  dueTime: string;
  patientId: string;
  patientName: string;
  assignedTo: string;
  assignedToName: string;
  createdBy: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  completedAt?: Timestamp | null;
  completedBy: string;
};

type StaffOption = {
  uid: string;
  displayName: string;
};

const taskTypes: Array<{ value: TaskType; label: string }> = [
  { value: "follow_up", label: "Clinical follow-up" },
  { value: "vaccination", label: "Vaccination reminder" },
  { value: "lab", label: "Lab follow-up" },
  { value: "payment", label: "Payment follow-up" },
  { value: "callback", label: "Patient callback" },
  { value: "general", label: "General task" },
];

const priorityStyles: Record<TaskPriority, string> = {
  low: "bg-slate-100 text-slate-700",
  medium: "bg-blue-50 text-blue-700",
  high: "bg-amber-50 text-amber-800",
  urgent: "bg-red-50 text-red-700",
};

function clinicDate() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return [value("year"), value("month"), value("day")].join("-");
}

function displayDate(value: string) {
  if (!value) return "No date";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function TasksContent() {
  const { profile } = useStaff();
  const today = clinicDate();
  const [tasks, setTasks] = useState<StaffTask[]>([]);
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([]);
  const [loading, setLoading] = useState(Boolean(firestore));
  const [saving, setSaving] = useState(false);
  const [busyTask, setBusyTask] = useState("");
  const [error, setError] = useState(firestore ? "" : "The secure task centre is not connected.");
  const [success, setSuccess] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | TaskStatus>("open");
  const [dateFilter, setDateFilter] = useState<"all" | "today" | "overdue" | "upcoming">("all");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [type, setType] = useState<TaskType>("follow_up");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [dueDate, setDueDate] = useState(today);
  const [dueTime, setDueTime] = useState("18:00");
  const [patientName, setPatientName] = useState("");
  const [patientId, setPatientId] = useState("");
  const [assignedTo, setAssignedTo] = useState(profile.uid);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedStatus = params.get("status");
    const requestedDate = params.get("date");
    const timer = window.setTimeout(() => {
      if (requestedStatus === "open" || requestedStatus === "completed") {
        setStatusFilter(requestedStatus);
      }
      if (["all", "today", "overdue", "upcoming"].includes(requestedDate ?? "")) {
        setDateFilter(requestedDate as "all" | "today" | "overdue" | "upcoming");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!firestore) {
      return;
    }

    const tasksQuery = profile.role === "admin"
      ? query(collection(firestore, "staffTasks"), orderBy("dueDate", "asc"))
      : query(
          collection(firestore, "staffTasks"),
          where("assignedTo", "==", profile.uid),
          orderBy("dueDate", "asc"),
        );
    return onSnapshot(
      tasksQuery,
      (snapshot) => {
        setTasks(
          snapshot.docs.map((taskDocument) => ({
            id: taskDocument.id,
            ...(taskDocument.data() as Omit<StaffTask, "id">),
          })),
        );
        setLoading(false);
      },
      (loadError) => {
        console.error(loadError);
        setError("Tasks could not be loaded. Please refresh or contact the administrator.");
        setLoading(false);
      },
    );
  }, [profile.role, profile.uid]);

  useEffect(() => {
    if (!firestore || profile.role !== "admin") return;

    void getDocs(collection(firestore, "staff"))
      .then((snapshot) => {
        setStaffOptions(
          snapshot.docs
            .filter((staffDocument) => staffDocument.data().active === true)
            .map((staffDocument) => ({
              uid: staffDocument.id,
              displayName: String(staffDocument.data().displayName || staffDocument.data().email || "Clinic staff"),
            }))
            .sort((a, b) => a.displayName.localeCompare(b.displayName)),
        );
      })
      .catch((loadError) => console.error("Staff options could not be loaded", loadError));
  }, [profile.role]);

  const filteredTasks = useMemo(() => {
    const term = search.trim().toLowerCase();
    return tasks.filter((task) => {
      const matchesStatus = statusFilter === "all" || task.status === statusFilter;
      const matchesDate =
        dateFilter === "all" ||
        (dateFilter === "today" && task.dueDate === today) ||
        (dateFilter === "overdue" && task.status === "open" && task.dueDate < today) ||
        (dateFilter === "upcoming" && task.dueDate > today);
      const matchesSearch =
        !term ||
        task.title.toLowerCase().includes(term) ||
        task.patientName.toLowerCase().includes(term) ||
        task.details.toLowerCase().includes(term);
      return matchesStatus && matchesDate && matchesSearch;
    });
  }, [dateFilter, search, statusFilter, tasks, today]);

  const counts = useMemo(
    () => ({
      open: tasks.filter((task) => task.status === "open").length,
      today: tasks.filter((task) => task.status === "open" && task.dueDate === today).length,
      overdue: tasks.filter((task) => task.status === "open" && task.dueDate < today).length,
      completed: tasks.filter((task) => task.status === "completed").length,
    }),
    [tasks, today],
  );

  function resetForm() {
    setTitle("");
    setDetails("");
    setType("follow_up");
    setPriority("medium");
    setDueDate(today);
    setDueTime("18:00");
    setPatientName("");
    setPatientId("");
    setAssignedTo(profile.uid);
  }

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!firestore) return;

    const cleanTitle = title.trim();
    if (cleanTitle.length < 2) {
      setError("Please enter a clear task title.");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");

    const selectedStaff = staffOptions.find((staff) => staff.uid === assignedTo);
    const assignedToName =
      assignedTo === profile.uid ? profile.displayName : selectedStaff?.displayName ?? (assignedTo ? "Clinic staff" : "Team");

    try {
      await addDoc(collection(firestore, "staffTasks"), {
        title: cleanTitle,
        details: details.trim(),
        type,
        priority,
        status: "open",
        dueDate,
        dueTime,
        patientId: patientId.trim(),
        patientName: patientName.trim(),
        assignedTo,
        assignedToName,
        createdBy: profile.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        completedAt: null,
        completedBy: "",
      });
      resetForm();
      setFormOpen(false);
      setSuccess("Task added to the clinic follow-up centre.");
    } catch (saveError) {
      console.error(saveError);
      setError("The task could not be saved. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(task: StaffTask, status: TaskStatus) {
    if (!firestore) return;
    setBusyTask(task.id);
    setError("");
    setSuccess("");

    try {
      await updateDoc(doc(firestore, "staffTasks", task.id), {
        status,
        completedAt: status === "completed" ? serverTimestamp() : null,
        completedBy: status === "completed" ? profile.uid : "",
        updatedAt: serverTimestamp(),
      });
      setSuccess(status === "completed" ? "Task marked complete." : "Task reopened.");
    } catch (saveError) {
      console.error(saveError);
      setError("The task could not be updated. Please try again.");
    } finally {
      setBusyTask("");
    }
  }

  const inputClass =
    "min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none transition focus:border-[#2B8581] focus:ring-4 focus:ring-[#2B8581]/10";

  return (
    <div>
      <div className="staff-page-heading flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#A8864A]">Care coordination</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-[#233A59] sm:text-4xl">Tasks & follow-ups</h1>
          <p className="mt-3 max-w-2xl text-slate-600">
            Keep callbacks, vaccinations, lab follow-ups and payment reminders visible to their assignee and clinic administrators.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setFormOpen((open) => !open)}
          className="inline-flex min-h-12 items-center justify-center gap-2 self-start rounded-xl bg-[#233A59] px-5 text-sm font-bold text-white shadow-sm transition hover:bg-[#16425f]"
        >
          {formOpen ? <X size={18} /> : <Plus size={18} />}
          {formOpen ? "Close form" : "New task"}
        </button>
      </div>

      {error ? <div role="alert" className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm font-semibold text-red-700">{error}</div> : null}
      {success ? <div role="status" className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-semibold text-emerald-700">{success}</div> : null}

      <div className="mt-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { label: "Open", value: counts.open, icon: ClipboardList, tone: "bg-blue-50 text-blue-700" },
          { label: "Due today", value: counts.today, icon: CalendarClock, tone: "bg-violet-50 text-violet-700" },
          { label: "Overdue", value: counts.overdue, icon: AlertCircle, tone: "bg-red-50 text-red-700" },
          { label: "Completed", value: counts.completed, icon: CheckCircle2, tone: "bg-emerald-50 text-emerald-700" },
        ].map(({ label, value, icon: Icon, tone }) => (
          <article key={label} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
            <span className={`inline-flex rounded-xl p-2.5 ${tone}`}><Icon size={20} /></span>
            <p className="mt-4 text-2xl font-bold text-[#233A59]">{loading ? "—" : value}</p>
            <p className="mt-1 text-sm font-semibold text-slate-600">{label}</p>
          </article>
        ))}
      </div>

      {formOpen ? (
        <form onSubmit={createTask} className="mt-6 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-7">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#E8F4F1] text-[#2B8581]"><Plus size={21} /></span>
            <div><h2 className="text-xl font-bold text-[#233A59]">Create a clinic task</h2><p className="text-sm text-slate-500">Add only the minimum patient details needed for this reminder.</p></div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm font-bold text-slate-700 md:col-span-2">
              Task title
              <input className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} required placeholder="Example: Call after lab results" />
            </label>
            <label className="grid gap-2 text-sm font-bold text-slate-700">
              Task type
              <select className={inputClass} value={type} onChange={(event) => setType(event.target.value as TaskType)}>
                {taskTypes.map((taskType) => <option key={taskType.value} value={taskType.value}>{taskType.label}</option>)}
              </select>
            </label>
            <label className="grid gap-2 text-sm font-bold text-slate-700">
              Priority
              <select className={inputClass} value={priority} onChange={(event) => setPriority(event.target.value as TaskPriority)}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </label>
            <label className="grid gap-2 text-sm font-bold text-slate-700">
              Due date
              <input className={inputClass} type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} required />
            </label>
            <label className="grid gap-2 text-sm font-bold text-slate-700">
              Due time
              <input className={inputClass} type="time" value={dueTime} onChange={(event) => setDueTime(event.target.value)} required />
            </label>
            <label className="grid gap-2 text-sm font-bold text-slate-700">
              Patient name <span className="font-normal text-slate-400">(optional)</span>
              <input className={inputClass} value={patientName} onChange={(event) => setPatientName(event.target.value)} maxLength={100} placeholder="Patient name" />
            </label>
            <label className="grid gap-2 text-sm font-bold text-slate-700">
              Patient ID <span className="font-normal text-slate-400">(optional)</span>
              <input className={inputClass} value={patientId} onChange={(event) => setPatientId(event.target.value)} maxLength={40} placeholder="ASH-0001" />
            </label>
            <label className="grid gap-2 text-sm font-bold text-slate-700 md:col-span-2">
              Assigned to
              <select className={inputClass} value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)}>
                {profile.role === "admin" ? <option value="">Administrator triage queue</option> : null}
                <option value={profile.uid}>Me — {profile.displayName}</option>
                {profile.role === "admin"
                  ? staffOptions.filter((staff) => staff.uid !== profile.uid).map((staff) => <option key={staff.uid} value={staff.uid}>{staff.displayName}</option>)
                  : null}
              </select>
            </label>
            <label className="grid gap-2 text-sm font-bold text-slate-700 md:col-span-2">
              Notes <span className="font-normal text-slate-400">(optional)</span>
              <textarea className={`${inputClass} min-h-28 py-3`} value={details} onChange={(event) => setDetails(event.target.value)} maxLength={1000} placeholder="Short, actionable notes for clinic staff" />
            </label>
          </div>
          <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => { resetForm(); setFormOpen(false); }} className="min-h-12 rounded-xl border border-slate-200 px-5 text-sm font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#233A59] px-6 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60">
              {saving ? <LoaderCircle size={18} className="animate-spin" /> : <Check size={18} />}
              Save task
            </button>
          </div>
        </form>
      ) : null}

      <section className="mt-6 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-6">
        <div className="grid gap-3 lg:grid-cols-[1fr_auto_auto]">
          <label className="relative">
            <span className="sr-only">Search tasks</span>
            <Search className="pointer-events-none absolute left-3.5 top-3.5 text-slate-400" size={18} />
            <input className={`${inputClass} pl-11`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search task or patient" />
          </label>
          <select aria-label="Filter by status" className={inputClass} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | TaskStatus)}>
            <option value="open">Open tasks</option>
            <option value="completed">Completed</option>
            <option value="all">All statuses</option>
          </select>
          <select aria-label="Filter by date" className={inputClass} value={dateFilter} onChange={(event) => setDateFilter(event.target.value as "all" | "today" | "overdue" | "upcoming")}>
            <option value="all">All dates</option>
            <option value="today">Due today</option>
            <option value="overdue">Overdue</option>
            <option value="upcoming">Upcoming</option>
          </select>
        </div>

        {loading ? (
          <div className="flex min-h-52 items-center justify-center gap-3 text-sm font-semibold text-slate-500"><LoaderCircle className="animate-spin" />Loading clinic tasks…</div>
        ) : filteredTasks.length === 0 ? (
          <div className="grid min-h-52 place-items-center text-center">
            <div><CheckCircle2 className="mx-auto text-emerald-500" size={34} /><h2 className="mt-4 text-lg font-bold text-[#233A59]">No tasks in this view</h2><p className="mt-1 text-sm text-slate-500">Adjust the filters or add the next follow-up.</p></div>
          </div>
        ) : (
          <div className="mt-5 grid gap-3">
            {filteredTasks.map((task) => {
              const overdue = task.status === "open" && task.dueDate < today;
              const dueToday = task.status === "open" && task.dueDate === today;
              const typeLabel = taskTypes.find((taskType) => taskType.value === task.type)?.label ?? "Task";
              return (
                <article key={task.id} className={`rounded-2xl border p-4 transition sm:p-5 ${task.status === "completed" ? "border-slate-200 bg-slate-50/70" : overdue ? "border-red-200 bg-red-50/40" : "border-slate-200 bg-white"}`}>
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-bold capitalize ${priorityStyles[task.priority]}`}>{task.priority}</span>
                        <span className="rounded-full bg-[#E8F4F1] px-2.5 py-1 text-xs font-bold text-[#2B8581]">{typeLabel}</span>
                        {overdue ? <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-bold text-red-700">Overdue</span> : null}
                        {dueToday ? <span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-bold text-violet-700">Today</span> : null}
                      </div>
                      <h2 className={`mt-3 text-lg font-bold ${task.status === "completed" ? "text-slate-500 line-through" : "text-[#233A59]"}`}>{task.title}</h2>
                      {task.details ? <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">{task.details}</p> : null}
                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs font-semibold text-slate-500">
                        <span className="inline-flex items-center gap-1.5"><Clock3 size={14} />{displayDate(task.dueDate)} at {task.dueTime}</span>
                        {task.patientName ? <span className="inline-flex items-center gap-1.5"><UserRound size={14} />{task.patientName}{task.patientId ? ` · ${task.patientId}` : ""}</span> : null}
                        <span>Assigned: {task.assignedToName || "Team"}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={busyTask === task.id}
                      onClick={() => void changeStatus(task, task.status === "open" ? "completed" : "open")}
                      className={`inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold transition disabled:opacity-60 ${task.status === "open" ? "bg-emerald-600 text-white hover:bg-emerald-700" : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
                    >
                      {busyTask === task.id ? <LoaderCircle size={17} className="animate-spin" /> : task.status === "open" ? <Check size={17} /> : <RotateCcw size={17} />}
                      {task.status === "open" ? "Complete" : "Reopen"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

export default function TasksPage() {
  return <TasksContent />;
}
