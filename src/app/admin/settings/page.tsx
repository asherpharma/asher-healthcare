"use client";

import StaffAccessManager from "@/components/admin/StaffAccessManager";
import { useStaff } from "@/components/admin/StaffGuard";
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
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import {
  CalendarClock,
  CheckCircle2,
  LoaderCircle,
  Save,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import { useMemo, useState } from "react";

const inputClass = "mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-[#233A59] focus:ring-2 focus:ring-[#233A59]/10";

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
