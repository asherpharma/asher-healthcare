"use client";

import AdminShell from "@/components/admin/AdminShell";
import { useStaff } from "@/components/admin/StaffGuard";
import { firestore, storage } from "@/firebase/config";
import { downloadBlankPrescriptionPdf, downloadPrescriptionPdf } from "@/lib/prescription-pdf";
import {
  addDoc,
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Timestamp,
} from "firebase/firestore";
import { getBlob, ref, uploadBytes } from "firebase/storage";
import {
  Activity,
  Baby,
  CalendarClock,
  ChevronRight,
  ClipboardPlus,
  Download,
  ExternalLink,
  FileHeart,
  FileText,
  FileUp,
  LoaderCircle,
  NotebookTabs,
  Plus,
  Search,
  ShieldCheck,
  Stethoscope,
  Syringe,
  UserRound,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";

type Gender = "female" | "male" | "other";
type Patient = {
  id: string;
  patientNumber?: string;
  fullName: string;
  phone: string;
  dateOfBirth: string;
  gender: Gender;
  doctorName?: string;
  address: string;
  allergies: string;
  medicalHistory: string;
  createdAt?: Timestamp;
};
type BaseRecord = { id: string; createdAt?: Timestamp };
type VisitRecord = BaseRecord & {
  visitDate: string;
  doctorName: string;
  chiefComplaint: string;
  vitals: string;
  diagnosis: string;
  treatment: string;
  followUpDate: string;
  notes: string;
};
type PrescriptionRecord = BaseRecord & {
  prescribedDate: string;
  doctorName: string;
  medicines: Array<{ name: string; dose: string; frequency: string; duration: string; instructions: string }>;
  advice: string;
};
type VaccinationRecord = BaseRecord & {
  vaccineName: string;
  administeredDate: string;
  nextDueDate: string;
  batchNumber: string;
  notes: string;
};
type PregnancyRecord = BaseRecord & {
  recordedDate: string;
  lmpDate: string;
  eddDate: string;
  gestationalWeeks: string;
  bloodPressure: string;
  weight: string;
  fetalHeartRate: string;
  nextVisitDate: string;
  notes: string;
};
type ReportRecord = BaseRecord & {
  fileName: string;
  storagePath: string;
  contentType: string;
  size: number;
  category: string;
  reportDate: string;
  notes: string;
};
type TabKey = "overview" | "visits" | "prescriptions" | "vaccinations" | "pregnancy" | "reports";

const inputClass = "mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 font-normal text-slate-900 outline-none transition focus:border-[#233A59] focus:ring-2 focus:ring-[#233A59]/10";
const labelClass = "text-sm font-bold text-slate-700";
const cardClass = "rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200";

function text(form: FormData, name: string) {
  return String(form.get(name) ?? "").trim();
}

function formatCreatedAt(value?: Timestamp) {
  return value ? value.toDate().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "Just now";
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function PatientRegister() {
  const { user, profile } = useStaff();
  const db = firestore!;
  const files = storage!;
  const [patients, setPatients] = useState<Patient[]>([]);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [lastRegistered, setLastRegistered] = useState<Patient | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [visits, setVisits] = useState<VisitRecord[]>([]);
  const [prescriptions, setPrescriptions] = useState<PrescriptionRecord[]>([]);
  const [vaccinations, setVaccinations] = useState<VaccinationRecord[]>([]);
  const [pregnancyRecords, setPregnancyRecords] = useState<PregnancyRecord[]>([]);
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [uploading, setUploading] = useState(false);
  const [reportActionId, setReportActionId] = useState<string | null>(null);

  useEffect(() => {
    const patientsQuery = query(collection(db, "patients"), orderBy("createdAt", "desc"), limit(100));
    return onSnapshot(patientsQuery, (snapshot) => {
      setPatients(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Patient));
    });
  }, [db]);

  const selectedPatient = useMemo(
    () => patients.find((patient) => patient.id === selectedId) ?? null,
    [patients, selectedId],
  );

  useEffect(() => {
    if (!selectedId) return;
    const subscribe = <T extends BaseRecord>(name: string, setter: (items: T[]) => void) =>
      onSnapshot(
        query(collection(db, "patients", selectedId, name), orderBy("createdAt", "desc"), limit(50)),
        (snapshot) => setter(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as T)),
      );
    const unsubscribers = [
      subscribe<VisitRecord>("visits", setVisits),
      subscribe<PrescriptionRecord>("prescriptions", setPrescriptions),
      subscribe<VaccinationRecord>("vaccinations", setVaccinations),
      subscribe<PregnancyRecord>("pregnancyRecords", setPregnancyRecords),
      subscribe<ReportRecord>("reports", setReports),
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [db, selectedId]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return patients;
    return patients.filter((patient) =>
      [patient.fullName, patient.phone, patient.patientNumber ?? ""].some((value) => value.toLowerCase().includes(term)),
    );
  }, [patients, search]);

  async function addPatient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const patientRef = doc(collection(db, "patients"));
    const patientNumber = "ASH-" + patientRef.id.slice(0, 7).toUpperCase();
    const patientData = {
      patientNumber,
      fullName: text(form, "fullName"),
      phone: text(form, "phone"),
      dateOfBirth: text(form, "dateOfBirth"),
      gender: text(form, "gender") as Gender,
      doctorName: text(form, "doctorName"),
      address: text(form, "address"),
      allergies: text(form, "allergies"),
      medicalHistory: text(form, "medicalHistory"),
    };
    try {
      await setDoc(patientRef, {
        ...patientData,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      event.currentTarget.reset();
      setShowForm(false);
      setSelectedId(patientRef.id);
      setLastRegistered({ id: patientRef.id, ...patientData });
      setMessage("Patient registered securely. The prescription letterhead is ready.");
    } catch {
      setMessage("Patient registration failed. Please check access and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function editPatient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPatient) return;
    setSaving(true);
    const form = new FormData(event.currentTarget);
    try {
      await updateDoc(doc(db, "patients", selectedPatient.id), {
        fullName: text(form, "fullName"),
        phone: text(form, "phone"),
        dateOfBirth: text(form, "dateOfBirth"),
        gender: text(form, "gender"),
        doctorName: text(form, "doctorName"),
        address: text(form, "address"),
        allergies: text(form, "allergies"),
        medicalHistory: text(form, "medicalHistory"),
        updatedAt: serverTimestamp(),
      });
      setShowEdit(false);
      setMessage("Patient profile updated.");
    } catch {
      setMessage("Patient update failed.");
    } finally {
      setSaving(false);
    }
  }

  async function saveRecord(event: FormEvent<HTMLFormElement>, collectionName: string, payload: Record<string, unknown>) {
    event.preventDefault();
    if (!selectedPatient) return;
    setSaving(true);
    setMessage("");
    try {
      await addDoc(collection(db, "patients", selectedPatient.id, collectionName), {
        ...payload,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      event.currentTarget.reset();
      setMessage("Record saved securely.");
    } catch {
      setMessage("Unable to save this record. Please check access and try again.");
    } finally {
      setSaving(false);
    }
  }



  async function uploadReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPatient) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const file = form.get("reportFile");
    if (!(file instanceof File) || file.size === 0) {
      setMessage("Choose a PDF or image to upload.");
      return;
    }
    if (file.type !== "application/pdf" && !file.type.startsWith("image/")) {
      setMessage("Only PDF and image reports are allowed.");
      return;
    }
    if (file.size >= 10 * 1024 * 1024) {
      setMessage("Reports must be smaller than 10 MB.");
      return;
    }

    setUploading(true);
    setMessage("");
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-") || "report";
    const storagePath = "reports/" + selectedPatient.id + "/" + Date.now() + "-" + safeName;
    try {
      await uploadBytes(ref(files, storagePath), file, {
        contentType: file.type,
        customMetadata: { patientId: selectedPatient.id, uploadedBy: user.uid },
      });
      await addDoc(collection(db, "patients", selectedPatient.id, "reports"), {
        fileName: file.name,
        storagePath,
        contentType: file.type,
        size: file.size,
        category: text(form, "category"),
        reportDate: text(form, "reportDate"),
        notes: text(form, "notes"),
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      formElement.reset();
      setMessage("Medical report uploaded securely.");
    } catch {
      setMessage("Unable to upload this report. Please check access and try again.");
    } finally {
      setUploading(false);
    }
  }

  async function accessReport(record: ReportRecord, mode: "view" | "download") {
    setReportActionId(record.id);
    setMessage("");
    try {
      const blob = await getBlob(ref(files, record.storagePath));
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      if (mode === "view") {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      } else {
        link.download = record.fileName;
      }
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setMessage("Unable to open this report. Please check access and try again.");
    } finally {
      setReportActionId(null);
    }
  }

  const tabs: Array<{ key: TabKey; label: string; icon: typeof Activity; count?: number }> = [
    { key: "overview", label: "Overview", icon: UserRound },
    { key: "visits", label: "Visits", icon: Stethoscope, count: visits.length },
    { key: "prescriptions", label: "Prescriptions", icon: FileHeart, count: prescriptions.length },
    { key: "vaccinations", label: "Vaccinations", icon: Syringe, count: vaccinations.length },
    { key: "pregnancy", label: "Pregnancy", icon: Baby, count: pregnancyRecords.length },
    { key: "reports", label: "Reports", icon: FileText, count: reports.length },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#A8864A]">Patient register</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-[#233A59]">Patient records</h1>
          <p className="mt-3 text-slate-600">Private clinical records for registered patients.</p>
        </div>
        <button onClick={() => { setShowForm((value) => !value); setLastRegistered(null); }} className="inline-flex items-center gap-2 rounded-xl bg-[#233A59] px-5 py-3 text-sm font-bold text-white">
          <Plus size={18} /> Register patient
        </button>
      </div>

      {message && <p className="mt-5 rounded-xl bg-blue-50 px-4 py-3 text-sm font-medium text-blue-800">{message}</p>}
      {lastRegistered && (
        <div className="mt-4 flex flex-col gap-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-bold text-emerald-900">Blank prescription prepared for {lastRegistered.fullName}</p>
            <p className="mt-1 text-sm text-emerald-800">
              Patient ID, mobile number, age and {lastRegistered.doctorName} are already included.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void downloadBlankPrescriptionPdf(lastRegistered, lastRegistered.doctorName ?? "")}
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-[#233A59] px-4 py-3 text-sm font-bold text-white"
          >
            <Download size={17} /> Download letterhead
          </button>
        </div>
      )}

      {showForm && (
        <form onSubmit={addPatient} className={cardClass + " mt-6 grid gap-4 sm:grid-cols-2"}>
          <div className="flex items-center justify-between sm:col-span-2">
            <div><p className="text-xs font-bold uppercase tracking-widest text-[#A8864A]">Registration</p><h2 className="mt-1 text-xl font-bold text-[#233A59]">New patient</h2></div>
            <button type="button" onClick={() => setShowForm(false)} aria-label="Close registration"><X size={20} /></button>
          </div>
          <label className={labelClass}>Full name<input name="fullName" required minLength={2} maxLength={100} className={inputClass} /></label>
          <label className={labelClass}>Mobile number<input name="phone" type="tel" required minLength={10} maxLength={20} className={inputClass} /></label>
          <label className={labelClass}>Date of birth<input name="dateOfBirth" type="date" required className={inputClass} /></label>
          <label className={labelClass}>Gender<select name="gender" required defaultValue="" className={inputClass}><option value="" disabled>Select</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></select></label>
          <label className={labelClass + " sm:col-span-2"}>Consulting doctor<select name="doctorName" required defaultValue="" className={inputClass}><option value="" disabled>Select doctor</option><option>Dr. Lt Col Shafi Ahamad</option><option>Dr. Shaik Reshma</option></select></label>
          <label className={labelClass + " sm:col-span-2"}>Address<textarea name="address" rows={2} required maxLength={300} className={inputClass} /></label>
          <label className={labelClass}>Known allergies<textarea name="allergies" rows={3} maxLength={500} className={inputClass} /></label>
          <label className={labelClass}>Medical history<textarea name="medicalHistory" rows={3} maxLength={1000} className={inputClass} /></label>
          <div className="flex gap-3 sm:col-span-2"><SaveButton saving={saving} label="Save & prepare prescription" /><button type="button" onClick={() => setShowForm(false)} className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-bold text-slate-700">Cancel</button></div>
        </form>
      )}

      <div className="mt-7 grid gap-6 xl:grid-cols-[0.72fr_1.28fr]">
        <section>
          <label className="relative block"><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={19} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, mobile or patient ID" className="w-full rounded-2xl border border-slate-200 bg-white py-3.5 pl-12 pr-4 outline-none focus:border-[#233A59]" /></label>
          <div className="mt-5 space-y-3">
            {filtered.map((patient) => {
              const selected = patient.id === selectedId;
              return (
                <button key={patient.id} type="button" onClick={() => { setSelectedId(patient.id); setActiveTab("overview"); setShowEdit(false); }} className={"flex w-full items-center gap-4 rounded-2xl p-4 text-left shadow-sm ring-1 transition " + (selected ? "bg-[#233A59] text-white ring-[#233A59]" : "bg-white text-slate-700 ring-slate-200 hover:ring-[#A8864A]")}>
                  <span className={"flex h-11 w-11 shrink-0 items-center justify-center rounded-xl " + (selected ? "bg-white/10" : "bg-blue-50 text-blue-700")}><UserRound size={20} /></span>
                  <span className="min-w-0 flex-1"><span className="block truncate font-bold">{patient.fullName}</span><span className={"mt-1 block text-xs " + (selected ? "text-slate-200" : "text-slate-500")}>{patient.patientNumber ?? "Patient"} · {patient.phone}</span></span>
                  <ChevronRight size={18} />
                </button>
              );
            })}
          </div>
          {filtered.length === 0 && <div className={cardClass + " mt-5 text-center"}><UserRound className="mx-auto text-[#A8864A]" size={34} /><p className="mt-4 font-bold text-[#233A59]">No matching patients</p></div>}
        </section>

        <section>
          {!selectedPatient ? (
            <div className={cardClass + " flex min-h-80 flex-col items-center justify-center text-center"}><NotebookTabs className="text-[#A8864A]" size={42} /><h2 className="mt-5 text-xl font-bold text-[#233A59]">Select a patient</h2><p className="mt-2 max-w-sm text-sm leading-6 text-slate-600">Open a profile to review visits, prescriptions, vaccinations and pregnancy follow-up.</p></div>
          ) : (
            <div className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-200">
              <div className="bg-[#233A59] p-6 text-white sm:p-8">
                <div className="flex flex-wrap justify-between gap-5"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#D4B873]">{selectedPatient.patientNumber ?? "Patient profile"}</p><h2 className="mt-2 text-2xl font-bold">{selectedPatient.fullName}</h2><p className="mt-2 text-sm text-slate-200">{selectedPatient.phone} · DOB {selectedPatient.dateOfBirth}{selectedPatient.doctorName ? " · " + selectedPatient.doctorName : ""}</p></div><div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10"><ShieldCheck size={27} /></div></div>
              </div>
              <div className="flex gap-2 overflow-x-auto border-b border-slate-200 p-3">
                {tabs.map(({ key, label, icon: Icon, count }) => <button key={key} type="button" onClick={() => setActiveTab(key)} className={"inline-flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold " + (activeTab === key ? "bg-[#233A59] text-white" : "text-slate-600 hover:bg-slate-100")}><Icon size={16} />{label}{typeof count === "number" && <span className="rounded-full bg-white/15 px-1.5 text-xs">{count}</span>}</button>)}
              </div>
              <div className="p-5 sm:p-7">
                {activeTab === "overview" && <Overview patient={selectedPatient} showEdit={showEdit} setShowEdit={setShowEdit} editPatient={editPatient} saving={saving} />}
                {activeTab === "visits" && <VisitsPanel records={visits} saving={saving} onSave={(event) => { const form = new FormData(event.currentTarget); return saveRecord(event, "visits", { visitDate: text(form, "visitDate"), doctorName: text(form, "doctorName"), chiefComplaint: text(form, "chiefComplaint"), vitals: text(form, "vitals"), diagnosis: text(form, "diagnosis"), treatment: text(form, "treatment"), followUpDate: text(form, "followUpDate"), notes: text(form, "notes") }); }} />}
                {activeTab === "prescriptions" && <PrescriptionsPanel patient={selectedPatient} records={prescriptions} saving={saving} onSave={(event) => { const form = new FormData(event.currentTarget); return saveRecord(event, "prescriptions", { prescribedDate: text(form, "prescribedDate"), doctorName: text(form, "doctorName"), medicines: [{ name: text(form, "medicineName"), dose: text(form, "dose"), frequency: text(form, "frequency"), duration: text(form, "duration"), instructions: text(form, "instructions") }], advice: text(form, "advice") }); }} />}
                {activeTab === "vaccinations" && <VaccinationsPanel records={vaccinations} saving={saving} onSave={(event) => { const form = new FormData(event.currentTarget); return saveRecord(event, "vaccinations", { vaccineName: text(form, "vaccineName"), administeredDate: text(form, "administeredDate"), nextDueDate: text(form, "nextDueDate"), batchNumber: text(form, "batchNumber"), notes: text(form, "notes") }); }} />}
                {activeTab === "pregnancy" && <PregnancyPanel records={pregnancyRecords} saving={saving} onSave={(event) => { const form = new FormData(event.currentTarget); return saveRecord(event, "pregnancyRecords", { recordedDate: text(form, "recordedDate"), lmpDate: text(form, "lmpDate"), eddDate: text(form, "eddDate"), gestationalWeeks: text(form, "gestationalWeeks"), bloodPressure: text(form, "bloodPressure"), weight: text(form, "weight"), fetalHeartRate: text(form, "fetalHeartRate"), nextVisitDate: text(form, "nextVisitDate"), notes: text(form, "notes") }); }} />}
                {activeTab === "reports" && <ReportsPanel records={reports} uploading={uploading} actionId={reportActionId} onUpload={uploadReport} onAccess={accessReport} />}
              </div>
            </div>
          )}
        </section>
      </div>
      <p className="mt-6 text-xs text-slate-500">Signed in as {profile.displayName}. Medical data is restricted to approved clinic staff.</p>
    </div>
  );
}

function SaveButton({ saving, label }: { saving: boolean; label: string }) {
  return <button disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-[#233A59] px-5 py-3 text-sm font-bold text-white disabled:opacity-60">{saving && <LoaderCircle className="animate-spin" size={17} />}{label}</button>;
}

function SectionHeading({ icon: Icon, title, action }: { icon: typeof Activity; title: string; action?: string }) {
  return <div className="mb-5 flex items-center gap-3"><span className="rounded-xl bg-blue-50 p-2.5 text-blue-700"><Icon size={20} /></span><div><h3 className="font-bold text-[#233A59]">{title}</h3>{action && <p className="text-xs text-slate-500">{action}</p>}</div></div>;
}

function BlankPrescriptionAction({ patient }: { patient: Patient }) {
  const [doctorName, setDoctorName] = useState(patient.doctorName ?? "");

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <select
        aria-label="Doctor for blank prescription"
        value={doctorName}
        onChange={(event) => setDoctorName(event.target.value)}
        className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-[#233A59]"
      >
        <option value="">Select doctor</option>
        <option>Dr. Lt Col Shafi Ahamad</option>
        <option>Dr. Shaik Reshma</option>
      </select>
      <button
        type="button"
        disabled={!doctorName}
        onClick={() => void downloadBlankPrescriptionPdf(patient, doctorName)}
        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[#233A59] px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Download size={16} /> Blank prescription
      </button>
    </div>
  );
}

function Overview({ patient, showEdit, setShowEdit, editPatient, saving }: { patient: Patient; showEdit: boolean; setShowEdit: (value: boolean) => void; editPatient: (event: FormEvent<HTMLFormElement>) => Promise<void>; saving: boolean }) {
  if (showEdit) {
    return (
      <form key={patient.id} onSubmit={editPatient} className="grid gap-4 sm:grid-cols-2">
        <SectionHeading icon={UserRound} title="Edit patient profile" action="Keep identity and clinical background current" />
        <span className="hidden sm:block" />
        <label className={labelClass}>Full name<input name="fullName" required defaultValue={patient.fullName} className={inputClass} /></label>
        <label className={labelClass}>Mobile number<input name="phone" required defaultValue={patient.phone} className={inputClass} /></label>
        <label className={labelClass}>Date of birth<input name="dateOfBirth" type="date" required defaultValue={patient.dateOfBirth} className={inputClass} /></label>
        <label className={labelClass}>Gender<select name="gender" defaultValue={patient.gender} className={inputClass}><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></select></label>
        <label className={labelClass + " sm:col-span-2"}>Consulting doctor<select name="doctorName" required defaultValue={patient.doctorName ?? ""} className={inputClass}><option value="" disabled>Select doctor</option><option>Dr. Lt Col Shafi Ahamad</option><option>Dr. Shaik Reshma</option></select></label>
        <label className={labelClass + " sm:col-span-2"}>Address<textarea name="address" defaultValue={patient.address} rows={2} className={inputClass} /></label>
        <label className={labelClass}>Known allergies<textarea name="allergies" defaultValue={patient.allergies} rows={3} className={inputClass} /></label>
        <label className={labelClass}>Medical history<textarea name="medicalHistory" defaultValue={patient.medicalHistory} rows={3} className={inputClass} /></label>
        <div className="flex gap-3 sm:col-span-2"><SaveButton saving={saving} label="Update profile" /><button type="button" onClick={() => setShowEdit(false)} className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-bold">Cancel</button></div>
      </form>
    );
  }

  return (
    <div>
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <SectionHeading icon={ClipboardPlus} title="Clinical overview" action="Identity, allergies and medical background" />
        <div className="flex flex-col gap-2">
          <BlankPrescriptionAction key={patient.id + ":" + (patient.doctorName ?? "")} patient={patient} />
          <button type="button" onClick={() => setShowEdit(true)} className="self-end rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-[#233A59]">Edit profile</button>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Info label="Consulting doctor" value={patient.doctorName || "Not assigned"} />
        <Info label="Gender" value={patient.gender} />
        <Info label="Address" value={patient.address} />
        <Info label="Known allergies" value={patient.allergies || "None recorded"} alert={Boolean(patient.allergies)} />
        <Info label="Medical history" value={patient.medicalHistory || "No history recorded"} />
      </div>
    </div>
  );
}

function Info({ label, value, alert = false }: { label: string; value: string; alert?: boolean }) {
  return <div className={"rounded-2xl p-4 " + (alert ? "bg-amber-50 ring-1 ring-amber-200" : "bg-slate-50")}><p className="text-xs font-bold uppercase tracking-wider text-slate-500">{label}</p><p className="mt-2 whitespace-pre-wrap text-sm font-medium capitalize text-slate-800">{value}</p></div>;
}

function VisitsPanel({ records, saving, onSave }: { records: VisitRecord[]; saving: boolean; onSave: (event: FormEvent<HTMLFormElement>) => Promise<void> }) {
  return <div><SectionHeading icon={Stethoscope} title="Visit history" action="Consultation notes and follow-up" /><form onSubmit={onSave} className="grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-2"><label className={labelClass}>Visit date<input name="visitDate" type="date" required className={inputClass} /></label><label className={labelClass}>Doctor<select name="doctorName" required defaultValue="" className={inputClass}><option value="" disabled>Select doctor</option><option>Dr. Lt Col Shafi Ahamad</option><option>Dr. Shaik Reshma</option></select></label><label className={labelClass + " sm:col-span-2"}>Chief complaint<textarea name="chiefComplaint" required rows={2} className={inputClass} /></label><label className={labelClass}>Vitals<input name="vitals" placeholder="Temp, pulse, BP, weight" className={inputClass} /></label><label className={labelClass}>Follow-up date<input name="followUpDate" type="date" className={inputClass} /></label><label className={labelClass}>Diagnosis<textarea name="diagnosis" required rows={3} className={inputClass} /></label><label className={labelClass}>Treatment plan<textarea name="treatment" rows={3} className={inputClass} /></label><label className={labelClass + " sm:col-span-2"}>Clinical notes<textarea name="notes" rows={2} className={inputClass} /></label><div className="sm:col-span-2"><SaveButton saving={saving} label="Add visit" /></div></form><div className="mt-5 space-y-3">{records.map((record) => <article key={record.id} className="rounded-2xl border border-slate-200 p-4"><div className="flex flex-wrap justify-between gap-2"><p className="font-bold text-[#233A59]">{record.visitDate} · {record.doctorName}</p><span className="text-xs text-slate-500">{formatCreatedAt(record.createdAt)}</span></div><p className="mt-3 text-sm font-medium text-slate-800">{record.chiefComplaint}</p><p className="mt-2 text-sm text-slate-600"><strong>Diagnosis:</strong> {record.diagnosis}</p>{record.treatment && <p className="mt-1 text-sm text-slate-600"><strong>Plan:</strong> {record.treatment}</p>}{record.followUpDate && <p className="mt-3 inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2 py-1 text-xs font-bold text-blue-800"><CalendarClock size={13} /> Follow-up {record.followUpDate}</p>}</article>)}{records.length === 0 && <Empty label="No visits recorded yet" />}</div></div>;
}

function PrescriptionsPanel({ patient, records, saving, onSave }: { patient: Patient; records: PrescriptionRecord[]; saving: boolean; onSave: (event: FormEvent<HTMLFormElement>) => Promise<void> }) {
  return (
    <div>
      <SectionHeading icon={FileHeart} title="Prescriptions" action="Medication history and clinic-branded PDF prescriptions" />
      <form onSubmit={onSave} className="grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-2">
        <label className={labelClass}>Prescription date<input name="prescribedDate" type="date" required className={inputClass} /></label>
        <label className={labelClass}>Doctor<select name="doctorName" required defaultValue="" className={inputClass}><option value="" disabled>Select doctor</option><option>Dr. Lt Col Shafi Ahamad</option><option>Dr. Shaik Reshma</option></select></label>
        <label className={labelClass + " sm:col-span-2"}>Medicine<input name="medicineName" required className={inputClass} /></label>
        <label className={labelClass}>Dose<input name="dose" placeholder="e.g. 5 ml" className={inputClass} /></label>
        <label className={labelClass}>Frequency<input name="frequency" placeholder="e.g. twice daily" className={inputClass} /></label>
        <label className={labelClass}>Duration<input name="duration" placeholder="e.g. 5 days" className={inputClass} /></label>
        <label className={labelClass}>Instructions<input name="instructions" placeholder="After food" className={inputClass} /></label>
        <label className={labelClass + " sm:col-span-2"}>Advice<textarea name="advice" rows={2} className={inputClass} /></label>
        <div className="sm:col-span-2"><SaveButton saving={saving} label="Save prescription" /></div>
      </form>
      <div className="mt-5 space-y-3">
        {records.map((record) => (
          <article key={record.id} className="rounded-2xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <p className="font-bold text-[#233A59]">{record.prescribedDate} · {record.doctorName}</p>
              <button type="button" onClick={() => void downloadPrescriptionPdf(patient, record)} className="inline-flex items-center gap-2 rounded-xl border border-[#233A59]/20 bg-blue-50 px-3 py-2 text-xs font-bold text-[#233A59] transition hover:bg-blue-100">
                <Download size={15} /> Download PDF
              </button>
            </div>
            {record.medicines?.map((medicine, index) => <div key={index} className="mt-3 rounded-xl bg-slate-50 p-3"><p className="font-bold text-slate-800">{medicine.name}</p><p className="mt-1 text-sm text-slate-600">{[medicine.dose, medicine.frequency, medicine.duration].filter(Boolean).join(" · ")}</p>{medicine.instructions && <p className="mt-1 text-xs text-slate-500">{medicine.instructions}</p>}</div>)}
            {record.advice && <p className="mt-3 text-sm text-slate-600"><strong>Advice:</strong> {record.advice}</p>}
          </article>
        ))}
        {records.length === 0 && <Empty label="No prescriptions recorded yet" />}
      </div>
    </div>
  );
}

function VaccinationsPanel({ records, saving, onSave }: { records: VaccinationRecord[]; saving: boolean; onSave: (event: FormEvent<HTMLFormElement>) => Promise<void> }) {
  return <div><SectionHeading icon={Syringe} title="Vaccination record" action="Administered doses and reminders" /><form onSubmit={onSave} className="grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-2"><label className={labelClass + " sm:col-span-2"}>Vaccine name<input name="vaccineName" required className={inputClass} /></label><label className={labelClass}>Administered date<input name="administeredDate" type="date" required className={inputClass} /></label><label className={labelClass}>Next due date<input name="nextDueDate" type="date" className={inputClass} /></label><label className={labelClass}>Batch number<input name="batchNumber" className={inputClass} /></label><label className={labelClass}>Notes<input name="notes" className={inputClass} /></label><div className="sm:col-span-2"><SaveButton saving={saving} label="Add vaccination" /></div></form><div className="mt-5 space-y-3">{records.map((record) => <article key={record.id} className="flex items-start gap-4 rounded-2xl border border-slate-200 p-4"><span className="rounded-xl bg-emerald-50 p-3 text-emerald-700"><Syringe size={20} /></span><div><p className="font-bold text-[#233A59]">{record.vaccineName}</p><p className="mt-1 text-sm text-slate-600">Administered {record.administeredDate}{record.batchNumber ? " · Batch " + record.batchNumber : ""}</p>{record.nextDueDate && <p className="mt-2 text-xs font-bold text-blue-700">Next due {record.nextDueDate}</p>}</div></article>)}{records.length === 0 && <Empty label="No vaccinations recorded yet" />}</div></div>;
}

function PregnancyPanel({ records, saving, onSave }: { records: PregnancyRecord[]; saving: boolean; onSave: (event: FormEvent<HTMLFormElement>) => Promise<void> }) {
  return <div><SectionHeading icon={Baby} title="Pregnancy follow-up" action="Antenatal observations and visit planning" /><form onSubmit={onSave} className="grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-2"><label className={labelClass}>Recorded date<input name="recordedDate" type="date" required className={inputClass} /></label><label className={labelClass}>Gestational weeks<input name="gestationalWeeks" placeholder="e.g. 24 weeks" className={inputClass} /></label><label className={labelClass}>LMP date<input name="lmpDate" type="date" className={inputClass} /></label><label className={labelClass}>Expected delivery date<input name="eddDate" type="date" className={inputClass} /></label><label className={labelClass}>Blood pressure<input name="bloodPressure" placeholder="e.g. 120/80" className={inputClass} /></label><label className={labelClass}>Weight<input name="weight" placeholder="kg" className={inputClass} /></label><label className={labelClass}>Fetal heart rate<input name="fetalHeartRate" placeholder="bpm" className={inputClass} /></label><label className={labelClass}>Next visit<input name="nextVisitDate" type="date" className={inputClass} /></label><label className={labelClass + " sm:col-span-2"}>Notes<textarea name="notes" rows={3} className={inputClass} /></label><div className="sm:col-span-2"><SaveButton saving={saving} label="Save follow-up" /></div></form><div className="mt-5 space-y-3">{records.map((record) => <article key={record.id} className="rounded-2xl border border-slate-200 p-4"><div className="flex flex-wrap justify-between gap-2"><p className="font-bold text-[#233A59]">{record.recordedDate} · {record.gestationalWeeks || "Antenatal follow-up"}</p>{record.nextVisitDate && <span className="text-xs font-bold text-blue-700">Next visit {record.nextVisitDate}</span>}</div><div className="mt-3 grid grid-cols-2 gap-2 text-sm text-slate-600"><p>BP: {record.bloodPressure || "—"}</p><p>Weight: {record.weight || "—"}</p><p>FHR: {record.fetalHeartRate || "—"}</p><p>EDD: {record.eddDate || "—"}</p></div>{record.notes && <p className="mt-3 text-sm text-slate-600">{record.notes}</p>}</article>)}{records.length === 0 && <Empty label="No pregnancy follow-ups recorded yet" />}</div></div>;
}

function ReportsPanel({ records, uploading, actionId, onUpload, onAccess }: { records: ReportRecord[]; uploading: boolean; actionId: string | null; onUpload: (event: FormEvent<HTMLFormElement>) => Promise<void>; onAccess: (record: ReportRecord, mode: "view" | "download") => Promise<void> }) {
  return (
    <div>
      <SectionHeading icon={FileUp} title="Medical reports" action="PDFs and images protected by staff-only Firebase access" />
      <form onSubmit={onUpload} className="grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-2">
        <label className={labelClass}>Report category<select name="category" required defaultValue="" className={inputClass}><option value="" disabled>Select category</option><option>Lab report</option><option>Ultrasound / Imaging</option><option>Prescription / Referral</option><option>Vaccination document</option><option>Other</option></select></label>
        <label className={labelClass}>Report date<input name="reportDate" type="date" required className={inputClass} /></label>
        <label className={labelClass + " sm:col-span-2"}>Choose PDF or image<input name="reportFile" type="file" accept="application/pdf,image/*" required className={inputClass + " file:mr-4 file:rounded-lg file:border-0 file:bg-[#233A59] file:px-3 file:py-2 file:text-sm file:font-bold file:text-white"} /><span className="mt-2 block text-xs font-normal text-slate-500">Maximum 10 MB. Access is restricted to approved clinic staff.</span></label>
        <label className={labelClass + " sm:col-span-2"}>Notes<textarea name="notes" rows={2} className={inputClass} placeholder="Optional context for this report" /></label>
        <div className="sm:col-span-2"><SaveButton saving={uploading} label="Upload report securely" /></div>
      </form>
      <div className="mt-5 space-y-3">
        {records.map((record) => (
          <article key={record.id} className="rounded-2xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2"><FileText size={18} className="shrink-0 text-[#A8864A]" /><p className="truncate font-bold text-[#233A59]">{record.fileName}</p></div>
                <p className="mt-1 text-sm text-slate-600">{record.category} · {record.reportDate} · {formatFileSize(record.size)}</p>
                <p className="mt-1 text-xs text-slate-500">Uploaded {formatCreatedAt(record.createdAt)}</p>
              </div>
              <div className="flex gap-2">
                <button type="button" disabled={actionId === record.id} onClick={() => void onAccess(record, "view")} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50">{actionId === record.id ? <LoaderCircle size={15} className="animate-spin" /> : <ExternalLink size={15} />} View</button>
                <button type="button" disabled={actionId === record.id} onClick={() => void onAccess(record, "download")} className="inline-flex items-center gap-2 rounded-xl bg-[#233A59] px-3 py-2 text-xs font-bold text-white transition hover:bg-[#1b2d46] disabled:opacity-50"><Download size={15} /> Download</button>
              </div>
            </div>
            {record.notes && <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">{record.notes}</p>}
          </article>
        ))}
        {records.length === 0 && <Empty label="No medical reports uploaded yet" />}
      </div>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">{label}</div>;
}

export default function PatientsPage() {
  return <AdminShell><PatientRegister /></AdminShell>;
}
