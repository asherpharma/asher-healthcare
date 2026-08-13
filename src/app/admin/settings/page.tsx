"use client";

import StaffAccessManager from "@/components/admin/StaffAccessManager";
import PatientSearchUpgradePanel from "@/components/admin/PatientSearchUpgradePanel";
import SystemHealthPanel from "@/components/admin/SystemHealthPanel";
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
import {
  cloneServiceCatalog,
  DEFAULT_SERVICE_CATALOG,
  normalizeServiceCatalog,
  SERVICE_IDS,
  type ConsultationServiceId,
  type ServiceCatalog,
  type ServiceCatalogRevision,
  type ServiceCatalogSaveResult,
  type ServiceCatalogSnapshot,
} from "@/lib/service-catalog";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import {
  CalendarClock,
  CheckCircle2,
  IndianRupee,
  LoaderCircle,
  Save,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

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
    if (!firestore || validationError || loadError) return;
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
        disabled={saving || !dirty || Boolean(validationError) || Boolean(loadError)}
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

const serviceNames: Record<ConsultationServiceId, string> = {
  general: "General consultation",
  pediatrics: "Pediatrics",
  obg: "Obstetrics & Gynaecology",
};

function ServiceCatalogEditorForm({
  catalog,
  revision,
  loadError,
  onReload,
}: {
  catalog: ServiceCatalog;
  revision: ServiceCatalogRevision;
  loadError: string;
  onReload: () => Promise<void>;
}) {
  const { user } = useStaff();
  const [draft, setDraft] = useState(() => cloneServiceCatalog(catalog));
  const [currentRevision, setCurrentRevision] = useState<ServiceCatalogRevision>(revision);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [saveError, setSaveError] = useState("");

  function updateService(
    serviceId: ConsultationServiceId,
    update: Partial<ServiceCatalog["services"][ConsultationServiceId]>,
  ) {
    setDirty(true);
    setNotice("");
    setSaveError("");
    setDraft((current) => ({
      ...current,
      services: {
        ...current.services,
        [serviceId]: { ...current.services[serviceId], ...update },
      },
    }));
  }

  const validationError = useMemo(() => {
    if (!SERVICE_IDS.some((serviceId) => draft.services[serviceId].active)) {
      return "Keep at least one consultation service active.";
    }
    for (const serviceId of SERVICE_IDS) {
      const service = draft.services[serviceId];
      if (service.label.trim().length < 2 || service.label.trim().length > 80) {
        return `${serviceNames[serviceId]} needs a label between 2 and 80 characters.`;
      }
      if (!Number.isInteger(service.fee) || service.fee < 1 || service.fee > 100_000) {
        return `${serviceNames[serviceId]} needs a whole-number fee from ₹1 to ₹1,00,000.`;
      }
    }
    return "";
  }, [draft]);

  async function saveCatalog() {
    if (validationError || loadError) return;
    setSaving(true);
    setNotice("");
    setSaveError("");
    try {
      const catalogToPublish: ServiceCatalog = {
        schemaVersion: 1,
        services: Object.fromEntries(SERVICE_IDS.map((serviceId) => [
          serviceId,
          {
            label: draft.services[serviceId].label.trim(),
            fee: draft.services[serviceId].fee,
            active: draft.services[serviceId].active,
          },
        ])) as ServiceCatalog["services"],
      };
      const token = await user.getIdToken();
      const response = await fetch("/api/admin/service-catalog", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({
          catalog: catalogToPublish,
          expectedUpdateTime: currentRevision,
        }),
      });
      const result = await response.json().catch(() => ({})) as Partial<ServiceCatalogSaveResult> & { error?: string };
      const validRevision = result.revision === null || typeof result.revision === "string";
      if (!response.ok || !result.catalog || !validRevision || typeof result.changed !== "boolean") {
        throw new Error(result.error || "Consultation services could not be saved. Please try again.");
      }
      setDraft(cloneServiceCatalog(result.catalog));
      setCurrentRevision(result.revision ?? null);
      setDirty(false);
      setNotice(result.changed === false
        ? "These consultation services and fees were already current."
        : "Consultation services and fees published to Express Reception.");
    } catch (saveFailure) {
      console.error(saveFailure);
      setSaveError(saveFailure instanceof Error
        ? saveFailure.message
        : "Consultation services could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-7">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-emerald-700"><IndianRupee size={21} /></span>
        <div>
          <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.14em] text-[#A8864A]"><SlidersHorizontal size={17} />Service and fee catalogue</p>
          <h2 className="mt-2 text-2xl font-bold text-[#233A59]">Control reception consultation charges</h2>
          <p className="mt-2 max-w-3xl leading-7 text-slate-600">Labels, availability, and fees saved here appear in Express Reception immediately. The secure server confirms the fee again before creating every invoice.</p>
        </div>
      </div>

      <div className="mt-7 grid gap-4 xl:grid-cols-3">
        {SERVICE_IDS.map((serviceId) => {
          const service = draft.services[serviceId];
          return (
            <article key={serviceId} className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <div className="flex items-start justify-between gap-3">
                <div><h3 className="font-bold text-[#233A59]">{serviceNames[serviceId]}</h3><p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{serviceId === "general" ? "Any clinic doctor" : "Specialist service"}</p></div>
                <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-bold text-slate-700"><input type="checkbox" checked={service.active} onChange={(event) => updateService(serviceId, { active: event.target.checked })} className="h-5 w-5 accent-[#233A59]" />Active</label>
              </div>
              <label className="mt-5 block text-sm font-bold text-slate-700">Invoice label<input required minLength={2} maxLength={80} value={service.label} onChange={(event) => updateService(serviceId, { label: event.target.value })} className={inputClass} /></label>
              <label className="mt-4 block text-sm font-bold text-slate-700">Fee in rupees<input required type="number" inputMode="numeric" min={1} max={100000} step={1} value={service.fee} onChange={(event) => updateService(serviceId, { fee: Number(event.target.value) })} className={inputClass} /></label>
            </article>
          );
        })}
      </div>

      {(validationError || saveError || loadError) && <div className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700"><p>{validationError || saveError || loadError}</p>{(saveError || loadError) && <button type="button" onClick={() => void onReload()} disabled={saving} className="mt-3 rounded-lg bg-white px-3 py-2 text-xs font-bold text-red-700 ring-1 ring-red-200 disabled:opacity-50">Reload current fees</button>}</div>}
      {notice && <p className="mt-5 flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800"><CheckCircle2 size={18} />{notice}</p>}
      <button type="button" onClick={() => void saveCatalog()} disabled={saving || !dirty || Boolean(validationError) || Boolean(loadError)} className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#233A59] px-5 py-3 text-sm font-bold text-white transition hover:bg-[#1b2e48] disabled:cursor-not-allowed disabled:opacity-50">{saving ? <LoaderCircle size={18} className="animate-spin" /> : <Save size={18} />}{saving ? "Publishing fees…" : "Save and publish services"}</button>
    </section>
  );
}

function ServiceCatalogEditor() {
  const { user } = useStaff();
  const [catalog, setCatalog] = useState<ServiceCatalog>(() => cloneServiceCatalog(DEFAULT_SERVICE_CATALOG));
  const [revision, setRevision] = useState<ServiceCatalogRevision>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadCatalog = useCallback(async () => {
    // Yield before changing local state so the initial effect synchronizes
    // with the remote API without creating a synchronous render cascade.
    await Promise.resolve();
    setLoading(true);
    setError("");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/admin/service-catalog", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        credentials: "same-origin",
        cache: "no-store",
      });
      const result = await response.json().catch(() => ({})) as Partial<ServiceCatalogSnapshot> & { error?: string };
      const validRevision = result.revision === null || typeof result.revision === "string";
      if (!response.ok || !result.catalog || !validRevision) {
        throw new Error(result.error || "Consultation services and fees could not be loaded. Please try again.");
      }
      setCatalog(normalizeServiceCatalog(result.catalog));
      setRevision(result.revision ?? null);
    } catch (catalogError) {
      setError(catalogError instanceof Error
        ? catalogError.message
        : "Consultation services and fees could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadCatalog(), 0);
    return () => window.clearTimeout(timer);
  }, [loadCatalog]);
  if (loading) {
    return <section className="flex items-center gap-3 rounded-3xl bg-white p-7 text-slate-500 shadow-sm ring-1 ring-slate-200"><LoaderCircle className="animate-spin" size={20} />Loading consultation services and fees…</section>;
  }
  return <ServiceCatalogEditorForm key={`${revision ?? "new"}:${JSON.stringify(catalog)}`} catalog={catalog} revision={revision} loadError={error} onReload={loadCatalog} />;
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
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-[#233A59] sm:text-4xl">Schedule, fees, and access settings</h1>
        <p className="mt-3 max-w-3xl text-slate-600">Manage patient booking times, reception consultation fees, and secure staff access.</p>
      </div>
      <div className="mt-8 space-y-6">
        <SystemHealthPanel />
        <PatientSearchUpgradePanel />
        <ScheduleEditor />
        <ServiceCatalogEditor />
        <StaffAccessManager />
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return <SettingsContent />;
}
