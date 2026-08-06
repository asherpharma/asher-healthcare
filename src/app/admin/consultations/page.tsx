"use client";

import { type StaffProfile, useStaff } from "@/components/admin/StaffGuard";
import { firestore } from "@/firebase/config";
import { fetchPatientDirectory } from "@/lib/patient-directory";
import type { PrescriptionPdfRecord } from "@/lib/prescription-pdf";
import {
  appointmentStatusLabel,
  appointmentStatusTone,
  isLiveQueueStatus,
  isWaitingStatus,
  queueStage,
  queueTokenLabel,
  type AppointmentStatus,
  type QueueStatus,
} from "@/lib/visit-workflow";
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
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
  Hash,
  History,
  LoaderCircle,
  Pill,
  Play,
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
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

const DOCTORS = ["Dr. Lt Col Shafi Ahamad", "Dr. Shaik Reshma"] as const;
type DoctorName = (typeof DOCTORS)[number];

type Patient = {
  id: string;
  patientNumber?: string;
  fullName: string;
  phone: string;
  dateOfBirth: string;
  gender: string;
  doctorId?: string;
  doctorName?: string;
  caseType?: string;
  allergies?: string;
  medicalHistory?: string;
  archived?: boolean;
  createdAt?: Timestamp;
};

type Appointment = {
  id: string;
  patientId?: string;
  patientName: string;
  phone: string;
  doctorId: string;
  preferredDate: string;
  preferredTime: string;
  reason: string;
  status: AppointmentStatus;
  queueToken?: number;
  source?: string;
  createdAt?: Timestamp;
  checkedInAt?: Timestamp;
  waitingAt?: Timestamp;
  consultationStartedAt?: Timestamp;
  completedAt?: Timestamp;
  noShowAt?: Timestamp;
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
  status: QueueStatus;
  source: string;
  queueToken?: number;
  doctorId?: string;
  patientLinkStatus: PatientLinkStatus;
};

type PatientLinkStatus = "explicit" | "verified" | "ambiguous" | "name_mismatch" | "missing";

type AppointmentPatientResolution = {
  patient?: Patient;
  candidates: Patient[];
  status: PatientLinkStatus;
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

function normaliseName(value: string) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function isActivePatient(patient: Patient | null | undefined): patient is Patient {
  return Boolean(patient && patient.archived !== true);
}

function resolveAppointmentPatient(appointment: Appointment, patients: Patient[]): AppointmentPatientResolution {
  const activePatients = patients.filter(isActivePatient);
  if (appointment.patientId) {
    const patient = activePatients.find((candidate) => candidate.id === appointment.patientId);
    return {
      patient,
      candidates: patient ? [patient] : [],
      status: patient ? "explicit" : "missing",
    };
  }

  const appointmentPhone = normalisePhone(appointment.phone);
  const candidates = appointmentPhone
    ? activePatients.filter((patient) => normalisePhone(patient.phone) === appointmentPhone)
    : [];
  if (candidates.length > 1) return { candidates, status: "ambiguous" };
  if (candidates.length === 0) return { candidates, status: "missing" };

  const patient = candidates[0];
  const appointmentName = normaliseName(appointment.patientName);
  const patientName = normaliseName(patient.fullName);
  if (appointmentName && patientName && appointmentName === patientName) {
    return { patient, candidates, status: "verified" };
  }
  return { candidates, status: "name_mismatch" };
}

function doctorCanOpenAppointment(profileDoctor: DoctorName | "", appointment: Appointment) {
  return !profileDoctor || doctorFromAppointment(appointment.doctorId) === profileDoctor;
}

function patientLinkMessage(status: PatientLinkStatus) {
  if (status === "ambiguous") {
    return "Shared family phone number: confirm the patient's name and clinic ID.";
  }
  if (status === "name_mismatch") {
    return "The phone matches a chart, but the patient names differ. Confirm manually.";
  }
  return "No safe chart match was found. Search the register or create a patient first.";
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
  return "";
}

function doctorIdForName(doctorName: DoctorName | "") {
  if (doctorName === DOCTORS[0]) return "pediatrics";
  if (doctorName === DOCTORS[1]) return "obg";
  return "";
}

function patientIsAssignedToDoctor(patient: Patient, doctorName: DoctorName | "") {
  if (!doctorName) return true;
  const assignedName = String(patient.doctorName || "").trim();
  if (assignedName) return assignedName === doctorName;
  const canonicalDoctorId = doctorIdForName(doctorName);
  return Boolean(canonicalDoctorId && patient.doctorId === canonicalDoctorId);
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
  const { user } = useStaff();
  const db = firestore!;
  const today = clinicDate();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [patientsLoaded, setPatientsLoaded] = useState(false);
  const [appointmentsLoaded, setAppointmentsLoaded] = useState(false);
  const [selectedDate, setSelectedDate] = useState(today);
  const [doctorFilter, setDoctorFilter] = useState<"all" | DoctorName>(profileDoctor || "all");
  const [search, setSearch] = useState("");
  const [linkSearch, setLinkSearch] = useState("");
  const [linkingAppointmentId, setLinkingAppointmentId] = useState("");
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [selectedAppointmentId, setSelectedAppointmentId] = useState("");
  const [confirmedAppointmentPatient, setConfirmedAppointmentPatient] = useState<{ appointmentId: string; patientId: string } | null>(null);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [medicines, setMedicines] = useState<Medicine[]>([emptyMedicine()]);
  const [labTests, setLabTests] = useState<string[]>([]);
  const [customTest, setCustomTest] = useState("");
  const [saving, setSaving] = useState(false);
  const [updatingQueueId, setUpdatingQueueId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [savedPrescription, setSavedPrescription] = useState<PrescriptionPdfRecord | null>(null);
  const [documentAction, setDocumentAction] = useState<"print" | "download" | null>(null);
  const deepLinkedPatientHandled = useRef(false);
  const requestedPatientRecords = useRef(new Set<string>());

  useEffect(() => {
    if (profile.role !== "admin") {
      let active = true;
      void fetchPatientDirectory(user)
        .then((directory) => {
          if (!active) return;
          setPatients(directory as Patient[]);
          setPatientsLoaded(true);
        })
        .catch((loadError) => {
          console.error("Patient directory could not be loaded", loadError);
          if (!active) return;
          setError(loadError instanceof Error ? loadError.message : "Patient records could not be loaded.");
          setPatientsLoaded(true);
        });
      return () => {
        active = false;
      };
    }

    const stopPatients = onSnapshot(
      query(collection(db, "patients"), orderBy("createdAt", "desc"), limit(300)),
      (snapshot) => {
        setPatients(
          snapshot.docs
            .map((item) => ({ id: item.id, ...item.data() }) as Patient)
            .filter(isActivePatient),
        );
        setPatientsLoaded(true);
      },
      (loadError) => {
        console.error(loadError);
        setError("Patient records could not be loaded.");
        setPatientsLoaded(true);
      },
    );
    return stopPatients;
  }, [db, profile.role, user]);

  useEffect(() => {
    const canonicalDoctorId = doctorIdForName(profileDoctor);
    const appointmentsQuery = profile.role === "doctor"
      ? query(
          collection(db, "appointments"),
          where("doctorId", "==", canonicalDoctorId),
          where("preferredDate", "==", selectedDate),
          limit(500),
        )
      : query(
          collection(db, "appointments"),
          where("preferredDate", "==", selectedDate),
          limit(500),
        );
    const stopAppointments = onSnapshot(
      appointmentsQuery,
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
    return stopAppointments;
  }, [db, profile.role, profileDoctor, selectedDate]);

  useEffect(() => {
    if (profile.role !== "admin") return;
    const loadedIds = new Set(patients.map((patient) => patient.id));
    const missingIds = Array.from(new Set(
      appointments.map((appointment) => appointment.patientId).filter((value): value is string => Boolean(value)),
    )).filter((patientId) => !loadedIds.has(patientId) && !requestedPatientRecords.current.has(patientId));
    if (missingIds.length === 0) return;

    missingIds.forEach((patientId) => requestedPatientRecords.current.add(patientId));
    let active = true;
    void Promise.all(missingIds.map(async (patientId) => {
      const snapshot = await getDoc(doc(db, "patients", patientId));
      if (!snapshot.exists()) return null;
      const patient = { id: snapshot.id, ...snapshot.data() } as Patient;
      return isActivePatient(patient) ? patient : null;
    }))
      .then((records) => {
        if (!active) return;
        setPatients((current) => {
          const merged = new Map(current.map((patient) => [patient.id, patient]));
          records.forEach((patient) => {
            if (patient) merged.set(patient.id, patient);
          });
          return Array.from(merged.values());
        });
      })
      .catch((loadError) => {
        console.error("Linked patient records could not be loaded", loadError);
      });

    return () => {
      active = false;
    };
  }, [appointments, db, patients, profile.role]);

  useEffect(() => {
    if (!patientsLoaded || !appointmentsLoaded || deepLinkedPatientHandled.current) return;

    const params = new URLSearchParams(window.location.search);
    const requestedPatientId = params.get("patient")?.trim();
    const requestedAppointmentId = params.get("appointment")?.trim();
    const deepLinkedAppointment = requestedAppointmentId
      ? appointments.find((appointment) => appointment.id === requestedAppointmentId)
      : undefined;
    const requestedPatient = requestedPatientId
      ? patients.find((patient) => patient.id === requestedPatientId && isActivePatient(patient))
      : undefined;
    const resolution = deepLinkedAppointment
      ? resolveAppointmentPatient(deepLinkedAppointment, patients)
      : undefined;
    const matchedPatient = deepLinkedAppointment
      ? requestedPatient
        ? resolution?.patient?.id === requestedPatient.id ? requestedPatient : undefined
        : resolution?.patient
      : requestedPatient;
    const timer = window.setTimeout(() => {
      deepLinkedPatientHandled.current = true;
      if (deepLinkedAppointment && !doctorCanOpenAppointment(profileDoctor, deepLinkedAppointment)) {
        setError(`This appointment belongs to ${doctorFromAppointment(deepLinkedAppointment.doctorId)}. Open it from that doctor's workspace.`);
        return;
      }
      if (!matchedPatient) {
        if (deepLinkedAppointment) {
          setLinkingAppointmentId(deepLinkedAppointment.id);
          setLinkSearch(deepLinkedAppointment.patientName || deepLinkedAppointment.phone || "");
          setError(
            resolution?.status === "ambiguous"
              ? "This family phone number is used by more than one patient. Confirm the correct patient chart before starting."
              : resolution?.status === "name_mismatch"
                ? "The appointment name does not match the chart using this phone number. Confirm the correct chart before starting."
                : "No patient chart could be safely linked to this appointment. Choose the correct chart or register the patient first.",
          );
        } else if (requestedPatientId) {
          setError("This patient chart is archived or unavailable. Restore it from the patient register before starting a consultation.");
        }
        return;
      }

      setSelectedPatientId(matchedPatient.id);
      setSelectedAppointmentId(deepLinkedAppointment?.id || "");
      setConfirmedAppointmentPatient(deepLinkedAppointment ? {
        appointmentId: deepLinkedAppointment.id,
        patientId: matchedPatient.id,
      } : null);
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
    }, 0);
    return () => window.clearTimeout(timer);
  }, [appointments, appointmentsLoaded, patients, patientsLoaded, profileDoctor]);

  useEffect(() => {
    if (!selectedPatientId) return;
    const patientRef = doc(db, "patients", selectedPatientId);
    let accessRevoked = false;
    const clearSelectedChart = (message: string) => {
      if (accessRevoked) return;
      accessRevoked = true;
      setSelectedPatientId("");
      setSelectedAppointmentId("");
      setConfirmedAppointmentPatient(null);
      setVisits([]);
      setPrescriptions([]);
      setReports([]);
      setHistoryLoading(false);
      setMedicines([emptyMedicine()]);
      setLabTests([]);
      setCustomTest("");
      setSavedPrescription(null);
      setDocumentAction(null);
      setNotice("");
      setError(message);
    };
    const stopPatient = profile.role === "doctor"
      ? onSnapshot(
          patientRef,
          (snapshot) => {
            if (!snapshot.exists()) {
              clearSelectedChart("This patient chart is no longer available. Clinical details have been cleared.");
              return;
            }
            const patient = { id: snapshot.id, ...snapshot.data() } as Patient;
            if (patient.archived === true || !patientIsAssignedToDoctor(patient, profileDoctor)) {
              clearSelectedChart("This patient chart was archived or reassigned. Clinical details have been cleared immediately.");
              return;
            }
            setPatients((current) => current.map((entry) => entry.id === patient.id ? patient : entry));
          },
          (loadError) => {
            console.error("Assigned patient clinical profile could not be loaded", loadError);
            clearSelectedChart("Access to this patient chart changed. Clinical details have been cleared immediately.");
          },
        )
      : () => undefined;
    const stopVisits = onSnapshot(
      query(collection(patientRef, "visits"), orderBy("createdAt", "desc"), limit(20)),
      (snapshot) => {
        setVisits(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Visit));
        setHistoryLoading(false);
      },
      (loadError) => {
        console.error("Previous visit history could not be loaded", loadError);
        if (profile.role === "doctor") {
          clearSelectedChart("Access to this patient chart changed. Clinical details have been cleared immediately.");
        } else {
          setError("Previous visit history could not be loaded.");
          setHistoryLoading(false);
        }
      },
    );
    const stopPrescriptions = onSnapshot(
      query(collection(patientRef, "prescriptions"), orderBy("createdAt", "desc"), limit(20)),
      (snapshot) => setPrescriptions(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Prescription)),
      (loadError) => {
        console.error("Prescription history could not be loaded", loadError);
        if (profile.role === "doctor") clearSelectedChart("Access to this patient chart changed. Clinical details have been cleared immediately.");
      },
    );
    const stopReports = onSnapshot(
      query(collection(patientRef, "reports"), orderBy("createdAt", "desc"), limit(20)),
      (snapshot) => setReports(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Report)),
      (loadError) => {
        console.error("Report history could not be loaded", loadError);
        if (profile.role === "doctor") clearSelectedChart("Access to this patient chart changed. Clinical details have been cleared immediately.");
      },
    );
    return () => {
      stopPatient();
      stopVisits();
      stopPrescriptions();
      stopReports();
    };
  }, [db, profile.role, profileDoctor, selectedPatientId]);

  const selectedPatient = useMemo(
    () => patients.find((patient) => patient.id === selectedPatientId && isActivePatient(patient)) ?? null,
    [patients, selectedPatientId],
  );

  useEffect(() => {
    if (!selectedPatientId || !patientsLoaded) return;
    if (patients.some((patient) => patient.id === selectedPatientId && isActivePatient(patient))) return;
    const timer = window.setTimeout(() => {
      setSelectedPatientId("");
      setSelectedAppointmentId("");
      setConfirmedAppointmentPatient(null);
      setVisits([]);
      setPrescriptions([]);
      setReports([]);
      setHistoryLoading(false);
      setError("This patient chart is archived or unavailable. Restore it from the patient register before continuing.");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [patients, patientsLoaded, selectedPatientId]);

  const selectedAppointment = useMemo(
    () => appointments.find((appointment) => appointment.id === selectedAppointmentId) ?? null,
    [appointments, selectedAppointmentId],
  );

  const visiblePatients = useMemo(() => {
    const term = search.trim().toLowerCase();
    return patients
      .filter(isActivePatient)
      .filter((patient) => patientIsAssignedToDoctor(patient, profileDoctor))
      .filter((patient) => doctorFilter === "all" || patient.doctorName === doctorFilter)
      .filter((patient) => !term || [patient.fullName, patient.phone, patient.patientNumber].some((value) => String(value || "").toLowerCase().includes(term)))
      .slice(0, 12);
  }, [doctorFilter, patients, profileDoctor, search]);

  const queue = useMemo(() => {
    const entries: QueueEntry[] = appointments
      .filter((appointment) => appointment.preferredDate === selectedDate && isLiveQueueStatus(appointment.status))
      .filter((appointment) => !profileDoctor || doctorFromAppointment(appointment.doctorId) === profileDoctor)
      .filter((appointment) => doctorFilter === "all" || doctorFromAppointment(appointment.doctorId) === doctorFilter)
      .map((appointment) => {
        const resolution = resolveAppointmentPatient(appointment, patients);
        return {
          id: `appointment-${appointment.id}`,
          appointmentId: appointment.id,
          patientId: resolution.patient?.id,
          patientName: appointment.patientName || "Unnamed patient",
          phone: appointment.phone || "",
          doctorName: doctorFromAppointment(appointment.doctorId),
          time: appointment.preferredTime || "Walk-in",
          reason: appointment.reason || "Consultation",
          status: appointment.status,
          source: appointment.source || "website",
          queueToken: appointment.queueToken,
          doctorId: appointment.doctorId,
          patientLinkStatus: resolution.status,
        };
      });

    if (profile.role === "admin") {
      const queuedPatientIds = new Set(entries.map((entry) => entry.patientId).filter(Boolean));
      patients
        .filter(isActivePatient)
        .filter((patient) => timestampDate(patient.createdAt) === selectedDate)
        .filter((patient) => doctorFilter === "all" || patient.doctorName === doctorFilter)
        .filter((patient) => !queuedPatientIds.has(patient.id))
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
          patientLinkStatus: "explicit",
        }));
    }

    return entries.sort((left, right) => {
      const stageDifference = queueStage(left.status) - queueStage(right.status);
      if (stageDifference !== 0) return stageDifference;
      if (left.queueToken && right.queueToken) return left.queueToken - right.queueToken;
      if (left.queueToken) return -1;
      if (right.queueToken) return 1;
      return String(left.time || "Walk-in").localeCompare(String(right.time || "Walk-in"));
    });
  }, [appointments, doctorFilter, patients, profile.role, profileDoctor, selectedDate]);

  const linkingEntry = useMemo(
    () => queue.find((entry) => entry.appointmentId === linkingAppointmentId) ?? null,
    [linkingAppointmentId, queue],
  );

  const linkCandidates = useMemo(() => {
    if (!linkingEntry) return [];
    const appointmentPhone = normalisePhone(linkingEntry.phone);
    const exactPhoneMatches = appointmentPhone
      ? patients.filter((patient) => isActivePatient(patient) && normalisePhone(patient.phone) === appointmentPhone)
      : [];
    const term = linkSearch.trim().toLowerCase();
    const matches = term
      ? patients.filter((patient) => isActivePatient(patient) && [patient.fullName, patient.phone, patient.patientNumber]
        .some((value) => String(value || "").toLowerCase().includes(term)))
      : exactPhoneMatches;
    const exactIds = new Set(exactPhoneMatches.map((patient) => patient.id));
    return Array.from(new Map([...exactPhoneMatches, ...matches].map((patient) => [patient.id, patient])).values())
      .sort((left, right) => Number(exactIds.has(right.id)) - Number(exactIds.has(left.id)))
      .slice(0, 10);
  }, [linkSearch, linkingEntry, patients]);

  const queueCounts = useMemo(() => ({
    total: queue.length,
    waiting: queue.filter((entry) => isWaitingStatus(entry.status)).length,
    consulting: queue.filter((entry) => entry.status === "in_consultation").length,
    completed: queue.filter((entry) => entry.status === "completed").length,
  }), [queue]);

  function appointmentSelectionError(appointment: Appointment, patientId: string, explicitlyConfirmed: boolean) {
    if (!doctorCanOpenAppointment(profileDoctor, appointment)) {
      return `This appointment belongs to ${doctorFromAppointment(appointment.doctorId)} and cannot be opened from this doctor's workspace.`;
    }
    if (appointment.patientId && appointment.patientId !== patientId) {
      return "This appointment is already linked to a different patient chart. Refresh the queue before continuing.";
    }
    if (!patients.some((patient) => patient.id === patientId && isActivePatient(patient))) {
      return "This patient chart is archived or unavailable. Restore it before starting a consultation.";
    }
    const resolution = resolveAppointmentPatient(appointment, patients);
    if (!explicitlyConfirmed && resolution.patient?.id !== patientId) {
      return "Confirm the correct patient chart before starting this consultation.";
    }
    return "";
  }

  async function beginAppointmentConsultation(entry: QueueEntry, confirmedPatientId = "") {
    const patientId = confirmedPatientId || entry.patientId || "";
    if (!patientId) {
      setLinkingAppointmentId(entry.appointmentId || "");
      setLinkSearch(entry.patientName || entry.phone || "");
      setError("Choose the correct patient chart before starting this consultation.");
      return;
    }
    if (!entry.appointmentId || entry.status === "registered") {
      choosePatient(patientId);
      return;
    }
    const appointment = appointments.find((candidate) => candidate.id === entry.appointmentId);
    if (!appointment) {
      setError("This appointment is no longer in the selected queue. Refresh and try again.");
      return;
    }
    const explicitlyConfirmed = Boolean(confirmedPatientId);
    const selectionError = appointmentSelectionError(appointment, patientId, explicitlyConfirmed);
    if (selectionError) {
      setError(selectionError);
      return;
    }
    if (entry.status === "in_consultation") {
      choosePatient(patientId, entry.appointmentId, explicitlyConfirmed);
      return;
    }
    if (entry.status !== "checked_in" && entry.status !== "waiting") return;

    setUpdatingQueueId(entry.id);
    setError("");
    setNotice("");
    try {
      const changedAt = serverTimestamp();
      const batch = writeBatch(db);
      batch.update(doc(db, "appointments", entry.appointmentId), {
        status: "in_consultation",
        consultationStartedAt: changedAt,
        updatedAt: changedAt,
      });
      await batch.commit();
      choosePatient(patientId, entry.appointmentId, explicitlyConfirmed);
      setNotice(`${entry.patientName} is now in consultation.`);
    } catch (queueError) {
      console.error(queueError);
      setError("The consultation could not be started. Please refresh and try again.");
    } finally {
      setUpdatingQueueId("");
    }
  }

  function choosePatient(patientId: string, appointmentId = "", explicitlyConfirmed = false) {
    if (!patients.some((patient) => patient.id === patientId && isActivePatient(patient))) {
      setError("This patient chart is archived or unavailable. Restore it from the patient register before starting a consultation.");
      return;
    }
    if (appointmentId) {
      const appointment = appointments.find((candidate) => candidate.id === appointmentId);
      if (!appointment) {
        setError("This appointment is no longer in the selected queue. Refresh and try again.");
        return;
      }
      const selectionError = appointmentSelectionError(appointment, patientId, explicitlyConfirmed);
      if (selectionError) {
        setError(selectionError);
        return;
      }
    }
    setSelectedPatientId(patientId);
    setSelectedAppointmentId(appointmentId);
    setConfirmedAppointmentPatient(appointmentId ? { appointmentId, patientId } : null);
    setLinkingAppointmentId("");
    setLinkSearch("");
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
    if (!isActivePatient(selectedPatient)) {
      setError("This patient chart has been archived. Restore it before recording clinical care.");
      return;
    }
    if (selectedAppointment) {
      if (!doctorCanOpenAppointment(profileDoctor, selectedAppointment)) {
        setError(`This appointment belongs to ${doctorFromAppointment(selectedAppointment.doctorId)} and cannot be completed from this doctor's workspace.`);
        return;
      }
      const appointmentPatientConfirmed = confirmedAppointmentPatient?.appointmentId === selectedAppointment.id
        && confirmedAppointmentPatient.patientId === selectedPatient.id;
      if (!appointmentPatientConfirmed) {
        setError("The patient chart has not been safely confirmed for this appointment. Return to the queue and choose the correct patient.");
        return;
      }
      if (selectedAppointment.patientId && selectedAppointment.patientId !== selectedPatient.id) {
        setError("This appointment is linked to a different patient chart. Refresh the queue before continuing.");
        return;
      }
    }
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
          title: `Patient follow-up: ${selectedPatient.fullName}`.slice(0, 120),
          details: `Contact the patient to confirm their clinic follow-up with ${doctorName} on ${followUpDate}${value("followUpTime") ? ` at ${value("followUpTime")}` : ""}.`.slice(0, 1000),
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
          completedAt: recordedAt,
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
      const { downloadPrescriptionPdf, printPrescriptionPdf } = await import("@/lib/prescription-pdf");
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
          <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Queue date<input type="date" value={selectedDate} onChange={(event) => { setAppointmentsLoaded(false); setSelectedDate(event.target.value); }} className="mt-1 block min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-[#233A59]" /></label>
          {profile.role === "admin" ? <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Doctor<select value={doctorFilter} onChange={(event) => setDoctorFilter(event.target.value as "all" | DoctorName)} className="mt-1 block min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-[#233A59]"><option value="all">All doctors</option>{DOCTORS.map((doctor) => <option key={doctor}>{doctor}</option>)}</select></label> : null}
        </div>
      </div>

      {error ? <div className="mt-5 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm font-semibold text-red-700"><AlertCircle size={18} className="mt-0.5 shrink-0" />{error}</div> : null}
      {notice ? <div className="mt-5 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-semibold text-emerald-800"><CheckCircle2 size={18} className="mt-0.5 shrink-0" />{notice}</div> : null}

      <section className="mt-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <div className={cardClass}><UsersRound size={22} className="text-blue-600" /><p className="mt-4 text-3xl font-bold text-[#233A59]">{loading ? "—" : queueCounts.total}</p><p className="mt-1 text-sm font-semibold text-slate-600">Queue for {selectedDate === today ? "today" : displayDate(selectedDate)}</p></div>
        <div className={cardClass}><HeartPulse size={22} className="text-amber-600" /><p className="mt-4 text-3xl font-bold text-[#233A59]">{loading ? "—" : queueCounts.waiting}</p><p className="mt-1 text-sm font-semibold text-slate-600">Waiting consultations</p></div>
        <div className={cardClass}><Stethoscope size={22} className="text-fuchsia-600" /><p className="mt-4 text-3xl font-bold text-[#233A59]">{loading ? "—" : queueCounts.consulting}</p><p className="mt-1 text-sm font-semibold text-slate-600">With doctor now</p></div>
        <div className={cardClass}><CheckCircle2 size={22} className="text-emerald-600" /><p className="mt-4 text-3xl font-bold text-[#233A59]">{loading ? "—" : queueCounts.completed}</p><p className="mt-1 text-sm font-semibold text-slate-600">Completed consultations</p></div>
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-[0.72fr_1.28fr]">
        <aside className="space-y-5">
          <section className={cardClass}>
            <div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#A8864A]">Live queue</p><h2 className="mt-1 text-xl font-bold text-[#233A59]">{displayDate(selectedDate)}</h2></div>{loading ? <LoaderCircle className="animate-spin text-slate-400" /> : <CalendarCheck2 className="text-blue-600" />}</div>
            <div className="mt-5 space-y-3">
              {queue.map((entry) => {
                const canBeginConsultation = entry.status === "checked_in" || entry.status === "waiting" || entry.status === "in_consultation";
                const needsPatientConfirmation = Boolean(entry.appointmentId) && !entry.patientId;
                const isLinking = linkingAppointmentId === entry.appointmentId;
                return (
                <article key={entry.id} className={`rounded-2xl border p-4 transition ${selectedAppointmentId === entry.appointmentId && selectedPatientId === entry.patientId ? "border-[#A8864A] bg-[#F8F4EA]" : "border-slate-200 bg-white"}`}>
                  <div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><p className="font-bold text-[#233A59]">{entry.patientName}</p>{entry.queueToken ? <span className="inline-flex items-center gap-1 rounded-lg bg-[#233A59] px-2 py-1 text-[11px] font-bold text-white"><Hash size={11} />{queueTokenLabel(entry.queueToken, entry.doctorId)}</span> : null}</div><p className="mt-1 text-xs text-slate-500">{entry.time} · {entry.phone}</p></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ${appointmentStatusTone(entry.status)}`}>{appointmentStatusLabel(entry.status)}</span></div>
                  <p className="mt-3 text-sm text-slate-600">{entry.reason || "Consultation"}</p>
                  <p className="mt-1 text-xs font-semibold text-slate-500">{entry.doctorName} · {entry.source}</p>
                  {needsPatientConfirmation && canBeginConsultation ? (
                    <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3">
                      <div className="flex items-start gap-2 text-xs font-semibold leading-5 text-amber-900">
                        <ShieldAlert size={16} className="mt-0.5 shrink-0" />
                        <span>{patientLinkMessage(entry.patientLinkStatus)}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setLinkingAppointmentId(isLinking ? "" : entry.appointmentId || "");
                          setLinkSearch(isLinking ? "" : entry.patientName || entry.phone || "");
                          setError("");
                        }}
                        className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-amber-900 px-3 py-2 text-xs font-bold text-white"
                      >
                        <UserRound size={15} />{isLinking ? "Close patient selection" : "Choose the correct patient chart"}
                      </button>
                      {isLinking ? (
                        <div className="mt-3 border-t border-amber-200 pt-3">
                          <label className="text-[11px] font-bold uppercase tracking-wider text-amber-900">
                            Search name, phone or patient ID
                            <input
                              value={linkSearch}
                              onChange={(event) => setLinkSearch(event.target.value)}
                              placeholder="Confirm patient identity"
                              className="mt-2 w-full rounded-xl border border-amber-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800 outline-none focus:border-amber-600"
                            />
                          </label>
                          <div className="mt-3 space-y-2">
                            {linkCandidates.map((patient) => (
                              <button
                                key={patient.id}
                                type="button"
                                disabled={updatingQueueId === entry.id}
                                onClick={() => void beginAppointmentConsultation(entry, patient.id)}
                                className="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border border-amber-200 bg-white px-3 py-2 text-left disabled:opacity-60"
                              >
                                <span>
                                  <span className="block text-sm font-bold text-[#233A59]">{patient.fullName}</span>
                                  <span className="mt-0.5 block text-[11px] text-slate-500">{patient.patientNumber || "No patient ID"} · {patient.phone}</span>
                                </span>
                                {updatingQueueId === entry.id ? <LoaderCircle size={15} className="shrink-0 animate-spin" /> : <ArrowRight size={15} className="shrink-0" />}
                              </button>
                            ))}
                            {linkCandidates.length === 0 ? <p className="rounded-xl bg-white px-3 py-3 text-xs font-semibold text-slate-600">No matching chart is shown. Refine the search or register this patient.</p> : null}
                          </div>
                          <Link href="/admin/patients" className="mt-3 inline-flex min-h-11 items-center gap-2 text-xs font-bold text-amber-900">Open patient registration <ArrowRight size={14} /></Link>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {entry.patientId && entry.status === "registered" ? <button type="button" onClick={() => choosePatient(entry.patientId!)} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#233A59] px-3 py-2 text-xs font-bold text-white">Open walk-in chart <ArrowRight size={14} /></button> : null}
                  {entry.patientId && (entry.status === "checked_in" || entry.status === "waiting" || entry.status === "in_consultation") ? <button type="button" disabled={updatingQueueId === entry.id} onClick={() => void beginAppointmentConsultation(entry)} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#233A59] px-3 py-2 text-xs font-bold text-white disabled:opacity-60">{updatingQueueId === entry.id ? <LoaderCircle size={14} className="animate-spin" /> : entry.status === "in_consultation" ? <Stethoscope size={14} /> : <Play size={14} />}{entry.status === "in_consultation" ? "Continue consultation" : "Start consultation"}</button> : null}
                  {(entry.status === "confirmed" || entry.status === "requested") ? <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500">Awaiting reception check-in</p> : null}
                </article>
                );
              })}
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
