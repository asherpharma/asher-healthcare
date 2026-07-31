"use client";

import { type StaffProfile, useStaff } from "@/components/admin/StaffGuard";
import { firestore } from "@/firebase/config";
import { preloadClinicPdfAssets } from "@/lib/clinic-pdf";
import {
  downloadPrescriptionPdf,
  printPrescriptionPdf,
  type PrescriptionPdfRecord,
} from "@/lib/prescription-pdf";
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
  type Timestamp,
} from "firebase/firestore";
import {
  Activity,
  AlertCircle,
  ArrowRight,
  CalendarCheck2,
  Check,
  CheckCircle2,
  ClipboardList,
  Download,
  FileHeart,
  FileText,
  FlaskConical,
  HeartPulse,
  History,
  LoaderCircle,
  Pill,
  Plus,
  Printer,
  Search,
  ShieldAlert,
  ShieldCheck,
  Stethoscope,
  Trash2,
  UserRound,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";

const DOCTORS = ["Dr. Lt Col Shafi Ahamad", "Dr. Shaik Reshma"] as const;
type DoctorName = (typeof DOCTORS)[number];

type Patient = {
  id: string;
  patientNumber?: string;
  fullName: string;
  phone: string;
  dateOfBirth: string;
  gender: string;
  doctorName?: string;
  caseType?: string;
  allergies?: string;
  medicalHistory?: string;
  createdAt?: Timestamp;
};

type Appointment = {
  id: string;
  patientName: string;
  phone: string;
  doctorId: string;
  preferredDate: string;
  preferredTime: string;
  reason: string;
  status: "requested" | "confirmed" | "completed" | "cancelled";
  source?: string;
  createdAt?: Timestamp;
};

type Visit = {
  id: string;
  visitDate: string;
  doctorName: string;
  chiefComplaint: string;
  vitals?: string;
  diagnosis: string;
  treatment?: string;
  followUpDate?: string;
  notes?: string;
  createdAt?: Timestamp;
};

type Prescription = PrescriptionPdfRecord & {
  createdAt?: Timestamp;
};

type Report = {
  id: string;
  fileName: string;
  category?: string;
  reportDate?: string;
  createdAt?: Timestamp;
};

type Medicine = {
  id: string;
  name: string;
  dose: string;
  frequency: string;
  duration: string;
  instructions: string;
};

type QueueEntry = {
  id: string;
  appointmentId?: string;
  patientId?: string;
  patientName: string;
  phone: string;
  doctorName: string;
  time: string;
  reason: string;
  status: Appointment["status"] | "registered";
  source: string;
};

const COMMON_TESTS = [
  "Complete Blood Count (CBC)",
  "C-reactive protein (CRP)",
  "Urine routine",
  "Thyroid profile",
  "Blood glucose",
  "HbA1c",
  "Liver function test",
  "Kidney function test",
  "Vitamin D",
  "Beta hCG",
];

const inputClass = "mt-2 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-[#233A59] focus:ring-2 focus:ring-[#233A59]/10";
const labelClass = "text-sm font-bold text-slate-700";
const cardClass = "rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6";

function clinicDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function timestampDate(value?: Timestamp) {
  return value?.toDate ? clinicDate(value.toDate()) : "";
}

function displayDate(value: string) {
  if (!value) return "Date not set";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function normalisePhone(value: string) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function doctorFromAppointment(doctorId?: string) {
  if (doctorId === "pediatrics") return DOCTORS[0];
  if (doctorId === "obg") return DOCTORS[1];
  return doctorId || "Doctor not assigned";
}

function doctorForProfile(profile: StaffProfile): DoctorName | "" {
  if (DOCTORS.includes(profile.doctorName as DoctorName)) {
    return profile.doctorName as DoctorName;
  }
  const identity = `${profile.displayName} ${profile.email}`.toLowerCase();
  if (identity.includes("shafi")) return DOCTORS[0];
  if (identity.includes("reshma")) return DOCTORS[1];
  return "";
}

function emptyMedicine(): Medicine {
  return {
    id: crypto.randomUUID(),
    name: "",
    dose: "",
    frequency: "",
    duration: "",
    instructions: "",
  };
}

function labOrderNumber() {
  const stamp = clinicDate().replaceAll("-", "");
  return `LAB-${stamp}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
}

function queueStatus(status: QueueEntry["status"]) {
  const labels: Record<QueueEntry["status"], string> = {
    requested: "Needs confirmation",
    confirmed: "Waiting",
    completed: "Completed",
    cancelled: "Cancelled",
    registered: "Walk-in registered",
  };
  return labels[status];
}

function queueTone(status: QueueEntry["status"]) {
  if (status === "completed") return "bg-emerald-50 text-emerald-700";
  if (status === "requested") return "bg-amber-50 text-amber-800";
  if (status === "confirmed") return "bg-blue-50 text-blue-700";
  return "bg-violet-50 text-violet-700";
}

function age(dateOfBirth: string) {
  const birth = new Date(`${dateOfBirth}T12:00:00`);
  if (Number.isNaN(birth.getTime())) return "Age not recorded";
  const today = new Date();
  let years = today.getFullYear() - birth.getFullYear();
  if (today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) years -= 1;
  return `${Math.max(0, years)} years`;
}

function RestrictedConsultations() {
  return (
    <section className="mx-auto max-w-2xl rounded-3xl border border-amber-200 bg-white p-8 text-center shadow-sm">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-amber-50 text-amber-700"><ShieldAlert size={28} /></span>
      <p className="mt-5 text-xs font-bold uppercase tracking-[0.18em] text-[#A8864A]">Clinical access</p>
      <h1 className="mt-2 text-3xl font-bold text-[#233A59]">Doctor workspace is restricted</h1>
      <p className="mt-3 leading-7 text-slate-600">Only doctors and administrators can create consultations and prescriptions. Reception workflows remain available in the patient and appointment desks.</p>
      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <Link href="/admin/appointments" className="rounded-xl bg-[#233A59] px-5 py-3 text-sm font-bold text-white">Appointments</Link>
        <Link href="/admin/patients" className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-bold text-[#233A59]">Patient register</Link>
      </div>
    </section>
  );
}

function UnlinkedDoctorProfile({ profile }: { profile: StaffProfile }) {
  return (
    <section className="mx-auto max-w-2xl rounded-3xl border border-blue-200 bg-white p-8 text-center shadow-sm">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-blue-50 text-blue-700"><Stethoscope size={28} /></span>
      <h1 className="mt-5 text-3xl font-bold text-[#233A59]">Doctor identity needs linking</h1>
      <p className="mt-3 leading-7 text-slate-600">The account <strong>{profile.displayName}</strong> must be linked to Dr. Lt Col Shafi Ahamad or Dr. Shaik Reshma before consultations can be signed.</p>
      <p className="mt-4 text-sm font-semibold text-blue-700">Ask an administrator to assign the doctor in Settings → Staff login access.</p>
    </section>
  );
}

function ConsultationWorkspace({ profile, profileDoctor }: { profile: StaffProfile; profileDoctor: DoctorName | "" }) {
  const db = firestore!;
  const today = clinicDate();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [patientsLoaded, setPatientsLoaded] = useState(false);
  const [appointmentsLoaded, setAppointmentsLoaded] = useState(false);
  const [selectedDate, setSelectedDate] = useState(today);
  const [doctorFilter, setDoctorFilter] = useState<"all" | DoctorName>(profileDoctor || "all");
  const [search, setSearch] = useState("");
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [selectedAppointmentId, setSelectedAppointmentId] = useState("");
  const [visits, setVisits] = useState<Visit[]>([]);
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [medicines, setMedicines] = useState<Medicine[]>([emptyMedicine()]);
  const [labTests, setLabTests] = useState<string[]>([]);
  const [customTest, setCustomTest] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [savedPrescription, setSavedPrescription] = useState<PrescriptionPdfRecord | null>(null);
  const [documentAction, setDocumentAction] = useState<"print" | "download" | null>(null);

  useEffect(() => {
    void preloadClinicPdfAssets().catch(() => undefined);
  }, []);

  useEffect(() => {
    const stopPatients = onSnapshot(
      query(collection(db, "patients"), orderBy("createdAt", "desc"), limit(300)),
      (snapshot) => {
        setPatients(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Patient));
        setPatientsLoaded(true);
      },
      (loadError) => {
        console.error(loadError);
        setError("Patient records could not be loaded.");
        setPatientsLoaded(true);
      },
    );
    const stopAppointments = onSnapshot(
      query(collection(db, "appointments"), orderBy("createdAt", "desc"), limit(300)),
      (snapshot) => {
        setAppointments(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Appointment));
        setAppointmentsLoaded(true);
      },
      (loadError) => {
        console.error(loadError);
        setError("The consultation queue could not be loaded.");
        setAppointmentsLoaded(true);
      },
    );
    return () => {
      stopPatients();
      stopAppointments();
    };
  }, [db]);

  useEffect(() => {
    if (!selectedPatientId) return;
    const patientRef = doc(db, "patients", selectedPatientId);
    const stopVisits = onSnapshot(
      query(collection(patientRef, "visits"), orderBy("createdAt", "desc"), limit(20)),
      (snapshot) => {
        setVisits(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Visit));
        setHistoryLoading(false);
      },
      () => {
        setError("Previous visit history could not be loaded.");
        setHistoryLoading(false);
      },
    );
    const stopPrescriptions = onSnapshot(
      query(collection(patientRef, "prescriptions"), orderBy("createdAt", "desc"), limit(20)),
      (snapshot) => setPrescriptions(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Prescription)),
    );
    const stopReports = onSnapshot(
      query(collection(patientRef, "reports"), orderBy("createdAt", "desc"), limit(20)),
      (snapshot) => setReports(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Report)),
    );
    return () => {
      stopVisits();
      stopPrescriptions();
      stopReports();
    };
  }, [db, selectedPatientId]);

  const selectedPatient = useMemo(
    () => patients.find((patient) => patient.id === selectedPatientId) ?? null,
    [patients, selectedPatientId],
  );
  const selectedAppointment = useMemo(
    () => appointments.find((appointment) => appointment.id === selectedAppointmentId) ?? null,
    [appointments, selectedAppointmentId],
  );

  const visiblePatients = useMemo(() => {
    const term = search.trim().toLowerCase();
    return patients
      .filter((patient) => !profileDoctor || patient.doctorName === profileDoctor)
      .filter((patient) => doctorFilter === "all" || patient.doctorName === doctorFilter)
      .filter((patient) => !term || [patient.fullName, patient.phone, patient.patientNumber].some((value) => String(value || "").toLowerCase().includes(term)))
      .slice(0, 12);
  }, [doctorFilter, patients, profileDoctor, search]);

  const queue = useMemo(() => {
    const patientsByPhone = new Map(patients.map((patient) => [normalisePhone(patient.phone), patient]));
    const entries: QueueEntry[] = appointments
      .filter((appointment) => appointment.preferredDate === selectedDate && appointment.status !== "cancelled")
      .filter((appointment) => !profileDoctor || doctorFromAppointment(appointment.doctorId) === profileDoctor)
      .filter((appointment) => doctorFilter === "all" || doctorFromAppointment(appointment.doctorId) === doctorFilter)
      .map((appointment) => {
        const patient = patientsByPhone.get(normalisePhone(appointment.phone));
        return {
          id: `appointment-${appointment.id}`,
          appointmentId: appointment.id,
          patientId: patient?.id,
          patientName: appointment.patientName || "Unnamed patient",
          phone: appointment.phone || "",
          doctorName: doctorFromAppointment(appointment.doctorId),
          time: appointment.preferredTime || "Walk-in",
          reason: appointment.reason || "Consultation",
          status: appointment.status,
          source: appointment.source || "website",
        };
      });

    const queuedPhones = new Set(entries.map((entry) => normalisePhone(entry.phone)));
    patients
      .filter((patient) => timestampDate(patient.createdAt) === selectedDate)
      .filter((patient) => !profileDoctor || patient.doctorName === profileDoctor)
      .filter((patient) => doctorFilter === "all" || patient.doctorName === doctorFilter)
      .filter((patient) => !queuedPhones.has(normalisePhone(patient.phone)))
      .forEach((patient) => entries.push({
        id: `patient-${patient.id}`,
        patientId: patient.id,
        patientName: patient.fullName,
        phone: patient.phone,
        doctorName: patient.doctorName || "Doctor not assigned",
        time: "Walk-in",
        reason: patient.caseType === "general" ? "General consultation" : "Specialist consultation",
        status: "registered",
        source: "reception",
      }));

    return entries.sort((left, right) => {
      if (left.status === "completed" && right.status !== "completed") return 1;
      if (right.status === "completed" && left.status !== "completed") return -1;
      return String(left.time || "Walk-in").localeCompare(String(right.time || "Walk-in"));
    });
  }, [appointments, doctorFilter, patients, profileDoctor, selectedDate]);

  const queueCounts = useMemo(() => ({
    total: queue.length,
    waiting: queue.filter((entry) => entry.status !== "completed").length,
    completed: queue.filter((entry) => entry.status === "completed").length,
  }), [queue]);

  function choosePatient(patientId: string, appointmentId = "") {
    setSelectedPatientId(patientId);
    setSelectedAppointmentId(appointmentId);
    setHistoryLoading(true);
    setVisits([]);
    setPrescriptions([]);
    setReports([]);
    setMedicines([emptyMedicine()]);
    setLabTests([]);
    setCustomTest("");
    setSavedPrescription(null);
    setNotice("");
    setError("");
  }

  function updateMedicine(id: string, field: keyof Omit<Medicine, "id">, value: string) {
    setMedicines((current) => current.map((medicine) => medicine.id === id ? { ...medicine, [field]: value } : medicine));
  }

  function toggleLab(test: string) {
    setLabTests((current) => current.includes(test) ? current.filter((item) => item !== test) : [...current, test]);
  }

  function addCustomLab() {
    const test = customTest.trim();
    if (!test || labTests.includes(test)) return;
    setLabTests((current) => [...current, test]);
    setCustomTest("");
  }

  async function completeConsultation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPatient) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const value = (name: string) => String(form.get(name) || "").trim();
    const doctorName = profileDoctor || value("doctorName");
    const chiefComplaint = value("chiefComplaint");
    const diagnosis = value("diagnosis");
    if (!DOCTORS.includes(doctorName as DoctorName)) {
      setError("Select the doctor who is signing this consultation.");
      return;
    }
    if (!chiefComplaint || !diagnosis) {
      setError("Chief complaint and diagnosis are required.");
      return;
    }

    const cleanMedicines = medicines
      .filter((medicine) => medicine.name.trim())
      .map((medicine) => ({
        name: medicine.name.trim(),
        dose: medicine.dose.trim(),
        frequency: medicine.frequency.trim(),
        duration: medicine.duration.trim(),
        instructions: medicine.instructions.trim(),
      }));
    const advice = value("advice");
    const followUpDate = value("followUpDate");
    const consultationId = crypto.randomUUID();
    const recordedAt = serverTimestamp();
    const visitRef = doc(collection(db, "patients", selectedPatient.id, "visits"));
    const prescriptionRef = cleanMedicines.length > 0 || advice
      ? doc(collection(db, "patients", selectedPatient.id, "prescriptions"))
      : null;
    const labRef = labTests.length > 0 ? doc(collection(db, "labOrders")) : null;
    const followUpRef = followUpDate ? doc(collection(db, "staffTasks")) : null;
    const auditRef = doc(collection(db, "auditLogs"));
    const vitals = [
      value("temperature") ? `Temp ${value("temperature")}` : "",
      value("pulse") ? `Pulse ${value("pulse")}` : "",
      value("bloodPressure") ? `BP ${value("bloodPressure")}` : "",
      value("spo2") ? `SpO2 ${value("spo2")}` : "",
      value("weight") ? `Weight ${value("weight")}` : "",
    ].filter(Boolean).join(" · ");

    setSaving(true);
    setError("");
    setNotice("");
    setSavedPrescription(null);

    try {
      const batch = writeBatch(db);
      batch.set(visitRef, {
        consultationId,
        appointmentId: selectedAppointment?.id || "",
        visitDate: selectedDate,
        doctorName,
        chiefComplaint,
        vitals,
        vitalSigns: {
          temperature: value("temperature"),
          pulse: value("pulse"),
          bloodPressure: value("bloodPressure"),
          spo2: value("spo2"),
          weight: value("weight"),
        },
        examinationFindings: value("examinationFindings"),
        diagnosis,
        treatment: value("treatment"),
        followUpDate,
        notes: value("clinicalNotes"),
        status: "completed",
        source: "doctor_workspace",
        createdBy: profile.uid,
        createdAt: recordedAt,
        updatedAt: recordedAt,
      });

      if (prescriptionRef) {
        batch.set(prescriptionRef, {
          consultationId,
          appointmentId: selectedAppointment?.id || "",
          prescribedDate: selectedDate,
          doctorName,
          medicines: cleanMedicines,
          advice,
          createdBy: profile.uid,
          createdAt: recordedAt,
          updatedAt: recordedAt,
        });
      }

      if (labRef) {
        batch.set(labRef, {
          orderNumber: labOrderNumber(),
          patientId: selectedPatient.id,
          patientNumber: selectedPatient.patientNumber || "",
          patientName: selectedPatient.fullName,
          patientPhone: selectedPatient.phone,
          tests: labTests,
          priority: value("labPriority") || "routine",
          clinician: doctorName,
          notes: value("labNotes"),
          status: "ordered",
          createdBy: profile.uid,
          orderedAt: recordedAt,
          updatedAt: recordedAt,
        });
      }

      if (followUpRef) {
        batch.set(followUpRef, {
          title: `Clinical follow-up: ${selectedPatient.fullName}`.slice(0, 120),
          details: `Follow-up after consultation with ${doctorName}. Diagnosis: ${diagnosis}`.slice(0, 1000),
          type: "follow_up",
          priority: value("followUpPriority") || "medium",
          status: "open",
          dueDate: followUpDate,
          dueTime: value("followUpTime") || "18:00",
          patientId: selectedPatient.id,
          patientName: selectedPatient.fullName,
          assignedTo: profile.uid,
          assignedToName: profile.displayName,
          createdBy: profile.uid,
          createdAt: recordedAt,
          updatedAt: recordedAt,
          completedAt: null,
          completedBy: "",
        });
      }

      if (selectedAppointment && selectedAppointment.status !== "completed") {
        batch.update(doc(db, "appointments", selectedAppointment.id), {
          status: "completed",
          updatedAt: recordedAt,
        });
      }

      batch.set(auditRef, {
        eventType: "consultation.completed",
        patientId: selectedPatient.id,
        patientName: selectedPatient.fullName,
        doctorName,
        appointmentId: selectedAppointment?.id || "",
        consultationId,
        actorUid: profile.uid,
        actorName: profile.displayName,
        createdAt: recordedAt,
      });

      await batch.commit();
      const prescriptionDocument = prescriptionRef ? {
        id: prescriptionRef.id,
        prescribedDate: selectedDate,
        doctorName,
        medicines: cleanMedicines,
        advice,
      } : null;
      setSavedPrescription(prescriptionDocument);
      setNotice(
        `Consultation completed securely.${prescriptionRef ? " Prescription saved." : ""}${labRef ? ` ${labTests.length} lab test${labTests.length === 1 ? "" : "s"} ordered.` : ""}${followUpRef ? " Follow-up task created." : ""}`,
      );
      formElement.reset();
      setMedicines([emptyMedicine()]);
      setLabTests([]);
      setCustomTest("");
    } catch (saveError) {
      console.error(saveError);
      setError("The consultation could not be completed. No partial clinical record was saved. Please check access and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function preparePrescription(mode: "print" | "download") {
    if (!selectedPatient || !savedPrescription) return;
    setDocumentAction(mode);
    setError("");
    try {
      await (mode === "print"
        ? printPrescriptionPdf(selectedPatient, savedPrescription)
        : downloadPrescriptionPdf(selectedPatient, savedPrescription));
    } catch (documentError) {
      setError(documentError instanceof Error ? documentError.message : "The prescription could not be prepared.");
    } finally {
      setDocumentAction(null);
    }
  }

  const loading = !patientsLoaded || !appointmentsLoaded;
  const selectedDoctor =
    profileDoctor
    || selectedPatient?.doctorName
    || (selectedAppointment ? doctorFromAppointment(selectedAppointment.doctorId) : "");

  return (
    <div>
      <div className="staff-page-heading flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.16em] text-[#A8864A]"><Stethoscope size={17} /> Doctor consultation workspace</div>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-[#233A59] sm:text-4xl">Queue, chart and consultation</h1>
          <p className="mt-3 max-w-3xl text-slate-600">Complete the clinical visit, prescription, lab orders and follow-up from one secure screen.</p>
        </div>
        <div className="staff-page-actions flex flex-col gap-3 sm:flex-row">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Queue date<input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} className="mt-1 block min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-[#233A59]" /></label>
          {profile.role === "admin" ? <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Doctor<select value={doctorFilter} onChange={(event) => setDoctorFilter(event.target.value as "all" | DoctorName)} className="mt-1 block min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-[#233A59]"><option value="all">All doctors</option>{DOCTORS.map((doctor) => <option key={doctor}>{doctor}</option>)}</select></label> : null}
        </div>
      </div>

      {error ? <div className="mt-5 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm font-semibold text-red-700"><AlertCircle size={18} className="mt-0.5 shrink-0" />{error}</div> : null}
      {notice ? <div className="mt-5 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-semibold text-emerald-800"><CheckCircle2 size={18} className="mt-0.5 shrink-0" />{notice}</div> : null}

      <section className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className={cardClass}><UsersRound size={22} className="text-blue-600" /><p className="mt-4 text-3xl font-bold text-[#233A59]">{loading ? "—" : queueCounts.total}</p><p className="mt-1 text-sm font-semibold text-slate-600">Queue for {selectedDate === today ? "today" : displayDate(selectedDate)}</p></div>
        <div className={cardClass}><HeartPulse size={22} className="text-amber-600" /><p className="mt-4 text-3xl font-bold text-[#233A59]">{loading ? "—" : queueCounts.waiting}</p><p className="mt-1 text-sm font-semibold text-slate-600">Waiting consultations</p></div>
        <div className={cardClass}><CheckCircle2 size={22} className="text-emerald-600" /><p className="mt-4 text-3xl font-bold text-[#233A59]">{loading ? "—" : queueCounts.completed}</p><p className="mt-1 text-sm font-semibold text-slate-600">Completed consultations</p></div>
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-[0.72fr_1.28fr]">
        <aside className="space-y-5">
          <section className={cardClass}>
            <div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#A8864A]">Live queue</p><h2 className="mt-1 text-xl font-bold text-[#233A59]">{displayDate(selectedDate)}</h2></div>{loading ? <LoaderCircle className="animate-spin text-slate-400" /> : <CalendarCheck2 className="text-blue-600" />}</div>
            <div className="mt-5 space-y-3">
              {queue.map((entry) => (
                <article key={entry.id} className={`rounded-2xl border p-4 transition ${selectedAppointmentId === entry.appointmentId && selectedPatientId === entry.patientId ? "border-[#A8864A] bg-[#F8F4EA]" : "border-slate-200 bg-white"}`}>
                  <div className="flex items-start justify-between gap-3"><div><p className="font-bold text-[#233A59]">{entry.patientName}</p><p className="mt-1 text-xs text-slate-500">{entry.time} · {entry.phone}</p></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${queueTone(entry.status)}`}>{queueStatus(entry.status)}</span></div>
                  <p className="mt-3 text-sm text-slate-600">{entry.reason || "Consultation"}</p>
                  <p className="mt-1 text-xs font-semibold text-slate-500">{entry.doctorName} · {entry.source}</p>
                  {entry.patientId ? <button type="button" onClick={() => choosePatient(entry.patientId!, entry.appointmentId)} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-[#233A59] px-3 py-2 text-xs font-bold text-white">Open chart <ArrowRight size={14} /></button> : <Link href="/admin/patients" className="mt-3 inline-flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">Register patient first <ArrowRight size={14} /></Link>}
                </article>
              ))}
              {!loading && queue.length === 0 ? <div className="rounded-2xl bg-slate-50 px-4 py-9 text-center"><CalendarCheck2 className="mx-auto text-slate-300" /><p className="mt-3 text-sm font-semibold text-slate-500">No patients in this queue.</p></div> : null}
            </div>
          </section>

          <section className={cardClass}>
            <div className="flex items-center gap-3"><span className="rounded-xl bg-blue-50 p-2.5 text-blue-700"><Search size={19} /></span><div><h2 className="font-bold text-[#233A59]">Find another patient</h2><p className="text-xs text-slate-500">Name, phone or patient ID</p></div></div>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search patient records" className={inputClass} />
            <div className="mt-4 max-h-80 space-y-2 overflow-y-auto pr-1">
              {visiblePatients.map((patient) => <button key={patient.id} type="button" onClick={() => choosePatient(patient.id)} className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-3 text-left transition ${selectedPatientId === patient.id && !selectedAppointmentId ? "border-[#A8864A] bg-[#F8F4EA]" : "border-slate-200 hover:bg-slate-50"}`}><span><span className="block text-sm font-bold text-[#233A59]">{patient.fullName}</span><span className="mt-1 block text-xs text-slate-500">{patient.patientNumber || "No patient ID"} · {patient.phone}</span></span><ArrowRight size={15} className="shrink-0 text-slate-400" /></button>)}
            </div>
          </section>
        </aside>

        <main>
          {!selectedPatient ? (
            <section className="grid min-h-[540px] place-items-center rounded-3xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
              <div className="max-w-md"><span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-blue-50 text-blue-700"><ClipboardList size={31} /></span><h2 className="mt-6 text-2xl font-bold text-[#233A59]">Select a patient to begin</h2><p className="mt-3 leading-7 text-slate-600">Choose someone from the queue or search the patient register. Previous clinical history will appear before you create the new consultation.</p></div>
            </section>
          ) : (
            <div className="space-y-6">
              <section className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-200">
                <div className="bg-[#233A59] p-5 text-white sm:p-7">
                  <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#D4B678]">{selectedPatient.patientNumber || "Patient chart"}</p><h2 className="mt-2 text-2xl font-bold">{selectedPatient.fullName}</h2><p className="mt-2 text-sm text-white/70">{selectedPatient.phone} · {age(selectedPatient.dateOfBirth)} · {selectedPatient.gender}</p></div><span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/10"><UserRound size={24} /></span></div>
                </div>
                <div className="grid gap-3 p-5 sm:grid-cols-2 sm:p-6">
                  <div className={`rounded-2xl p-4 ${selectedPatient.allergies ? "bg-red-50 ring-1 ring-red-200" : "bg-emerald-50"}`}><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Known allergies</p><p className={`mt-2 text-sm font-bold ${selectedPatient.allergies ? "text-red-800" : "text-emerald-800"}`}>{selectedPatient.allergies || "None recorded"}</p></div>
                  <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Medical history</p><p className="mt-2 whitespace-pre-wrap text-sm font-semibold text-slate-700">{selectedPatient.medicalHistory || "No medical history recorded"}</p></div>
                </div>
              </section>

              <section className={cardClass}>
                <div className="flex items-center gap-3"><span className="rounded-xl bg-violet-50 p-2.5 text-violet-700"><History size={20} /></span><div><h2 className="text-xl font-bold text-[#233A59]">Recent clinical history</h2><p className="text-xs text-slate-500">Review before prescribing</p></div>{historyLoading ? <LoaderCircle size={18} className="ml-auto animate-spin text-slate-400" /> : null}</div>
                <div className="mt-5 grid gap-4 lg:grid-cols-3">
                  <HistoryColumn title="Visits" icon={Activity} empty="No previous visits" items={visits.slice(0, 3).map((visit) => ({ id: visit.id, title: `${visit.visitDate} · ${visit.diagnosis}`, detail: visit.chiefComplaint }))} />
                  <HistoryColumn title="Prescriptions" icon={FileHeart} empty="No previous prescriptions" items={prescriptions.slice(0, 3).map((prescription) => ({ id: prescription.id, title: `${prescription.prescribedDate} · ${prescription.doctorName}`, detail: prescription.medicines?.map((medicine) => medicine.name).filter(Boolean).join(", ") || prescription.advice || "Prescription" }))} />
                  <HistoryColumn title="Reports" icon={FileText} empty="No reports uploaded" items={reports.slice(0, 3).map((report) => ({ id: report.id, title: report.fileName, detail: [report.category, report.reportDate].filter(Boolean).join(" · ") }))} />
                </div>
              </section>

              <form key={`${selectedPatient.id}-${selectedAppointmentId}`} onSubmit={completeConsultation} className="space-y-6">
                <section className={cardClass}>
                  <SectionTitle icon={Stethoscope} title="Clinical consultation" subtitle="Vitals, examination, diagnosis and care plan" />
                  <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                    {!profileDoctor ? <label className={`${labelClass} sm:col-span-2 lg:col-span-5`}>Consulting doctor<select name="doctorName" required defaultValue={selectedDoctor} className={inputClass}><option value="" disabled>Select doctor</option>{DOCTORS.map((doctor) => <option key={doctor}>{doctor}</option>)}</select></label> : <input type="hidden" name="doctorName" value={profileDoctor} />}
                    <label className={labelClass}>Temperature<input name="temperature" placeholder="°F / °C" className={inputClass} /></label>
                    <label className={labelClass}>Pulse<input name="pulse" placeholder="bpm" className={inputClass} /></label>
                    <label className={labelClass}>Blood pressure<input name="bloodPressure" placeholder="120/80" className={inputClass} /></label>
                    <label className={labelClass}>SpO₂<input name="spo2" placeholder="%" className={inputClass} /></label>
                    <label className={labelClass}>Weight<input name="weight" placeholder="kg" className={inputClass} /></label>
                    <label className={`${labelClass} sm:col-span-2 lg:col-span-5`}>Chief complaint<textarea name="chiefComplaint" required rows={3} placeholder="Symptoms and duration" className={inputClass} /></label>
                    <label className={`${labelClass} sm:col-span-2 lg:col-span-5`}>Examination findings<textarea name="examinationFindings" rows={3} placeholder="Relevant clinical examination findings" className={inputClass} /></label>
                    <label className={`${labelClass} sm:col-span-2 lg:col-span-5`}>Diagnosis<textarea name="diagnosis" required rows={3} placeholder="Clinical diagnosis or provisional diagnosis" className={inputClass} /></label>
                    <label className={`${labelClass} sm:col-span-2 lg:col-span-5`}>Treatment plan<textarea name="treatment" rows={3} placeholder="Treatment, procedures and counselling" className={inputClass} /></label>
                    <label className={`${labelClass} sm:col-span-2 lg:col-span-5`}>Private clinical notes<textarea name="clinicalNotes" rows={2} placeholder="Internal notes for approved clinic staff" className={inputClass} /></label>
                  </div>
                </section>

                <section className={cardClass}>
                  <div className="flex flex-wrap items-start justify-between gap-3"><SectionTitle icon={Pill} title="Prescription" subtitle="Add one or more medicines; leave empty when none are prescribed" /><button type="button" onClick={() => setMedicines((current) => [...current, emptyMedicine()])} className="inline-flex items-center gap-2 rounded-xl bg-blue-50 px-3 py-2 text-sm font-bold text-blue-800"><Plus size={16} />Add medicine</button></div>
                  <div className="mt-5 space-y-4">
                    {medicines.map((medicine, index) => <div key={medicine.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="flex items-center justify-between"><p className="text-sm font-bold text-[#233A59]">Medicine {index + 1}</p>{medicines.length > 1 ? <button type="button" onClick={() => setMedicines((current) => current.filter((item) => item.id !== medicine.id))} aria-label={`Remove medicine ${index + 1}`} className="rounded-lg p-2 text-red-600 hover:bg-red-50"><Trash2 size={16} /></button> : null}</div><div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><label className={`${labelClass} sm:col-span-2 xl:col-span-1`}>Medicine<input value={medicine.name} onChange={(event) => updateMedicine(medicine.id, "name", event.target.value)} placeholder="Name and strength" className={inputClass} /></label><label className={labelClass}>Dose<input value={medicine.dose} onChange={(event) => updateMedicine(medicine.id, "dose", event.target.value)} placeholder="5 ml" className={inputClass} /></label><label className={labelClass}>Frequency<input value={medicine.frequency} onChange={(event) => updateMedicine(medicine.id, "frequency", event.target.value)} placeholder="Twice daily" className={inputClass} /></label><label className={labelClass}>Duration<input value={medicine.duration} onChange={(event) => updateMedicine(medicine.id, "duration", event.target.value)} placeholder="5 days" className={inputClass} /></label><label className={labelClass}>Instructions<input value={medicine.instructions} onChange={(event) => updateMedicine(medicine.id, "instructions", event.target.value)} placeholder="After food" className={inputClass} /></label></div></div>)}
                  </div>
                  <label className={`${labelClass} mt-4 block`}>Advice to patient<textarea name="advice" rows={3} placeholder="Hydration, diet, warning signs and other advice" className={inputClass} /></label>
                </section>

                <section className={cardClass}>
                  <SectionTitle icon={FlaskConical} title="Laboratory orders" subtitle="Selected tests are sent directly to the clinic lab desk" />
                  <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{COMMON_TESTS.map((test) => <label key={test} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm font-semibold transition ${labTests.includes(test) ? "border-violet-300 bg-violet-50 text-violet-800" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}><input type="checkbox" checked={labTests.includes(test)} onChange={() => toggleLab(test)} className="h-4 w-4 accent-violet-700" />{test}</label>)}</div>
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row"><input value={customTest} onChange={(event) => setCustomTest(event.target.value)} placeholder="Add another test" className={`${inputClass} mt-0`} /><button type="button" onClick={addCustomLab} className="shrink-0 rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold text-[#233A59]">Add test</button></div>
                  {labTests.length > 0 ? <div className="mt-4 grid gap-4 sm:grid-cols-2"><label className={labelClass}>Priority<select name="labPriority" defaultValue="routine" className={inputClass}><option value="routine">Routine</option><option value="urgent">Urgent</option></select></label><label className={labelClass}>Instructions for lab<input name="labNotes" placeholder="Fasting or collection instructions" className={inputClass} /></label></div> : null}
                </section>

                <section className={cardClass}>
                  <SectionTitle icon={CalendarCheck2} title="Follow-up plan" subtitle="Create an optional reminder in the staff task centre" />
                  <div className="mt-5 grid gap-4 sm:grid-cols-3"><label className={labelClass}>Follow-up date<input name="followUpDate" type="date" min={today} className={inputClass} /></label><label className={labelClass}>Preferred time<input name="followUpTime" type="time" defaultValue="18:00" className={inputClass} /></label><label className={labelClass}>Priority<select name="followUpPriority" defaultValue="medium" className={inputClass}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select></label></div>
                </section>

                <section className="rounded-3xl bg-[#233A59] p-5 text-white shadow-lg shadow-[#233A59]/10 sm:p-7">
                  <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between"><div><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-[#D4B678]"><ShieldCheck size={16} /> Atomic clinical save</div><h2 className="mt-2 text-2xl font-bold">Complete this consultation</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-white/70">The visit, prescription, lab order, follow-up and audit entry are saved together. If any part fails, none of the records are committed.</p></div><button disabled={saving} className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-6 py-3 font-bold text-[#233A59] transition hover:bg-[#F8F4EA] disabled:cursor-not-allowed disabled:opacity-60">{saving ? <LoaderCircle className="animate-spin" size={19} /> : <Check size={19} />}Complete consultation</button></div>
                  {savedPrescription ? <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-white/15 pt-5"><p className="mr-auto text-sm font-semibold text-emerald-200">Prescription is ready.</p><button type="button" disabled={documentAction !== null} onClick={() => void preparePrescription("print")} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm font-bold hover:bg-white/20 disabled:opacity-60">{documentAction === "print" ? <LoaderCircle className="animate-spin" size={16} /> : <Printer size={16} />}Print</button><button type="button" disabled={documentAction !== null} onClick={() => void preparePrescription("download")} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#A8864A] px-4 py-2 text-sm font-bold hover:bg-[#92713b] disabled:opacity-60">{documentAction === "download" ? <LoaderCircle className="animate-spin" size={16} /> : <Download size={16} />}Download</button></div> : null}
                </section>
              </form>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function SectionTitle({ icon: Icon, title, subtitle }: { icon: typeof Activity; title: string; subtitle: string }) {
  return <div className="flex items-center gap-3"><span className="rounded-xl bg-blue-50 p-2.5 text-blue-700"><Icon size={20} /></span><div><h2 className="font-bold text-[#233A59]">{title}</h2><p className="text-xs text-slate-500">{subtitle}</p></div></div>;
}

function HistoryColumn({ title, icon: Icon, empty, items }: { title: string; icon: typeof Activity; empty: string; items: Array<{ id: string; title: string; detail: string }> }) {
  return <div className="rounded-2xl bg-slate-50 p-4"><div className="flex items-center gap-2 text-sm font-bold text-[#233A59]"><Icon size={17} />{title}</div><div className="mt-3 space-y-3">{items.map((item) => <div key={item.id} className="border-l-2 border-[#A8864A] pl-3"><p className="text-xs font-bold text-slate-700">{item.title}</p><p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{item.detail || "No additional detail"}</p></div>)}{items.length === 0 ? <p className="py-3 text-xs text-slate-500">{empty}</p> : null}</div></div>;
}

function ConsultationAccess() {
  const { profile } = useStaff();
  if (profile.role === "reception") return <RestrictedConsultations />;
  const profileDoctor = doctorForProfile(profile);
  if (profile.role === "doctor" && !profileDoctor) return <UnlinkedDoctorProfile profile={profile} />;
  return <ConsultationWorkspace profile={profile} profileDoctor={profileDoctor} />;
}

export default function ConsultationsPage() {
  return <ConsultationAccess />;
}
