"use client";

import { useStaff, type StaffRole } from "@/components/admin/StaffGuard";
import { firestore } from "@/firebase/config";
import { useAppointmentSchedule } from "@/hooks/useAppointmentSchedule";
import {
  DOCTORS,
  generateTimeSlots,
  normalizeAppointmentSchedule,
  scheduleSummary,
  timeToMinutes,
  WEEK_DAYS,
  type AppointmentSchedule,
  type DoctorId,
} from "@/lib/appointments";
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Timestamp,
} from "firebase/firestore";
import {
  CalendarClock,
  CheckCircle2,
  KeyRound,
  LoaderCircle,
  Save,
  Settings2,
  ShieldCheck,
  UserPlus,
  UsersRound,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";

type StaffRecord = {
  uid: string;
  displayName: string;
  email: string;
  role: StaffRole;
  doctorName?: string;
  active: boolean;
  createdAt?: Timestamp;
};

const inputClass = "mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-[#233A59] focus:ring-2 focus:ring-[#233A59]/10";
const roles: { value: StaffRole; label: string; detail: string }[] = [
  { value: "admin", label: "Administrator", detail: "Full access, staff management, and schedule settings" },
  { value: "doctor", label: "Doctor", detail: "Clinical records, appointments, billing, and lab workspace" },
  { value: "reception", label: "Reception", detail: "Appointments, registration, billing, and lab coordination" },
];

function ScheduleEditorForm({
  schedule,
  loadError,
}: {
  schedule: AppointmentSchedule;
  loadError: string;
}) {
  const { profile } = useStaff();
  const [draft, setDraft] = useState<AppointmentSchedule>(() => normalizeAppointmentSchedule(schedule));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [saveError, setSaveError] = useState("");

  function toggleDay(day: number) {
    setDirty(true);
    setDraft((current) => ({
      ...current,
      enabledDays: current.enabledDays.includes(day)
        ? current.enabledDays.filter((value) => value !== day)
        : [...current.enabledDays, day].sort(),
    }));
  }

  function updateDoctor<Key extends keyof AppointmentSchedule["doctors"][DoctorId]>(
    doctorId: DoctorId,
    key: Key,
    value: AppointmentSchedule["doctors"][DoctorId][Key],
  ) {
    setDirty(true);
    setDraft((current) => ({
      ...current,
      doctors: {
        ...current.doctors,
        [doctorId]: { ...current.doctors[doctorId], [key]: value },
      },
    }));
  }

  const validationError = useMemo(() => {
    if (draft.enabledDays.length === 0) return "Select at least one appointment day.";
    for (const doctor of DOCTORS) {
      const value = draft.doctors[doctor.id];
      if (value.enabled && timeToMinutes(value.endTime) <= timeToMinutes(value.startTime)) {
        return `${doctor.name}: closing time must be after opening time.`;
      }
      if (value.enabled && generateTimeSlots(value).length === 0) {
        return `${doctor.name}: the current timing does not create any appointment slots.`;
      }
    }
    return "";
  }, [draft]);

  async function saveSchedule() {
    if (!firestore || validationError) return;
    setSaving(true);
    setNotice("");
    setSaveError("");
    try {
      await setDoc(doc(firestore, "clinicSettings", "appointmentSchedule"), {
        ...draft,
        updatedBy: profile.uid,
        updatedAt: serverTimestamp(),
      });
      setDirty(false);
      setNotice("Appointment timings saved. The public booking form has updated.");
    } catch (saveFailure) {
      console.error(saveFailure);
      setSaveError("The schedule could not be saved. Confirm that appointment settings rules are published.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.14em] text-[#A8864A]"><CalendarClock size={18} />Live appointment schedule</div>
          <h2 className="mt-3 text-2xl font-bold text-[#233A59]">Control patient booking times</h2>
          <p className="mt-2 max-w-3xl leading-7 text-slate-600">
            Changes saved here appear on the website immediately. The starting schedule is Monday–Saturday,
            5:00 PM–8:00 PM, in 15-minute slots for both doctors.
          </p>
        </div>
      </div>

      <div className="mt-7">
        <p className="text-sm font-bold text-slate-700">Appointment days</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {WEEK_DAYS.map((day) => {
            const selected = draft.enabledDays.includes(day.value);
            return (
              <button
                key={day.value}
                type="button"
                onClick={() => toggleDay(day.value)}
                aria-pressed={selected}
                className={`min-w-16 rounded-xl px-4 py-2.5 text-sm font-bold transition ${
                  selected ? "bg-[#233A59] text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {day.short}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-7 grid gap-5 xl:grid-cols-2">
        {DOCTORS.map((doctor) => {
          const doctorSchedule = draft.doctors[doctor.id];
          return (
            <article key={doctor.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="font-bold text-[#233A59]">{doctor.name}</h3>
                  <p className="mt-1 text-sm text-slate-500">{doctor.specialty}</p>
                </div>
                <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-bold text-slate-700">
                  <input
                    type="checkbox"
                    checked={doctorSchedule.enabled}
                    onChange={(event) => updateDoctor(doctor.id, "enabled", event.target.checked)}
                    className="h-5 w-5 accent-[#233A59]"
                  />
                  Accept bookings
                </label>
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-3">
                <label className="text-sm font-bold text-slate-700">
                  Start time
                  <input
                    type="time"
                    step={300}
                    value={doctorSchedule.startTime}
                    onChange={(event) => updateDoctor(doctor.id, "startTime", event.target.value)}
                    disabled={!doctorSchedule.enabled}
                    className={inputClass}
                  />
                </label>
                <label className="text-sm font-bold text-slate-700">
                  End time
                  <input
                    type="time"
                    step={300}
                    value={doctorSchedule.endTime}
                    onChange={(event) => updateDoctor(doctor.id, "endTime", event.target.value)}
                    disabled={!doctorSchedule.enabled}
                    className={inputClass}
                  />
                </label>
                <label className="text-sm font-bold text-slate-700">
                  Slot duration
                  <select
                    value={doctorSchedule.slotMinutes}
                    onChange={(event) => updateDoctor(doctor.id, "slotMinutes", Number(event.target.value))}
                    disabled={!doctorSchedule.enabled}
                    className={inputClass}
                  >
                    {[10, 15, 20, 30, 45, 60].map((minutes) => (
                      <option key={minutes} value={minutes}>{minutes} minutes</option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="mt-4 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-600 ring-1 ring-slate-200">
                {scheduleSummary(draft, doctor.id)}
                {doctorSchedule.enabled ? ` · ${generateTimeSlots(doctorSchedule).length} slots per day` : ""}
              </p>
            </article>
          );
        })}
      </div>

      {(validationError || saveError || loadError) && (
        <p className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {validationError || saveError || loadError}
        </p>
      )}
      {notice && (
        <p className="mt-5 flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
          <CheckCircle2 size={18} />{notice}
        </p>
      )}
      <button
        type="button"
        onClick={() => void saveSchedule()}
        disabled={saving || !dirty || Boolean(validationError)}
        className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#233A59] px-5 py-3 text-sm font-bold text-white transition hover:bg-[#1b2e48] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? <LoaderCircle size={18} className="animate-spin" /> : <Save size={18} />}
        {saving ? "Saving timings…" : "Save and publish timings"}
      </button>
    </section>
  );
}

function ScheduleEditor() {
  const { schedule, loading, error } = useAppointmentSchedule();
  if (loading) {
    return (
      <section className="flex items-center gap-3 rounded-3xl bg-white p-7 text-slate-500 shadow-sm ring-1 ring-slate-200">
        <LoaderCircle className="animate-spin" size={20} /> Loading live appointment timings…
      </section>
    );
  }
  return (
    <ScheduleEditorForm
      key={JSON.stringify(schedule)}
      schedule={schedule}
      loadError={error}
    />
  );
}

function StaffAccessManager() {
  const { profile, user } = useStaff();
  const [staff, setStaff] = useState<StaffRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [updatingUid, setUpdatingUid] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!firestore) return;
    return onSnapshot(
      collection(firestore, "staff"),
      (snapshot) => {
        setStaff(
          snapshot.docs
            .map((item) => ({ uid: item.id, ...item.data() }) as StaffRecord)
            .sort((a, b) => a.displayName.localeCompare(b.displayName)),
        );
        setLoading(false);
      },
      () => {
        setError("Staff accounts could not be loaded.");
        setLoading(false);
      },
    );
  }, []);

  async function createStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setNotice("");
    setError("");
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const idToken = await user.getIdToken();
      const response = await fetch("/api/admin/staff/create", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          displayName: String(data.get("displayName") || "").trim(),
          email: String(data.get("email") || "").trim(),
          password: String(data.get("password") || ""),
          role: String(data.get("role") || ""),
          doctorName: String(data.get("doctorName") || ""),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "The staff account could not be created.");
      form.reset();
      setNotice("Staff login created. Share the email and temporary password privately.");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "The staff account could not be created.");
    } finally {
      setCreating(false);
    }
  }

  async function updateStaffAccess(record: StaffRecord, changes: Partial<Pick<StaffRecord, "active" | "role" | "doctorName">>) {
    if (!firestore || record.uid === profile.uid && changes.active === false) return;
    setUpdatingUid(record.uid);
    setNotice("");
    setError("");
    try {
      await updateDoc(doc(firestore, "staff", record.uid), {
        ...changes,
        updatedBy: profile.uid,
        updatedAt: serverTimestamp(),
      });
      setNotice("Staff access updated.");
    } catch {
      setError("Staff access could not be updated. Please try again.");
    } finally {
      setUpdatingUid("");
    }
  }

  return (
    <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-7">
      <div className="flex items-start gap-3">
        <span className="rounded-xl bg-[#233A59]/10 p-3 text-[#233A59]"><UsersRound size={23} /></span>
        <div>
          <h2 className="text-2xl font-bold text-[#233A59]">Staff login access</h2>
          <p className="mt-2 leading-7 text-slate-600">
            Give each staff member a separate account and role. Deactivated profiles are blocked by the database immediately.
          </p>
        </div>
      </div>

      <form onSubmit={createStaff} className="mt-7 grid gap-4 rounded-2xl bg-slate-50 p-5 sm:grid-cols-2 xl:grid-cols-5">
        <label className="text-sm font-bold text-slate-700">
          Staff name
          <input name="displayName" required minLength={2} maxLength={100} placeholder="Full name" className={inputClass} />
        </label>
        <label className="text-sm font-bold text-slate-700">
          Email address
          <input name="email" type="email" required autoComplete="off" placeholder="staff@clinic.com" className={inputClass} />
        </label>
        <label className="text-sm font-bold text-slate-700">
          Temporary password
          <input name="password" type="password" required minLength={8} maxLength={72} autoComplete="new-password" placeholder="Minimum 8 characters" className={inputClass} />
        </label>
        <label className="text-sm font-bold text-slate-700">
          Access role
          <select name="role" defaultValue="reception" className={inputClass}>
            {roles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
          </select>
        </label>
        <label className="text-sm font-bold text-slate-700">
          Doctor assignment
          <select name="doctorName" defaultValue="" className={inputClass}>
            <option value="">Not a doctor account</option>
            {DOCTORS.map((doctor) => <option key={doctor.id} value={doctor.name}>{doctor.name}</option>)}
          </select>
        </label>
        <div className="sm:col-span-2 xl:col-span-5">
          <button
            type="submit"
            disabled={creating}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#A8864A] px-5 py-3 text-sm font-bold text-white transition hover:bg-[#92713b] disabled:opacity-60"
          >
            {creating ? <LoaderCircle size={18} className="animate-spin" /> : <UserPlus size={18} />}
            {creating ? "Creating secure login…" : "Create staff login"}
          </button>
        </div>
      </form>

      {error && <p className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p>}
      {notice && <p className="mt-5 flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800"><CheckCircle2 size={18} />{notice}</p>}

      <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200">
        <div className="grid grid-cols-[1fr_auto] gap-3 bg-slate-50 px-4 py-3 text-xs font-bold uppercase tracking-[0.12em] text-slate-500 sm:grid-cols-[1.4fr_1.2fr_1fr]">
          <span>Staff member</span><span className="hidden sm:block">Role / doctor</span><span>Access</span>
        </div>
        {loading ? (
          <div className="flex items-center gap-3 p-5 text-sm text-slate-500"><LoaderCircle size={18} className="animate-spin" />Loading staff access…</div>
        ) : staff.length === 0 ? (
          <p className="p-5 text-sm text-slate-500">No staff profiles found.</p>
        ) : (
          staff.map((record) => {
            const updating = updatingUid === record.uid;
            const isSelf = record.uid === profile.uid;
            return (
              <div key={record.uid} className="grid grid-cols-[1fr_auto] items-center gap-3 border-t border-slate-200 px-4 py-4 sm:grid-cols-[1.4fr_1.2fr_1fr]">
                <div>
                  <p className="font-bold text-[#233A59]">{record.displayName || "Clinic staff"}{isSelf ? " (You)" : ""}</p>
                  <p className="mt-1 text-xs text-slate-500">{record.email}</p>
                </div>
                <div className="hidden space-y-2 sm:block">
                  <select
                    value={record.role}
                    disabled={updating || isSelf}
                    onChange={(event) => {
                      const role = event.target.value as StaffRole;
                      void updateStaffAccess(record, { role, ...(role === "doctor" ? {} : { doctorName: "" }) });
                    }}
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700"
                    aria-label={`Role for ${record.displayName}`}
                  >
                    {roles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                  </select>
                  {record.role === "doctor" ? (
                    <select
                      value={record.doctorName || ""}
                      disabled={updating}
                      onChange={(event) => void updateStaffAccess(record, { doctorName: event.target.value })}
                      className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700"
                      aria-label={`Doctor assignment for ${record.displayName}`}
                    >
                      <option value="">Assign doctor</option>
                      {DOCTORS.map((doctor) => <option key={doctor.id} value={doctor.name}>{doctor.name}</option>)}
                    </select>
                  ) : null}
                </div>
                <button
                  type="button"
                  disabled={updating || isSelf}
                  onClick={() => void updateStaffAccess(record, { active: !record.active })}
                  className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-3 text-xs font-bold transition ${
                    record.active ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"
                  } disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  {updating ? <LoaderCircle size={15} className="animate-spin" /> : record.active ? <ShieldCheck size={15} /> : <KeyRound size={15} />}
                  {record.active ? "Active" : "Deactivated"}
                </button>
              </div>
            );
          })
        )}
      </div>

      <div className="mt-5 rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm leading-6 text-blue-900">
        <strong>Access safety:</strong> use a different login for every person. Never share the administrator password.
        The current administrator cannot deactivate or downgrade their own account here.
      </div>
    </section>
  );
}

function SettingsContent() {
  const { profile } = useStaff();
  if (profile.role !== "admin") {
    return (
      <section className="rounded-3xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
        <ShieldCheck className="mx-auto text-[#A8864A]" size={36} />
        <h1 className="mt-5 text-2xl font-bold text-[#233A59]">Administrator access required</h1>
        <p className="mt-2 text-slate-600">Only a clinic administrator can change booking timings or staff access.</p>
      </section>
    );
  }

  return (
    <div>
      <div>
        <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.16em] text-[#A8864A]"><Settings2 size={18} />Clinic control centre</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-[#233A59] sm:text-4xl">Schedule and access settings</h1>
        <p className="mt-3 max-w-3xl text-slate-600">Manage what patients can book and who can enter the secure staff workspace.</p>
      </div>
      <div className="mt-8 space-y-6">
        <ScheduleEditor />
        <StaffAccessManager />
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return <SettingsContent />;
}
