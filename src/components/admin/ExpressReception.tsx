"use client";

import ReceptionPayment, {
  type ReceptionInvoice,
  type ReceptionPatient,
} from "@/components/admin/ReceptionPayment";
import { useStaff } from "@/components/admin/StaffGuard";
import { useServiceCatalog } from "@/hooks/useServiceCatalog";
import { searchPatientDirectory } from "@/lib/patient-directory";
import {
  findPotentialPatientDuplicates,
  normalizeIndianPhone,
  normalizePatientName,
} from "@/lib/patient-identity";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  IndianRupee,
  LoaderCircle,
  Search,
  ShieldAlert,
  Sparkles,
  UserRoundCheck,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

type Gender = "female" | "male" | "other";
type CaseType = "general" | "specialist";
type Specialty = "" | "pediatrics" | "obg";
type Stage = "identify" | "review" | "payment";

type PatientCandidate = {
  id: string;
  patientNumber?: string;
  fullName: string;
  phone: string;
  dateOfBirth: string;
  gender: Gender;
  doctorName?: string;
  archived?: boolean;
};

type RegistrationResult = {
  patient: ReceptionPatient;
  invoice: ReceptionInvoice;
  consultationLabel: string;
  appointment: {
    id: string;
    status: "checked_in";
    queueToken: number;
    queueLabel: string;
    doctorId: "pediatrics" | "obg";
    preferredDate: string;
    preferredTime: string;
  };
};

const doctors = ["Dr. Lt Col Shafi Ahamad", "Dr. Shaik Reshma"] as const;
const inputClass = "mt-2 min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base font-semibold text-slate-800 outline-none transition focus:border-[#233A59] focus:ring-2 focus:ring-[#233A59]/10 disabled:bg-slate-100 disabled:text-slate-500 sm:min-h-11 sm:rounded-xl sm:text-sm";
const labelClass = "text-sm font-bold text-slate-700";

function money(value: number) {
  return `₹${value.toLocaleString("en-IN")}`;
}

function friendlyDate(value: string) {
  if (!value) return "Not recorded";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function clinicDateToday() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const read = (type: Intl.DateTimeFormatPartTypes) => (
    parts.find((part) => part.type === type)?.value || ""
  );
  return `${read("year")}-${read("month")}-${read("day")}`;
}

export default function ExpressReception() {
  const { user, profile } = useStaff();
  const {
    catalog,
    loading: loadingServiceCatalog,
    error: serviceCatalogError,
  } = useServiceCatalog();
  const today = clinicDateToday();
  const [stage, setStage] = useState<Stage>("identify");
  const [patients, setPatients] = useState<PatientCandidate[]>([]);
  const [loadingPatients, setLoadingPatients] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [gender, setGender] = useState<Gender | "">("");
  const [caseType, setCaseType] = useState<CaseType>("general");
  const [specialty, setSpecialty] = useState<Specialty>("");
  const [generalDoctor, setGeneralDoctor] = useState("");
  const [selectedExisting, setSelectedExisting] = useState<PatientCandidate | null>(null);
  const [duplicateAcknowledged, setDuplicateAcknowledged] = useState(false);
  const [result, setResult] = useState<RegistrationResult | null>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    const phoneDigits = phone.replace(/\D/gu, "").slice(-10);
    const normalizedName = normalizePatientName(fullName);
    const search = phoneDigits.length >= 6
      ? phoneDigits
      : normalizedName.length >= 3
        ? normalizedName
        : "";
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      if (!search) {
        setPatients([]);
        setLoadingPatients(false);
        return;
      }
      setLoadingPatients(true);
      void searchPatientDirectory(user, search, { pageSize: 10 })
        .then(({ patients: matches }) => {
          if (cancelled) return;
          setPatients(matches
            .map((patient) => ({
              ...patient,
              gender: String(patient.gender || "").toLowerCase(),
            }))
            .filter((patient) => ["female", "male", "other"].includes(patient.gender))
            .map((patient) => ({ ...patient, gender: patient.gender as Gender })));
        })
        .catch((reason) => {
          if (cancelled) return;
          console.error("Express Reception patient search failed", reason);
          setPatients([]);
          setError("Patient search could not be completed. Exact duplicate protection remains active when you save.");
        })
        .finally(() => {
          if (!cancelled) setLoadingPatients(false);
        });
    }, search ? 300 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [fullName, phone, user]);

  const possibleMatches = (() => {
    const completePhone = normalizeIndianPhone(phone);
    const normalizedName = normalizePatientName(fullName);
    if (completePhone || (normalizedName.length >= 3 && dateOfBirth)) {
      return findPotentialPatientDuplicates(
        { fullName, phone, dateOfBirth },
        patients,
      ).slice(0, 5).map(({ patient }) => patient);
    }

    const partialPhone = phone.replace(/\D/g, "").slice(-10);
    if (partialPhone.length < 6 && normalizedName.length < 3) return [];
    return patients.filter((patient) => {
      const patientPhone = normalizeIndianPhone(patient.phone)?.slice(-10) || "";
      const patientName = normalizePatientName(patient.fullName);
      return (partialPhone.length >= 6 && patientPhone.startsWith(partialPhone))
        || (normalizedName.length >= 3 && patientName.startsWith(normalizedName));
    }).slice(0, 5);
  })();

  const doctorName = caseType === "specialist"
    ? specialty === "pediatrics"
      ? doctors[0]
      : specialty === "obg"
        ? doctors[1]
        : ""
    : generalDoctor;
  const doctorId = caseType === "specialist"
    ? specialty
    : doctorName === doctors[0]
      ? "pediatrics"
      : doctorName === doctors[1]
        ? "obg"
        : "";
  const serviceId = caseType === "general" ? "general" : specialty;
  const selectedService = serviceId ? catalog.services[serviceId] : null;
  const fee = selectedService?.fee ?? 0;
  const consultationLabel = selectedService?.label ?? "Select a consultation service";
  const specialistServices = [catalog.services.pediatrics, catalog.services.obg];
  const specialistActive = specialistServices.some((service) => service.active);
  const specialistFeeLabel = specialistServices
    .filter((service) => service.active)
    .map((service) => service.fee)
    .filter((value, index, values) => values.indexOf(value) === index)
    .sort((left, right) => left - right)
    .map(money)
    .join(" / ");

  function updateIdentity(setter: (value: string) => void, value: string) {
    setter(value);
    setSelectedExisting(null);
    setDuplicateAcknowledged(false);
    setRequestId(crypto.randomUUID());
    setError("");
  }

  function selectExistingPatient(patient: PatientCandidate) {
    setSelectedExisting(patient);
    setFullName(patient.fullName);
    setPhone(patient.phone);
    setDateOfBirth(patient.dateOfBirth);
    setGender(patient.gender);
    setDuplicateAcknowledged(false);
    setRequestId(crypto.randomUUID());
    setError("");
  }

  function prepareReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (loadingServiceCatalog || serviceCatalogError) {
      setError(serviceCatalogError || "Wait while the current consultation fees are confirmed.");
      return;
    }
    if (!selectedService?.active) {
      setError("This consultation service is currently unavailable. Choose another service.");
      return;
    }
    if (!normalizeIndianPhone(phone)) {
      setError("Enter a valid 10-digit mobile number.");
      return;
    }
    if (!dateOfBirth || dateOfBirth > today) {
      setError("Enter a valid date of birth that is not in the future.");
      return;
    }
    if (!gender || !doctorName) {
      setError("Complete the patient, case, and doctor details before continuing.");
      return;
    }
    if (!selectedExisting && possibleMatches.length > 0 && !duplicateAcknowledged) {
      setError("Review the possible matching patient record before creating a new chart.");
      return;
    }
    setStage("review");
  }

  async function createArrival() {
    if (loadingServiceCatalog || serviceCatalogError) {
      setError(serviceCatalogError || "Wait while the current consultation fees are confirmed.");
      return;
    }
    if (!selectedService?.active) {
      setError("This consultation service is currently unavailable. Return to patient details and choose another service.");
      return;
    }
    if (!doctorName || !doctorId || !gender) return;
    setSaving(true);
    setError("");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/reception/register", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requestId,
          patientId: selectedExisting?.id || "",
          fullName: fullName.trim(),
          phone: phone.trim(),
          dateOfBirth,
          gender,
          caseType,
          serviceId,
          specialty: caseType === "specialist" ? specialty : "",
          doctorId,
          fee,
          duplicateAcknowledged,
        }),
      });
      const registration = await response.json() as RegistrationResult & { error?: string };
      if (!response.ok || !registration.patient || !registration.invoice || !registration.appointment) {
        throw new Error(registration.error || "The secure reception service could not complete this arrival.");
      }

      setResult(registration);
      setStage("payment");
    } catch (reason) {
      console.error("Express reception registration failed", reason);
      setError(
        reason instanceof Error
          ? reason.message
          : "The patient arrival could not be saved. Nothing was partially registered. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  function resetWorkflow() {
    setStage("identify");
    setFullName("");
    setPhone("");
    setDateOfBirth("");
    setGender("");
    setCaseType("general");
    setSpecialty("");
    setGeneralDoctor("");
    setSelectedExisting(null);
    setDuplicateAcknowledged(false);
    setResult(null);
    setRequestId(crypto.randomUUID());
    setError("");
  }

  if (profile.role === "doctor") {
    return (
      <section className="mx-auto max-w-2xl rounded-[28px] bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
        <ShieldAlert className="mx-auto text-[#A8864A]" size={38} />
        <h1 className="mt-5 text-2xl font-bold text-[#233A59]">Front-desk access required</h1>
        <p className="mt-2 leading-7 text-slate-600">Express Reception is available to reception staff and clinic administrators.</p>
        <Link href="/admin/consultations" className="mt-6 inline-flex min-h-12 items-center justify-center rounded-2xl bg-[#233A59] px-5 font-bold text-white">Open doctor workspace</Link>
      </section>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <section className="overflow-hidden rounded-[30px] bg-gradient-to-br from-[#17324d] via-[#233A59] to-[#315777] p-5 text-white shadow-xl sm:p-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-[#f0d69e]"><Sparkles size={16} />60-second front desk</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Express Reception</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/75 sm:text-base">Find or register the patient, confirm the consultation, then collect payment and print—all without changing pages.</p>
          </div>
          <div className="grid grid-cols-3 gap-2" aria-label="Reception workflow progress">
            {([
              ["identify", "1", "Patient"],
              ["review", "2", "Review"],
              ["payment", "3", "Payment"],
            ] as const).map(([key, number, label]) => {
              const active = stage === key;
              const complete = (stage === "review" && key === "identify") || (stage === "payment" && key !== "payment");
              return (
                <div key={key} aria-current={active ? "step" : undefined} className={`min-w-20 rounded-2xl px-3 py-2 text-center ring-1 ${active ? "bg-white text-[#233A59] ring-white" : complete ? "bg-emerald-400/15 text-emerald-100 ring-emerald-300/20" : "bg-white/8 text-white/60 ring-white/10"}`}>
                  <p className="text-sm font-bold">{complete ? "✓" : number}</p><p className="text-[10px] font-bold uppercase tracking-wide">{label}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {error ? <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold leading-6 text-red-700">{error}</p> : null}

      {serviceCatalogError ? <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold leading-6 text-amber-800">{serviceCatalogError} Refresh before creating an invoice.</p> : null}

      {stage === "identify" ? (
        <form onSubmit={prepareReview} className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-7">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-blue-50 text-blue-700"><Search size={21} /></span>
            <div><p className="text-xs font-bold uppercase tracking-[0.15em] text-[#A8864A]">Step 1</p><h2 className="mt-1 text-xl font-bold text-[#233A59]">Identify the patient and visit</h2><p className="mt-1 text-sm text-slate-500">Only the minimum details needed at reception are required.</p></div>
          </div>

          {selectedExisting ? (
            <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div><p className="flex items-center gap-2 font-bold text-emerald-900"><CheckCircle2 size={18} />Existing chart selected</p><p className="mt-1 text-sm text-emerald-800">{selectedExisting.patientNumber || "Patient"} · {selectedExisting.fullName} · {selectedExisting.phone}</p></div>
              <button type="button" onClick={() => { setSelectedExisting(null); setDuplicateAcknowledged(false); setRequestId(crypto.randomUUID()); }} className="min-h-11 rounded-xl border border-emerald-300 bg-white px-4 text-sm font-bold text-emerald-900">Choose another</button>
            </div>
          ) : null}

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <label className={labelClass}>Full name<input required minLength={2} maxLength={100} autoComplete="name" value={fullName} disabled={Boolean(selectedExisting)} onChange={(event) => updateIdentity(setFullName, event.target.value)} className={inputClass} placeholder="Patient full name" /></label>
            <label className={labelClass}>Mobile number<input required type="tel" inputMode="tel" autoComplete="tel" minLength={10} maxLength={20} value={phone} disabled={Boolean(selectedExisting)} onChange={(event) => updateIdentity(setPhone, event.target.value)} className={inputClass} placeholder="10-digit number" /></label>
            <label className={labelClass}>Date of birth<input required type="date" max={today} value={dateOfBirth} disabled={Boolean(selectedExisting)} onChange={(event) => updateIdentity(setDateOfBirth, event.target.value)} className={inputClass} /></label>
            <label className={labelClass}>Gender<select required value={gender} disabled={Boolean(selectedExisting)} onChange={(event) => { setGender(event.target.value as Gender); setDuplicateAcknowledged(false); setRequestId(crypto.randomUUID()); }} className={inputClass}><option value="" disabled>Select</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></select></label>
          </div>

          {!selectedExisting && possibleMatches.length > 0 ? (
            <section aria-labelledby="duplicate-heading" className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-start gap-3"><ShieldAlert className="mt-0.5 shrink-0 text-amber-700" size={20} /><div><h3 id="duplicate-heading" className="font-bold text-amber-950">Possible patient record found</h3><p className="mt-1 text-sm leading-6 text-amber-900">Select the correct chart. If this is another family member sharing the number, confirm before continuing.</p></div></div>
              <div className="mt-3 grid gap-2">
                {possibleMatches.map((patient) => <button key={patient.id} type="button" onClick={() => selectExistingPatient(patient)} className="flex min-h-14 items-center justify-between gap-3 rounded-xl bg-white px-4 py-3 text-left ring-1 ring-amber-200"><span><strong className="block text-[#233A59]">{patient.fullName}</strong><span className="mt-0.5 block text-xs text-slate-500">{patient.patientNumber || "Patient"} · {patient.phone} · DOB {friendlyDate(patient.dateOfBirth)}</span></span><ArrowRight className="shrink-0 text-amber-700" size={17} /></button>)}
              </div>
              <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-xl bg-white p-3 text-sm font-semibold leading-6 text-slate-700 ring-1 ring-amber-200"><input type="checkbox" checked={duplicateAcknowledged} onChange={(event) => { setDuplicateAcknowledged(event.target.checked); setRequestId(crypto.randomUUID()); }} className="mt-1 h-4 w-4 accent-[#233A59]" /><span>This is a different patient or family member. Create a separate chart.</span></label>
            </section>
          ) : loadingPatients ? <p className="mt-4 flex items-center gap-2 text-sm text-slate-500"><LoaderCircle className="animate-spin" size={16} />Checking recent patient records…</p> : null}

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <label className={labelClass}>Case category<select value={caseType} disabled={loadingServiceCatalog} onChange={(event) => { setCaseType(event.target.value as CaseType); setSpecialty(""); setGeneralDoctor(""); setRequestId(crypto.randomUUID()); }} className={inputClass}><option value="general" disabled={!catalog.services.general.active}>{catalog.services.general.label} · {money(catalog.services.general.fee)}{catalog.services.general.active ? "" : " · unavailable"}</option><option value="specialist" disabled={!specialistActive}>Specialist case{specialistFeeLabel ? ` · ${specialistFeeLabel}` : " · unavailable"}</option></select></label>
            {caseType === "specialist" ? (
              <label className={labelClass}>Specialist department<select required value={specialty} disabled={loadingServiceCatalog} onChange={(event) => { setSpecialty(event.target.value as Specialty); setRequestId(crypto.randomUUID()); }} className={inputClass}><option value="" disabled>Select department</option><option value="pediatrics" disabled={!catalog.services.pediatrics.active}>{catalog.services.pediatrics.label} · {doctors[0]} · {money(catalog.services.pediatrics.fee)}{catalog.services.pediatrics.active ? "" : " · unavailable"}</option><option value="obg" disabled={!catalog.services.obg.active}>{catalog.services.obg.label} · {doctors[1]} · {money(catalog.services.obg.fee)}{catalog.services.obg.active ? "" : " · unavailable"}</option></select></label>
            ) : (
              <label className={labelClass}>Consulting doctor<select required value={generalDoctor} onChange={(event) => { setGeneralDoctor(event.target.value); setRequestId(crypto.randomUUID()); }} className={inputClass}><option value="" disabled>Select doctor</option>{doctors.map((doctor) => <option key={doctor}>{doctor}</option>)}</select></label>
            )}
          </div>

          <div className="mt-6 flex flex-col gap-4 rounded-2xl bg-blue-50 p-4 ring-1 ring-blue-100 sm:flex-row sm:items-center sm:justify-between">
            <div><p className="text-xs font-bold uppercase tracking-wide text-blue-700">Consultation charge</p><p className="mt-1 font-semibold text-slate-700">{doctorName ? `${consultationLabel} · ${doctorName}` : "Select the doctor or department"}</p></div>
            <strong className="text-2xl text-[#233A59]">{money(fee)}</strong>
          </div>
          <button type="submit" disabled={loadingServiceCatalog || Boolean(serviceCatalogError)} className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#233A59] px-5 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">{loadingServiceCatalog ? "Loading current fees…" : "Review patient & fee"} <ArrowRight size={18} /></button>
        </form>
      ) : null}

      {stage === "review" ? (
        <section className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-7">
          <div className="flex items-start gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-amber-50 text-amber-700"><ClipboardCheck size={21} /></span><div><p className="text-xs font-bold uppercase tracking-[0.15em] text-[#A8864A]">Step 2</p><h2 className="mt-1 text-xl font-bold text-[#233A59]">Confirm before saving</h2><p className="mt-1 text-sm text-slate-500">Patient registration and invoice are saved together in one secure action.</p></div></div>
          <dl className="mt-6 grid gap-3 rounded-2xl bg-slate-50 p-4 text-sm sm:grid-cols-2 sm:p-5">
            <div><dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Patient</dt><dd className="mt-1 font-bold text-[#233A59]">{fullName}</dd></div>
            <div><dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Mobile</dt><dd className="mt-1 font-bold text-[#233A59]">{phone}</dd></div>
            <div><dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Patient record</dt><dd className="mt-1 font-bold text-[#233A59]">{selectedExisting ? `Existing · ${selectedExisting.patientNumber || "chart selected"}` : "New patient chart"}</dd></div>
            <div><dt className="text-xs font-bold uppercase tracking-wide text-slate-500">DOB / gender</dt><dd className="mt-1 font-bold capitalize text-[#233A59]">{friendlyDate(dateOfBirth)} · {gender}</dd></div>
            <div className="sm:col-span-2"><dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Visit</dt><dd className="mt-1 font-bold text-[#233A59]">{consultationLabel} · {doctorName}</dd></div>
          </dl>
          <div className="mt-5 flex items-center justify-between rounded-2xl bg-emerald-50 p-4"><span className="flex items-center gap-2 font-bold text-emerald-900"><IndianRupee size={19} />Amount due</span><strong className="text-2xl text-emerald-800">{money(fee)}</strong></div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <button type="button" onClick={() => setStage("identify")} disabled={saving} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-slate-200 px-5 font-bold text-slate-700 disabled:opacity-50"><ArrowLeft size={18} />Edit details</button>
            <button type="button" onClick={() => void createArrival()} disabled={saving || loadingServiceCatalog || Boolean(serviceCatalogError) || !selectedService?.active} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#A8864A] px-5 font-bold text-white disabled:cursor-not-allowed disabled:opacity-60">{saving ? <LoaderCircle className="animate-spin" size={18} /> : <UserRoundCheck size={18} />}{saving ? "Saving securely…" : loadingServiceCatalog ? "Confirming current fee…" : selectedExisting ? "Create visit invoice" : "Register & create invoice"}</button>
          </div>
        </section>
      ) : null}

      {stage === "payment" && result ? (
        <section className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-7">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.15em] text-[#A8864A]">Step 3</p><h2 className="mt-1 text-xl font-bold text-[#233A59]">Collect payment and print</h2><p className="mt-1 text-sm text-slate-500">The patient and invoice are saved. Documents unlock after server-confirmed payment.</p></div><button type="button" onClick={resetWorkflow} className="min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-bold text-[#233A59]">Start next patient</button></div>
          <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-cyan-200 bg-cyan-50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="flex items-center gap-2 font-bold text-cyan-950"><CheckCircle2 size={18} />Patient checked in</p>
              <p className="mt-1 text-sm text-cyan-800">The visit is now visible in the doctor’s live queue.</p>
            </div>
            <div className="rounded-2xl bg-[#233A59] px-5 py-3 text-center text-white">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/65">Queue token</p>
              <p className="mt-1 text-2xl font-black">{result.appointment.queueLabel}</p>
            </div>
          </div>
          <ReceptionPayment key={result.invoice.id} patient={result.patient} invoice={result.invoice} consultationLabel={result.consultationLabel} />
          <p className="mt-4 text-center text-xs text-slate-500">For cash, card, or manual UPI entry, open <Link href="/admin/billing" className="font-bold text-[#233A59] underline">Billing</Link> and select this invoice.</p>
        </section>
      ) : null}
    </div>
  );
}
