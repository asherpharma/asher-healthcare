"use client";

import PatientQuickActions from "@/components/admin/PatientQuickActions";
import { useStaff } from "@/components/admin/StaffGuard";
import { firestore, storage } from "@/firebase/config";
import {
  ADMIN_NAVIGATION_HANDOFF_EVENT,
  consumeAdminNavigationHandoff,
} from "@/lib/admin-navigation-handoff";
import { fetchPatientDirectory } from "@/lib/patient-directory";
import {
  MAX_REPORT_FILE_BYTES,
  REPORT_FILE_ACCEPT,
  createReportStoragePath,
  downloadReportBlob,
  genericReportDownloadName,
  inspectReportFile,
  openPendingReportWindow,
  reportStorageErrorMessage,
} from "@/lib/report-files";
import {
  addDoc,
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  type Timestamp,
} from "firebase/firestore";
import { ref, uploadBytes } from "firebase/storage";
import {
  Activity,
  Archive,
  ArchiveRestore,
  Baby,
  CalendarClock,
  ChartNoAxesCombined,
  ChevronRight,
  ClipboardPlus,
  Download,
  ExternalLink,
  FileHeart,
  FileText,
  FileUp,
  History,
  HeartPulse,
  LoaderCircle,
  NotebookTabs,
  Printer,
  Ruler,
  Search,
  ShieldCheck,
  Scale,
  Stethoscope,
  Syringe,
  TriangleAlert,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type Gender = "female" | "male" | "other";
type CaseType = "general" | "specialist";
type Specialty = "" | "pediatrics" | "obg";
type Patient = {
  id: string;
  patientNumber?: string;
  fullName: string;
  phone: string;
  dateOfBirth: string;
  gender: Gender;
  doctorId?: string;
  doctorName?: string;
  caseType?: CaseType;
  specialty?: Specialty;
  consultationFee?: number;
  registrationInvoiceId?: string;
  registrationInvoiceNumber?: string;
  address: string;
  allergies?: string;
  medicalHistory?: string;
  archived?: boolean;
  archivedAt?: Timestamp;
  archivedBy?: string;
  archiveReason?: string;
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
  doseNumber?: string;
  administeredDate: string;
  nextDueDate: string;
  batchNumber: string;
  manufacturer?: string;
  expiryDate?: string;
  route?: string;
  site?: string;
  administeredBy?: string;
  adverseEvents?: string;
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
  gravida?: string;
  para?: string;
  riskLevel?: "routine" | "moderate" | "high";
  riskFactors?: string;
  symptoms?: string;
  fundalHeight?: string;
  fetalMovement?: string;
  investigations?: string;
  carePlan?: string;
  notes: string;
};
type GrowthRecord = BaseRecord & {
  measuredDate: string;
  weightKg: number | null;
  heightCm: number | null;
  headCircumferenceCm: number | null;
  bmi: number | null;
  milestone: string;
  nutritionNotes: string;
  clinician: string;
};
type ReportRecord = BaseRecord & {
  fileName: string;
  storagePath: string;
  contentType: string;
  size: number;
  category: string;
  reportDate: string;
  notes: string;
  labOrderId?: string;
};
type InvoiceRecord = BaseRecord & {
  invoiceNumber: string;
  total: number;
  amountPaid: number;
  balance: number;
  paymentStatus: string;
};
type LabRecord = BaseRecord & {
  orderNumber: string;
  tests: string[];
  status: string;
  orderedAt?: Timestamp;
};
type TimelineItem = {
  id: string;
  kind: "visit" | "prescription" | "vaccination" | "pregnancy" | "growth" | "report" | "lab" | "invoice";
  date: string;
  title: string;
  detail: string;
  status?: string;
};
type TabKey = "overview" | "timeline" | "visits" | "prescriptions" | "growth" | "vaccinations" | "pregnancy" | "reports";
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

function numericValue(form: FormData, name: string) {
  const value = Number(text(form, name));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function timestampDate(value?: Timestamp) {
  return value ? value.toDate().toISOString().slice(0, 10) : "";
}

function friendlyDate(value: string) {
  if (!value) return "Date not recorded";
  const date = new Date(value + "T00:00:00");
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function doctorIdForName(doctorName?: string) {
  if (doctorName === "Dr. Lt Col Shafi Ahamad") return "pediatrics";
  if (doctorName === "Dr. Shaik Reshma") return "obg";
  return "";
}

function PatientRegister() {
  const { user, profile } = useStaff();
  const router = useRouter();
  const db = firestore!;
  const files = storage!;
  const [recentPatients, setRecentPatients] = useState<Patient[]>([]);
  const [archivedRegistry, setArchivedRegistry] = useState<Patient[]>([]);
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(20);
  const [showEdit, setShowEdit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [visits, setVisits] = useState<VisitRecord[]>([]);
  const [prescriptions, setPrescriptions] = useState<PrescriptionRecord[]>([]);
  const [vaccinations, setVaccinations] = useState<VaccinationRecord[]>([]);
  const [pregnancyRecords, setPregnancyRecords] = useState<PregnancyRecord[]>([]);
  const [growthRecords, setGrowthRecords] = useState<GrowthRecord[]>([]);
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [labOrders, setLabOrders] = useState<LabRecord[]>([]);
  const [uploading, setUploading] = useState(false);
  const [reportAction, setReportAction] = useState<{ id: string; mode: "view" | "download" | "print" } | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Patient | null>(null);
  const [archiveConfirmation, setArchiveConfirmation] = useState("");
  const [archiveReason, setArchiveReason] = useState("");
  const [lifecycleActionId, setLifecycleActionId] = useState<string | null>(null);
  const [patientView, setPatientView] = useState<"active" | "archived">("active");
  const [handoffPatientId, setHandoffPatientId] = useState("");
  const selectedPatientIdRef = useRef<string | null>(null);
  const reportAccessAbortRef = useRef<AbortController | null>(null);
  const canEditDemographics = profile.role === "admin" || profile.role === "reception";
  const canEditClinical = profile.role === "admin" || profile.role === "doctor";

  const cancelPendingReportAccess = useCallback(() => {
    reportAccessAbortRef.current?.abort();
    reportAccessAbortRef.current = null;
    setReportAction(null);
  }, []);

  const resetPatientDetailData = useCallback(() => {
    cancelPendingReportAccess();
    setVisits([]);
    setPrescriptions([]);
    setVaccinations([]);
    setPregnancyRecords([]);
    setGrowthRecords([]);
    setReports([]);
    setInvoices([]);
    setLabOrders([]);
  }, [cancelPendingReportAccess]);

  const clearSelectedPatientData = useCallback((reason?: string) => {
    resetPatientDetailData();
    selectedPatientIdRef.current = null;
    setSelectedId(null);
    setShowEdit(false);
    setActiveTab("overview");
    if (reason) setMessage(reason);
  }, [resetPatientDetailData]);

  const selectPatient = useCallback((patientId: string) => {
    resetPatientDetailData();
    selectedPatientIdRef.current = patientId;
    setSelectedId(patientId);
    setShowEdit(false);
    setActiveTab("overview");
  }, [resetPatientDetailData]);

  useEffect(() => () => cancelPendingReportAccess(), [cancelPendingReportAccess]);

  useEffect(() => {
    const openRegistration = () => router.push("/admin/reception");
    const consumePatientHandoff = () => {
      const handoff = consumeAdminNavigationHandoff("/admin/patients");
      if (handoff?.intent === "open-patient") setHandoffPatientId(handoff.patientId);
    };
    window.addEventListener("asher:new-patient", openRegistration);
    window.addEventListener(ADMIN_NAVIGATION_HANDOFF_EVENT, consumePatientHandoff);
    consumePatientHandoff();
    if (new URLSearchParams(window.location.search).get("new") === "1") {
      router.replace("/admin/reception");
    }
    return () => {
      window.removeEventListener("asher:new-patient", openRegistration);
      window.removeEventListener(ADMIN_NAVIGATION_HANDOFF_EVENT, consumePatientHandoff);
    };
  }, [router]);

  useEffect(() => {
    let active = true;
    void fetchPatientDirectory(user, { includeArchived: profile.role === "admin" })
      .then((directory) => {
        if (!active) return;
        const records = directory as Patient[];
        setRecentPatients(records.filter((patient) => patient.archived !== true));
        setArchivedRegistry(profile.role === "admin"
          ? records.filter((patient) => patient.archived === true)
          : []);
      })
      .catch((loadError) => {
        console.error("Patient directory could not be loaded", loadError);
        if (active) {
          setRecentPatients([]);
          setArchivedRegistry([]);
          clearSelectedPatientData();
          setMessage(loadError instanceof Error ? loadError.message : "Patient records could not be loaded.");
        }
      });
    return () => {
      active = false;
    };
  }, [clearSelectedPatientData, profile.role, user]);

  const patients = useMemo(() => {
    const merged = new Map(recentPatients.map((patient) => [patient.id, patient]));
    archivedRegistry.forEach((patient) => merged.set(patient.id, patient));
    return Array.from(merged.values());
  }, [archivedRegistry, recentPatients]);

  useEffect(() => {
    if (!handoffPatientId) return;
    const patient = patients.find((candidate) => candidate.id === handoffPatientId);
    if (patient) {
      window.setTimeout(() => {
        setHandoffPatientId("");
        if (patient.archived === true) {
          if (profile.role !== "admin") {
            setMessage("This patient record is archived and can only be opened by an administrator.");
            return;
          }
          setPatientView("archived");
        } else {
          setPatientView("active");
        }
        selectPatient(handoffPatientId);
      }, 0);
    }
  }, [handoffPatientId, patients, profile.role, selectPatient]);

  const activePatients = useMemo(
    () => patients.filter((patient) => patient.archived !== true),
    [patients],
  );
  const archivedPatients = useMemo(
    () => patients
      .filter((patient) => patient.archived === true)
      .sort((left, right) => {
        const leftTime = left.archivedAt?.toMillis?.() ?? left.createdAt?.toMillis?.() ?? 0;
        const rightTime = right.archivedAt?.toMillis?.() ?? right.createdAt?.toMillis?.() ?? 0;
        return rightTime - leftTime;
      }),
    [patients],
  );
  const patientPool = profile.role === "admin" && patientView === "archived"
    ? archivedPatients
    : activePatients;
  const selectedPatient = useMemo(
    () => patientPool.find((patient) => patient.id === selectedId) ?? null,
    [patientPool, selectedId],
  );
  const canModifySelectedPatient = canEditClinical && selectedPatient?.archived !== true;
  const canEditSelectedProfile = (canEditDemographics || canEditClinical)
    && selectedPatient?.archived !== true;

  useEffect(() => {
    if (!selectedId || (profile.role === "doctor" && !profile.doctorName)) return;
    if (profile.role !== "admin" && profile.role !== "doctor") return;
    return onSnapshot(
      doc(db, "patients", selectedId),
      (snapshot) => {
        if (!snapshot.exists()) {
          clearSelectedPatientData("This patient record is no longer available.");
          return;
        }
        const freshPatient = { id: snapshot.id, ...snapshot.data() } as Patient;
        if (profile.role === "doctor") {
          const freshDoctorName = freshPatient.doctorName?.trim() ?? "";
          const assignedDoctorId = doctorIdForName(profile.doctorName);
          const doctorMatches = freshDoctorName
            ? freshDoctorName === profile.doctorName
            : Boolean(assignedDoctorId && freshPatient.doctorId === assignedDoctorId);
          if (freshPatient.archived === true || !doctorMatches) {
            clearSelectedPatientData("This patient is archived or is no longer assigned to your account.");
            return;
          }
          setRecentPatients((current) => current.map((patient) =>
            patient.id === freshPatient.id ? { ...patient, ...freshPatient } : patient));
          return;
        }

        const upsertPatient = (current: Patient[]) => [
          freshPatient,
          ...current.filter((patient) => patient.id !== freshPatient.id),
        ];
        if (freshPatient.archived === true) {
          setRecentPatients((current) => current.filter((patient) => patient.id !== freshPatient.id));
          setArchivedRegistry(upsertPatient);
        } else {
          setArchivedRegistry((current) => current.filter((patient) => patient.id !== freshPatient.id));
          setRecentPatients(upsertPatient);
        }
      },
      (loadError) => {
        console.error("Assigned patient clinical profile could not be loaded", loadError);
        clearSelectedPatientData("Access to this patient record is no longer available.");
      },
    );
  }, [clearSelectedPatientData, db, profile.doctorName, profile.role, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    const subscribe = <T extends BaseRecord>(name: string, setter: (items: T[]) => void) =>
      onSnapshot(
        query(collection(db, "patients", selectedId, name), orderBy("createdAt", "desc"), limit(50)),
        (snapshot) => setter(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as T)),
        () => setter([]),
      );
    const unsubscribers: Array<() => void> = [];
    if (profile.role !== "doctor") {
      unsubscribers.push(onSnapshot(
        query(collection(db, "invoices"), where("patientId", "==", selectedId), limit(50)),
        (snapshot) => setInvoices(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as InvoiceRecord)),
        () => setInvoices([]),
      ));
    }

    const labOrdersQuery = profile.role === "doctor" && profile.doctorName
      ? query(
          collection(db, "labOrders"),
          where("patientId", "==", selectedId),
          where("clinician", "==", profile.doctorName),
          limit(50),
        )
      : query(collection(db, "labOrders"), where("patientId", "==", selectedId), limit(50));
    unsubscribers.push(onSnapshot(
      labOrdersQuery,
      (snapshot) => setLabOrders(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as LabRecord)),
      () => setLabOrders([]),
    ));
    if (canEditClinical) {
      unsubscribers.push(
        subscribe<VisitRecord>("visits", setVisits),
        subscribe<PrescriptionRecord>("prescriptions", setPrescriptions),
        subscribe<VaccinationRecord>("vaccinations", setVaccinations),
        subscribe<PregnancyRecord>("pregnancyRecords", setPregnancyRecords),
        subscribe<GrowthRecord>("growthRecords", setGrowthRecords),
        subscribe<ReportRecord>("reports", setReports),
      );
    }
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [canEditClinical, db, profile.doctorName, profile.role, selectedId]);

  const timeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = [
      ...visits.map((record) => ({ id: `visit-${record.id}`, kind: "visit" as const, date: record.visitDate || timestampDate(record.createdAt), title: record.diagnosis || "Clinical visit", detail: `${record.doctorName}${record.chiefComplaint ? ` · ${record.chiefComplaint}` : ""}`, status: record.followUpDate ? `Follow-up ${friendlyDate(record.followUpDate)}` : undefined })),
      ...prescriptions.map((record) => ({ id: `prescription-${record.id}`, kind: "prescription" as const, date: record.prescribedDate || timestampDate(record.createdAt), title: "Prescription issued", detail: `${record.doctorName} · ${Array.isArray(record.medicines) ? record.medicines.filter((medicine) => medicine && typeof medicine === "object").map((medicine) => medicine.name).filter(Boolean).join(", ") || "Medication recorded" : "Medication record needs review"}` })),
      ...vaccinations.map((record) => ({ id: `vaccination-${record.id}`, kind: "vaccination" as const, date: record.administeredDate || timestampDate(record.createdAt), title: `${record.vaccineName}${record.doseNumber ? ` · Dose ${record.doseNumber}` : ""}`, detail: record.batchNumber ? `Batch ${record.batchNumber}` : "Vaccination recorded", status: record.nextDueDate ? `Next due ${friendlyDate(record.nextDueDate)}` : undefined })),
      ...pregnancyRecords.map((record) => ({ id: `pregnancy-${record.id}`, kind: "pregnancy" as const, date: record.recordedDate || timestampDate(record.createdAt), title: record.gestationalWeeks || "Antenatal follow-up", detail: [record.bloodPressure && `BP ${record.bloodPressure}`, record.weight && `${record.weight} kg`, record.fetalHeartRate && `FHR ${record.fetalHeartRate}`].filter(Boolean).join(" · ") || "Pregnancy care update", status: record.nextVisitDate ? `Next visit ${friendlyDate(record.nextVisitDate)}` : undefined })),
      ...growthRecords.map((record) => ({ id: `growth-${record.id}`, kind: "growth" as const, date: record.measuredDate || timestampDate(record.createdAt), title: "Growth measurement", detail: [record.weightKg && `${record.weightKg} kg`, record.heightCm && `${record.heightCm} cm`, record.headCircumferenceCm && `HC ${record.headCircumferenceCm} cm`].filter(Boolean).join(" · ") || "Measurement recorded", status: record.milestone || undefined })),
      ...reports.map((record) => ({ id: `report-${record.id}`, kind: "report" as const, date: record.reportDate || timestampDate(record.createdAt), title: record.category || "Medical report", detail: record.fileName })),
      ...labOrders.map((record) => ({ id: `lab-${record.id}`, kind: "lab" as const, date: timestampDate(record.orderedAt || record.createdAt), title: `Lab order ${record.orderNumber}`, detail: record.tests?.join(", ") || "Tests ordered", status: record.status })),
      ...invoices.map((record) => ({ id: `invoice-${record.id}`, kind: "invoice" as const, date: timestampDate(record.createdAt), title: `Invoice ${record.invoiceNumber}`, detail: `₹${record.amountPaid || 0} received of ₹${record.total || 0}`, status: record.paymentStatus })),
    ];
    return items.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }, [growthRecords, invoices, labOrders, pregnancyRecords, prescriptions, reports, vaccinations, visits]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return patientPool;
    return patientPool.filter((patient) =>
      [patient.fullName, patient.phone, patient.patientNumber ?? ""].some((value) => value.toLowerCase().includes(term)),
    );
  }, [patientPool, search]);

  const visiblePatients = useMemo(
    () => search.trim() ? filtered : filtered.slice(0, visibleCount),
    [filtered, search, visibleCount],
  );

  async function editPatient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPatient) return;
    if (selectedPatient.archived === true) {
      setMessage("Restore this patient before changing the profile.");
      return;
    }
    setSaving(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const profileUpdates: Record<string, string> = {
        patientId: selectedPatient.id,
      };
      if (canEditDemographics) {
        Object.assign(profileUpdates, {
          fullName: text(form, "fullName"),
          phone: text(form, "phone"),
          dateOfBirth: text(form, "dateOfBirth"),
          gender: text(form, "gender"),
          doctorName: text(form, "doctorName"),
          address: text(form, "address"),
        });
      }
      if (canEditClinical) {
        profileUpdates.allergies = text(form, "allergies");
        profileUpdates.medicalHistory = text(form, "medicalHistory");
      }
      const token = await user.getIdToken();
      const response = await fetch("/api/staff/patients/profile", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(profileUpdates),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || "Patient update failed.");
      }
      if (result.patient) {
        setRecentPatients((current) => current.map((patient) => (
          patient.id === selectedPatient.id ? { ...patient, ...result.patient } : patient
        )));
      }
      setShowEdit(false);
      setMessage("Patient profile updated.");
    } catch (error) {
      console.error("Protected patient profile update failed", error);
      setMessage(error instanceof Error ? error.message : "Patient update failed.");
    } finally {
      setSaving(false);
    }
  }

  async function patientLifecycleRequest(
    action: "archive" | "restore",
    patient: Patient,
    reason: string,
  ) {
    const token = await user.getIdToken();
    const response = await fetch(`/api/admin/patients/${action}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ patientId: patient.id, reason }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.error || `Patient ${action} could not be completed.`);
    }
  }

  async function archivePatient() {
    if (profile.role !== "admin" || !archiveTarget) return;
    const patientNumber = archiveTarget.patientNumber || archiveTarget.id;
    if (archiveConfirmation.trim() !== patientNumber) {
      setMessage("Type the patient ID exactly to confirm archiving.");
      return;
    }
    if (archiveReason.trim().length < 8) {
      setMessage("Add a brief reason so this change is clear in the audit history.");
      return;
    }

    setLifecycleActionId(archiveTarget.id);
    setMessage("");
    try {
      await patientLifecycleRequest("archive", archiveTarget, archiveReason.trim());
      const archivedPatient: Patient = {
        ...archiveTarget,
        archived: true,
        archiveReason: archiveReason.trim(),
      };
      setRecentPatients((current) => current.filter((patient) => patient.id !== archiveTarget.id));
      setArchivedRegistry((current) => [
        archivedPatient,
        ...current.filter((patient) => patient.id !== archiveTarget.id),
      ]);
      clearSelectedPatientData();
      setArchiveTarget(null);
      setArchiveConfirmation("");
      setArchiveReason("");
      setMessage(`Patient ${patientNumber} was archived safely. Clinical and billing history remain intact and can be restored by an administrator.`);
    } catch (error) {
      console.error("Admin patient archive failed", error);
      setMessage(error instanceof Error ? error.message : "Patient archiving failed. Please try again.");
    } finally {
      setLifecycleActionId(null);
    }
  }

  async function restorePatient(patient: Patient) {
    if (profile.role !== "admin") return;
    setLifecycleActionId(patient.id);
    setMessage("");
    try {
      await patientLifecycleRequest("restore", patient, "Restored from the archived patient register");
      const restoredPatient: Patient = {
        ...patient,
        archived: false,
        archivedAt: undefined,
        archivedBy: "",
        archiveReason: "",
      };
      setArchivedRegistry((current) => current.filter((entry) => entry.id !== patient.id));
      setRecentPatients((current) => [
        restoredPatient,
        ...current.filter((entry) => entry.id !== patient.id),
      ]);
      setPatientView("active");
      selectPatient(patient.id);
      setMessage(`Patient ${patient.patientNumber || patient.id} was restored to the active register.`);
    } catch (error) {
      console.error("Admin patient restore failed", error);
      setMessage(error instanceof Error ? error.message : "Patient restoration failed. Please try again.");
    } finally {
      setLifecycleActionId(null);
    }
  }

  async function saveRecord(event: FormEvent<HTMLFormElement>, collectionName: string, payload: Record<string, unknown>) {
    event.preventDefault();
    if (!selectedPatient) return;
    if (!canModifySelectedPatient) {
      setMessage(selectedPatient.archived === true ? "Restore this patient before adding clinical records." : "Clinical records are read-only for reception staff.");
      return;
    }
    const recordForm = event.currentTarget;
    setSaving(true);
    setMessage("");
    try {
      await addDoc(collection(db, "patients", selectedPatient.id, collectionName), {
        ...payload,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      recordForm.reset();
      setMessage("Record saved securely.");
    } catch (saveError) {
      setMessage(saveError instanceof Error ? saveError.message : "Unable to save this record. Please check access and try again.");
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
    if (file.size >= MAX_REPORT_FILE_BYTES) {
      setMessage("Reports must be smaller than 10 MB.");
      return;
    }
    let acceptedReport;
    try {
      acceptedReport = await inspectReportFile(file);
    } catch {
      setMessage("The selected report could not be checked. Please choose it again.");
      return;
    }
    if (!acceptedReport) {
      setMessage("Only genuine PDF, JPEG, PNG or WebP reports are allowed.");
      return;
    }

    setUploading(true);
    setMessage("");
    const { fileName: safeName, storagePath } = createReportStoragePath(
      selectedPatient.id,
      acceptedReport.extension,
    );
    let uploaded = false;
    try {
      await uploadBytes(ref(files, storagePath), file, {
        contentType: acceptedReport.contentType,
        customMetadata: { patientId: selectedPatient.id, uploadedBy: user.uid },
      });
      uploaded = true;
      await addDoc(collection(db, "patients", selectedPatient.id, "reports"), {
        fileName: safeName,
        storagePath,
        contentType: acceptedReport.contentType,
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
    } catch (uploadError) {
      if (uploaded) {
        setMessage("The confirmation was interrupted after the report upload. The file has been retained securely; refresh this patient record before retrying so the clinic can reconcile it without creating a duplicate.");
      } else {
        setMessage(reportStorageErrorMessage(uploadError, "upload"));
      }
    } finally {
      setUploading(false);
    }
  }

  async function accessReport(record: ReportRecord, mode: "view" | "download" | "print") {
    if (reportAccessAbortRef.current) return;
    const requestedPatientId = selectedId;
    if (!requestedPatientId) {
      setMessage("Choose a patient before opening a report.");
      return;
    }
    const preview = mode === "view" || mode === "print" ? openPendingReportWindow() : null;
    if ((mode === "view" || mode === "print") && !preview) {
      setMessage("Your browser blocked the secure preview. Allow pop-ups for Asher Healthcare or use Download.");
      return;
    }
    const controller = new AbortController();
    reportAccessAbortRef.current = controller;
    setReportAction({ id: record.id, mode });
    setMessage("");
    try {
      const idToken = await user.getIdToken();
      if (controller.signal.aborted || selectedPatientIdRef.current !== requestedPatientId) {
        preview?.close();
        return;
      }
      const response = await fetch(
        record.labOrderId ? "/api/labs/report-access" : "/api/patients/report-access",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${idToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(record.labOrderId ? {
            labOrderId: record.labOrderId,
            action: mode === "view" ? "preview" : mode,
          } : {
            patientId: requestedPatientId,
            reportId: record.id,
            action: mode,
          }),
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as { error?: string };
        preview?.close();
        setMessage(result.error || "Report access could not be authorized. Please try again.");
        return;
      }
      const blob = await response.blob();
      if (controller.signal.aborted || selectedPatientIdRef.current !== requestedPatientId) {
        preview?.close();
        return;
      }
      if (mode === "download") {
        downloadReportBlob(
          blob,
          genericReportDownloadName(blob, record.labOrderId ? "lab-report" : "medical-report"),
        );
      } else {
        const url = URL.createObjectURL(blob);
        if (mode === "print") {
          preview!.addEventListener("load", () => {
            try { preview!.print(); } catch { /* The PDF viewer may require a manual Print action. */ }
          }, { once: true });
        }
        preview!.location.href = url;
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    } catch (reportError) {
      preview?.close();
      if (controller.signal.aborted) return;
      setMessage(reportStorageErrorMessage(reportError, "open"));
    } finally {
      if (reportAccessAbortRef.current === controller) {
        reportAccessAbortRef.current = null;
        setReportAction(null);
      }
    }
  }

  const tabs: Array<{ key: TabKey; label: string; icon: typeof Activity; count?: number }> = [
    { key: "overview", label: "Overview", icon: UserRound },
    { key: "timeline", label: "Timeline", icon: History, count: timeline.length },
    ...(canEditClinical ? [
      { key: "visits" as const, label: "Visits", icon: Stethoscope, count: visits.length },
      { key: "prescriptions" as const, label: "Prescriptions", icon: FileHeart, count: prescriptions.length },
      { key: "growth" as const, label: "Growth", icon: ChartNoAxesCombined, count: growthRecords.length },
      { key: "vaccinations" as const, label: "Vaccinations", icon: Syringe, count: vaccinations.length },
      { key: "pregnancy" as const, label: "Pregnancy", icon: Baby, count: pregnancyRecords.length },
      { key: "reports" as const, label: "Reports", icon: FileText, count: reports.length },
    ] : []),
  ];

  return (
    <div>
      <div className="staff-page-heading flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#A8864A]">Patient register</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-[#233A59]">Patient records</h1>
          <p className="mt-3 text-slate-600">{canEditClinical ? "Private clinical records for registered patients." : "Patient registration, contact, billing and lab coordination."}</p>
        </div>
        <Link href="/admin/reception" className="inline-flex items-center gap-2 rounded-xl bg-[#233A59] px-5 py-3 text-sm font-bold text-white">
          <ClipboardPlus size={18} /> Express registration
        </Link>
      </div>

      {message && <p className="mt-5 rounded-xl bg-blue-50 px-4 py-3 text-sm font-medium text-blue-800">{message}</p>}
      {archiveTarget && profile.role === "admin" && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-sm">
          <form onSubmit={(event) => { event.preventDefault(); void archivePatient(); }} role="dialog" aria-modal="true" aria-labelledby="archive-patient-title" className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-50 text-amber-800"><Archive size={23} /></div>
              <button type="button" onClick={() => { setArchiveTarget(null); setArchiveConfirmation(""); setArchiveReason(""); }} aria-label="Close patient archive" className="rounded-xl p-2 text-slate-500 hover:bg-slate-100"><X size={20} /></button>
            </div>
            <h2 id="archive-patient-title" className="mt-5 text-2xl font-bold text-[#233A59]">Archive this patient?</h2>
            <p className="mt-3 leading-7 text-slate-600"><strong>{archiveTarget.fullName}</strong> will leave the active register, while all visits, prescriptions, reports, invoices and receipts remain safely retained.</p>
            <div className="mt-5 rounded-2xl bg-amber-50 p-4 text-sm text-amber-950 ring-1 ring-amber-200">This is recoverable. An administrator can restore the record later, and both actions are recorded in the audit history.</div>
            <label className={labelClass + " mt-5 block"}>Reason for archiving<textarea value={archiveReason} onChange={(event) => setArchiveReason(event.target.value)} required minLength={8} maxLength={300} rows={3} placeholder="For example: duplicate record created in error" className={inputClass} /></label>
            <label className={labelClass + " mt-4 block"}>Type <strong>{archiveTarget.patientNumber || archiveTarget.id}</strong> to confirm<input value={archiveConfirmation} onChange={(event) => setArchiveConfirmation(event.target.value)} autoComplete="off" className={inputClass} /></label>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => { setArchiveTarget(null); setArchiveConfirmation(""); setArchiveReason(""); }} disabled={lifecycleActionId === archiveTarget.id} className="min-h-11 rounded-xl border border-slate-200 px-5 py-3 text-sm font-bold text-slate-700 disabled:opacity-60">Cancel</button>
              <button type="submit" disabled={lifecycleActionId === archiveTarget.id || archiveReason.trim().length < 8 || archiveConfirmation.trim() !== (archiveTarget.patientNumber || archiveTarget.id)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-amber-700 px-5 py-3 text-sm font-bold text-white hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-50">{lifecycleActionId === archiveTarget.id ? <LoaderCircle size={18} className="animate-spin" /> : <Archive size={18} />}{lifecycleActionId === archiveTarget.id ? "Archiving…" : "Archive patient safely"}</button>
            </div>
          </form>
        </div>
      )}

      <div className="mt-7 grid gap-6 xl:grid-cols-[0.72fr_1.28fr]">
        <section className={selectedPatient ? "hidden xl:block" : "block"}>
          {profile.role === "admin" && (
            <div className="mb-3 grid grid-cols-2 rounded-2xl bg-slate-200/70 p-1" aria-label="Patient record status">
              <button type="button" onClick={() => { setPatientView("active"); clearSelectedPatientData(); setVisibleCount(20); }} className={"rounded-xl px-3 py-2.5 text-sm font-bold transition " + (patientView === "active" ? "bg-white text-[#233A59] shadow-sm" : "text-slate-600")}>Active ({activePatients.length})</button>
              <button type="button" onClick={() => { setPatientView("archived"); clearSelectedPatientData(); setVisibleCount(20); }} className={"rounded-xl px-3 py-2.5 text-sm font-bold transition " + (patientView === "archived" ? "bg-white text-amber-800 shadow-sm" : "text-slate-600")}>Archived ({archivedPatients.length})</button>
            </div>
          )}
          <label className="relative block"><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={19} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, mobile or patient ID" className="w-full rounded-2xl border border-slate-200 bg-white py-3.5 pl-12 pr-4 outline-none focus:border-[#233A59]" /></label>
          <div className="performance-list mt-4 space-y-2 xl:max-h-[calc(100dvh-14rem)] xl:overflow-y-auto xl:pr-2">
            {visiblePatients.map((patient) => {
              const selected = patient.id === selectedId;
              return (
                <button key={patient.id} type="button" onClick={() => { selectPatient(patient.id); window.scrollTo({ top: 0, behavior: "smooth" }); }} className={"flex w-full items-center gap-3 rounded-2xl p-3.5 text-left shadow-sm ring-1 transition " + (selected ? "bg-[#233A59] text-white ring-[#233A59]" : "bg-white text-slate-700 ring-slate-200 hover:ring-[#A8864A]")}>
                  <span className={"flex h-11 w-11 shrink-0 items-center justify-center rounded-xl " + (selected ? "bg-white/10" : "bg-blue-50 text-blue-700")}><UserRound size={20} /></span>
                  <span className="min-w-0 flex-1"><span className="block truncate font-bold">{patient.fullName}</span><span className={"mt-1 block text-xs " + (selected ? "text-slate-200" : "text-slate-500")}>{patient.patientNumber ?? "Patient"} · {patient.phone}</span></span>
                  <ChevronRight size={18} />
                </button>
              );
            })}
          </div>
          {!search.trim() && visiblePatients.length < filtered.length && (
            <button type="button" onClick={() => setVisibleCount((count) => count + 20)} className="mt-3 min-h-11 w-full rounded-xl border border-slate-200 bg-white text-sm font-bold text-[#233A59]">Show 20 more patients</button>
          )}
          {filtered.length === 0 && <div className={cardClass + " mt-5 text-center"}><UserRound className="mx-auto text-[#A8864A]" size={34} /><p className="mt-4 font-bold text-[#233A59]">No matching patients</p></div>}
        </section>

        <section className={!selectedPatient ? "hidden xl:block" : "block"}>
          {!selectedPatient ? (
            <div className={cardClass + " flex min-h-80 flex-col items-center justify-center text-center"}><NotebookTabs className="text-[#A8864A]" size={42} /><h2 className="mt-5 text-xl font-bold text-[#233A59]">Select a patient</h2><p className="mt-2 max-w-sm text-sm leading-6 text-slate-600">Open a profile to review visits, prescriptions, vaccinations and pregnancy follow-up.</p></div>
          ) : (
            <div className="rounded-3xl bg-white shadow-sm ring-1 ring-slate-200">
              <div className="rounded-t-3xl bg-[#233A59] p-5 text-white sm:p-8">
                <div className="flex flex-wrap justify-between gap-5">
                  <button type="button" onClick={() => clearSelectedPatientData()} className="inline-flex min-h-10 w-full items-center gap-2 rounded-xl bg-white/10 px-3 text-sm font-bold text-white xl:hidden"><ChevronRight className="rotate-180" size={17} /> All patients</button>
                  <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#D4B873]">{selectedPatient.patientNumber ?? "Patient profile"}</p><h2 className="mt-2 text-2xl font-bold">{selectedPatient.fullName}</h2><p className="mt-2 text-sm text-slate-200">{selectedPatient.phone} · DOB {selectedPatient.dateOfBirth}{selectedPatient.doctorName ? " · " + selectedPatient.doctorName : ""}</p></div>
                  <div className="flex items-center gap-3">
                    {profile.role === "admin" && selectedPatient.archived === true ? (
                      <button type="button" onClick={() => { if (window.confirm(`Restore ${selectedPatient.fullName} to the active patient register?`)) void restorePatient(selectedPatient); }} disabled={lifecycleActionId === selectedPatient.id} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-emerald-300/60 bg-emerald-950/20 px-4 py-2 text-sm font-bold text-emerald-100 hover:bg-emerald-950/40 disabled:opacity-60">
                        {lifecycleActionId === selectedPatient.id ? <LoaderCircle size={17} className="animate-spin" /> : <ArchiveRestore size={17} />} Restore patient
                      </button>
                    ) : profile.role === "admin" ? (
                      <button type="button" onClick={() => { setArchiveTarget(selectedPatient); setArchiveConfirmation(""); setArchiveReason(""); setMessage(""); }} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-amber-300/60 bg-amber-950/20 px-4 py-2 text-sm font-bold text-amber-100 hover:bg-amber-950/40">
                        <Archive size={17} /> Archive patient
                      </button>
                    ) : null}
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10"><ShieldCheck size={27} /></div>
                  </div>
                </div>
              </div>
              {selectedPatient.archived === true ? (
                <div className="border-b border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-950 sm:px-7"><strong>Archived record.</strong> Daily actions and clinical editing are paused. {selectedPatient.archiveReason ? `Reason: ${selectedPatient.archiveReason}` : "Restore the patient to resume care."}</div>
              ) : <PatientQuickActions patient={selectedPatient} />}
              <div className="sticky top-[65px] z-20 flex gap-2 overflow-x-auto border-b border-slate-200 bg-white p-2.5 shadow-sm sm:top-[69px]">
                {tabs.map(({ key, label, icon: Icon, count }) => <button key={key} type="button" onClick={() => setActiveTab(key)} className={"inline-flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold " + (activeTab === key ? "bg-[#233A59] text-white" : "text-slate-600 hover:bg-slate-100")}><Icon size={16} />{label}{typeof count === "number" && <span className="rounded-full bg-white/15 px-1.5 text-xs">{count}</span>}</button>)}
              </div>
              <div className="p-5 sm:p-7">
                {activeTab === "overview" && <Overview canEditDemographics={canEditDemographics && canEditSelectedProfile} canEditClinical={canModifySelectedPatient} canEditProfile={canEditSelectedProfile} canViewClinical={canEditClinical} patient={selectedPatient} showEdit={showEdit} setShowEdit={setShowEdit} editPatient={editPatient} saving={saving} />}
                {activeTab === "timeline" && <TimelinePanel items={timeline} vaccinations={vaccinations} pregnancyRecords={pregnancyRecords} />}
                {activeTab === "visits" && <VisitsPanel canEdit={canModifySelectedPatient} signedDoctorName={profile.role === "doctor" ? profile.doctorName : undefined} records={visits} saving={saving} onSave={(event) => { const form = new FormData(event.currentTarget); return saveRecord(event, "visits", { visitDate: text(form, "visitDate"), doctorName: text(form, "doctorName"), chiefComplaint: text(form, "chiefComplaint"), vitals: text(form, "vitals"), diagnosis: text(form, "diagnosis"), treatment: text(form, "treatment"), followUpDate: text(form, "followUpDate"), notes: text(form, "notes") }); }} />}
                {activeTab === "prescriptions" && <PrescriptionsPanel canEdit={canModifySelectedPatient} signedDoctorName={profile.role === "doctor" ? profile.doctorName : undefined} patient={selectedPatient} records={prescriptions} saving={saving} onSave={(event) => { const form = new FormData(event.currentTarget); return saveRecord(event, "prescriptions", { prescribedDate: text(form, "prescribedDate"), doctorName: text(form, "doctorName"), medicines: [{ name: text(form, "medicineName"), dose: text(form, "dose"), frequency: text(form, "frequency"), duration: text(form, "duration"), instructions: text(form, "instructions") }], advice: text(form, "advice") }); }} />}
                {activeTab === "growth" && <GrowthPanel canEdit={canModifySelectedPatient} records={growthRecords} saving={saving} onSave={(event) => { const form = new FormData(event.currentTarget); const weightKg = numericValue(form, "weightKg"); const heightCm = numericValue(form, "heightCm"); const headCircumferenceCm = numericValue(form, "headCircumferenceCm"); if (!weightKg && !heightCm && !headCircumferenceCm) { event.preventDefault(); setMessage("Add at least one growth measurement before saving."); return Promise.resolve(); } const bmi = weightKg && heightCm ? Number((weightKg / ((heightCm / 100) ** 2)).toFixed(1)) : null; return saveRecord(event, "growthRecords", { measuredDate: text(form, "measuredDate"), weightKg, heightCm, headCircumferenceCm, bmi, milestone: text(form, "milestone"), nutritionNotes: text(form, "nutritionNotes"), clinician: text(form, "clinician") }); }} />}
                {activeTab === "vaccinations" && <VaccinationsPanel canEdit={canModifySelectedPatient} records={vaccinations} saving={saving} onSave={(event) => { const form = new FormData(event.currentTarget); return saveRecord(event, "vaccinations", { vaccineName: text(form, "vaccineName"), doseNumber: text(form, "doseNumber"), administeredDate: text(form, "administeredDate"), nextDueDate: text(form, "nextDueDate"), batchNumber: text(form, "batchNumber"), manufacturer: text(form, "manufacturer"), expiryDate: text(form, "expiryDate"), route: text(form, "route"), site: text(form, "site"), administeredBy: text(form, "administeredBy"), adverseEvents: text(form, "adverseEvents"), notes: text(form, "notes") }); }} />}
                {activeTab === "pregnancy" && <PregnancyPanel canEdit={canModifySelectedPatient} records={pregnancyRecords} saving={saving} onSave={(event) => { const form = new FormData(event.currentTarget); return saveRecord(event, "pregnancyRecords", { recordedDate: text(form, "recordedDate"), lmpDate: text(form, "lmpDate"), eddDate: text(form, "eddDate"), gestationalWeeks: text(form, "gestationalWeeks"), bloodPressure: text(form, "bloodPressure"), weight: text(form, "weight"), fetalHeartRate: text(form, "fetalHeartRate"), nextVisitDate: text(form, "nextVisitDate"), gravida: text(form, "gravida"), para: text(form, "para"), riskLevel: text(form, "riskLevel"), riskFactors: text(form, "riskFactors"), symptoms: text(form, "symptoms"), fundalHeight: text(form, "fundalHeight"), fetalMovement: text(form, "fetalMovement"), investigations: text(form, "investigations"), carePlan: text(form, "carePlan"), notes: text(form, "notes") }); }} />}
                {activeTab === "reports" && <ReportsPanel records={reports} uploading={uploading} action={reportAction} onUpload={canModifySelectedPatient ? uploadReport : undefined} onAccess={accessReport} />}
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

function PrescriptionDocumentActions({
  patient,
  doctorName,
  prescription,
  compact = false,
}: {
  patient: Patient;
  doctorName: string;
  prescription?: PrescriptionRecord;
  compact?: boolean;
}) {
  const [action, setAction] = useState<"print" | "download" | null>(null);
  const [error, setError] = useState("");
  const disabled = !doctorName || action !== null;
  const buttonSize = compact ? "px-3 py-2 text-xs" : "min-h-10 px-4 py-2 text-sm";

  const runAction = async (mode: "print" | "download") => {
    setAction(mode);
    setError("");
    try {
      const {
        downloadBlankPrescriptionPdf,
        downloadPrescriptionPdf,
        printBlankPrescriptionPdf,
        printPrescriptionPdf,
      } = await import("@/lib/prescription-pdf");
      if (prescription) {
        await (mode === "print"
          ? printPrescriptionPdf(patient, prescription)
          : downloadPrescriptionPdf(patient, prescription));
      } else {
        await (mode === "print"
          ? printBlankPrescriptionPdf(patient, doctorName)
          : downloadBlankPrescriptionPdf(patient, doctorName));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to prepare the prescription.");
    } finally {
      setAction(null);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => void runAction("print")}
          className={"inline-flex items-center justify-center gap-2 rounded-xl border border-[#233A59]/20 bg-white font-bold text-[#233A59] transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50 " + buttonSize}
        >
          {action === "print" ? <LoaderCircle className="animate-spin" size={16} /> : <Printer size={16} />}
          Print
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => void runAction("download")}
          className={"inline-flex items-center justify-center gap-2 rounded-xl bg-[#233A59] font-bold text-white transition hover:bg-[#1b2d46] disabled:cursor-not-allowed disabled:opacity-50 " + buttonSize}
        >
          {action === "download" ? <LoaderCircle className="animate-spin" size={16} /> : <Download size={16} />}
          Download
        </button>
      </div>
      {error && <p className="mt-2 max-w-sm text-xs font-medium text-red-700">{error}</p>}
    </div>
  );
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
      <PrescriptionDocumentActions patient={patient} doctorName={doctorName} />
    </div>
  );
}

function Overview({ canEditDemographics, canEditClinical, canEditProfile, canViewClinical, patient, showEdit, setShowEdit, editPatient, saving }: { canEditDemographics: boolean; canEditClinical: boolean; canEditProfile: boolean; canViewClinical: boolean; patient: Patient; showEdit: boolean; setShowEdit: (value: boolean) => void; editPatient: (event: FormEvent<HTMLFormElement>) => Promise<void>; saving: boolean }) {
  if (showEdit) {
    return (
      <form key={patient.id} onSubmit={editPatient} className="grid gap-4 sm:grid-cols-2">
        <SectionHeading icon={UserRound} title="Edit patient profile" action={canEditDemographics && canEditClinical ? "Keep identity and clinical background current" : canEditDemographics ? "Keep identity, contact and doctor assignment current" : "Update the assigned patient\u2019s clinical background"} />
        <span className="hidden sm:block" />
        <label className={labelClass}>Full name<input name="fullName" required={canEditDemographics} disabled={!canEditDemographics} defaultValue={patient.fullName} className={inputClass + " disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"} /></label>
        <label className={labelClass}>Mobile number<input name="phone" required={canEditDemographics} disabled={!canEditDemographics} defaultValue={patient.phone} className={inputClass + " disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"} /></label>
        <label className={labelClass}>Date of birth<input name="dateOfBirth" type="date" required={canEditDemographics} disabled={!canEditDemographics} defaultValue={patient.dateOfBirth} className={inputClass + " disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"} /></label>
        <label className={labelClass}>Gender<select name="gender" disabled={!canEditDemographics} defaultValue={patient.gender} className={inputClass + " disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"}><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></select></label>
        <label className={labelClass + " sm:col-span-2"}>Consulting doctor<select name="doctorName" required={canEditDemographics} disabled={!canEditDemographics} defaultValue={patient.doctorName ?? ""} className={inputClass + " disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"}><option value="" disabled>Select doctor</option><option>Dr. Lt Col Shafi Ahamad</option><option>Dr. Shaik Reshma</option></select></label>
        <label className={labelClass + " sm:col-span-2"}>Address<textarea name="address" disabled={!canEditDemographics} defaultValue={patient.address} rows={2} className={inputClass + " disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"} /></label>
        {canEditClinical ? <><label className={labelClass}>Known allergies<textarea name="allergies" defaultValue={patient.allergies} rows={3} className={inputClass} /></label><label className={labelClass}>Medical history<textarea name="medicalHistory" defaultValue={patient.medicalHistory} rows={3} className={inputClass} /></label></> : null}
        <div className="flex gap-3 sm:col-span-2"><SaveButton saving={saving} label="Update profile" /><button type="button" onClick={() => setShowEdit(false)} className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-bold">Cancel</button></div>
      </form>
    );
  }

  return (
    <div>
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <SectionHeading icon={ClipboardPlus} title={canViewClinical ? "Clinical overview" : "Patient overview"} action={canViewClinical ? "Identity, allergies and medical background" : "Identity and reception details"} />
        <div className="flex flex-col gap-2">
          <BlankPrescriptionAction key={patient.id + ":" + (patient.doctorName ?? "")} patient={patient} />
          {canEditProfile && <button type="button" onClick={() => setShowEdit(true)} className="self-end rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-[#233A59]">Edit profile</button>}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Info label="Consulting doctor" value={patient.doctorName || "Not assigned"} />
        <Info
          label="Registration case"
          value={patient.caseType === "specialist"
            ? `${patient.specialty === "pediatrics" ? "Pediatric" : patient.specialty === "obg" ? "OBG" : "Specialist"} · ₹${patient.consultationFee ?? 500}`
            : patient.caseType === "general"
              ? `General · ₹${patient.consultationFee ?? 250}`
              : "Legacy patient · fee not classified"}
        />
        <Info label="Gender" value={patient.gender} />
        <Info label="Address" value={patient.address} />
        {canViewClinical ? <Info label="Known allergies" value={patient.allergies || "None recorded"} alert={Boolean(patient.allergies)} /> : null}
        {canViewClinical ? <Info label="Medical history" value={patient.medicalHistory || "No history recorded"} /> : null}
      </div>
    </div>
  );
}

function Info({ label, value, alert = false }: { label: string; value: string; alert?: boolean }) {
  return <div className={"rounded-2xl p-4 " + (alert ? "bg-amber-50 ring-1 ring-amber-200" : "bg-slate-50")}><p className="text-xs font-bold uppercase tracking-wider text-slate-500">{label}</p><p className="mt-2 whitespace-pre-wrap text-sm font-medium capitalize text-slate-800">{value}</p></div>;
}

function ClinicalReadOnlyNotice() {
  return <div className="mb-5 rounded-2xl bg-blue-50 p-4 text-sm text-blue-900 ring-1 ring-blue-100"><p className="font-bold">Clinical history · read only</p><p className="mt-1 leading-6 text-blue-800">Reception staff can review this record. A doctor or administrator must add or change clinical entries.</p></div>;
}

function VisitsPanel({ canEdit, signedDoctorName, records, saving, onSave }: { canEdit: boolean; signedDoctorName?: string; records: VisitRecord[]; saving: boolean; onSave: (event: FormEvent<HTMLFormElement>) => Promise<void> }) {
  return <div><SectionHeading icon={Stethoscope} title="Visit history" action="Consultation notes and follow-up" />{!canEdit && <ClinicalReadOnlyNotice />}<form onSubmit={onSave} className={(canEdit ? "grid" : "hidden") + " gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-2"}><label className={labelClass}>Visit date<input name="visitDate" type="date" required className={inputClass} /></label><label className={labelClass}>Doctor<select name="doctorName" required defaultValue={signedDoctorName ?? ""} disabled={Boolean(signedDoctorName)} className={inputClass + " disabled:bg-slate-100"}><option value="" disabled>Select doctor</option><option>Dr. Lt Col Shafi Ahamad</option><option>Dr. Shaik Reshma</option></select>{signedDoctorName ? <input type="hidden" name="doctorName" value={signedDoctorName} /> : null}</label><label className={labelClass + " sm:col-span-2"}>Chief complaint<textarea name="chiefComplaint" required rows={2} className={inputClass} /></label><label className={labelClass}>Vitals<input name="vitals" placeholder="Temp, pulse, BP, weight" className={inputClass} /></label><label className={labelClass}>Follow-up date<input name="followUpDate" type="date" className={inputClass} /></label><label className={labelClass}>Diagnosis<textarea name="diagnosis" required rows={3} className={inputClass} /></label><label className={labelClass}>Treatment plan<textarea name="treatment" rows={3} className={inputClass} /></label><label className={labelClass + " sm:col-span-2"}>Clinical notes<textarea name="notes" rows={2} className={inputClass} /></label><div className="sm:col-span-2"><SaveButton saving={saving} label="Add visit" /></div></form><div className="mt-5 space-y-3">{records.map((record) => <article key={record.id} className="rounded-2xl border border-slate-200 p-4"><div className="flex flex-wrap justify-between gap-2"><p className="font-bold text-[#233A59]">{record.visitDate} · {record.doctorName}</p><span className="text-xs text-slate-500">{formatCreatedAt(record.createdAt)}</span></div><p className="mt-3 text-sm font-medium text-slate-800">{record.chiefComplaint}</p><p className="mt-2 text-sm text-slate-600"><strong>Diagnosis:</strong> {record.diagnosis}</p>{record.treatment && <p className="mt-1 text-sm text-slate-600"><strong>Plan:</strong> {record.treatment}</p>}{record.followUpDate && <p className="mt-3 inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2 py-1 text-xs font-bold text-blue-800"><CalendarClock size={13} /> Follow-up {record.followUpDate}</p>}</article>)}{records.length === 0 && <Empty label="No visits recorded yet" />}</div></div>;
}

function PrescriptionsPanel({ canEdit, signedDoctorName, patient, records, saving, onSave }: { canEdit: boolean; signedDoctorName?: string; patient: Patient; records: PrescriptionRecord[]; saving: boolean; onSave: (event: FormEvent<HTMLFormElement>) => Promise<void> }) {
  return (
    <div>
      <SectionHeading icon={FileHeart} title="Prescriptions" action="Medication history and clinic-branded PDF prescriptions" />
      {!canEdit && <ClinicalReadOnlyNotice />}
      <form onSubmit={onSave} className={(canEdit ? "grid" : "hidden") + " gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-2"}>
        <label className={labelClass}>Prescription date<input name="prescribedDate" type="date" required className={inputClass} /></label>
        <label className={labelClass}>Doctor<select name="doctorName" required defaultValue={signedDoctorName ?? ""} disabled={Boolean(signedDoctorName)} className={inputClass + " disabled:bg-slate-100"}><option value="" disabled>Select doctor</option><option>Dr. Lt Col Shafi Ahamad</option><option>Dr. Shaik Reshma</option></select>{signedDoctorName ? <input type="hidden" name="doctorName" value={signedDoctorName} /> : null}</label>
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
              <PrescriptionDocumentActions
                patient={patient}
                doctorName={record.doctorName}
                prescription={record}
                compact
              />
            </div>
            {Array.isArray(record.medicines) ? record.medicines.filter((medicine) => medicine && typeof medicine === "object").map((medicine, index) => <div key={index} className="mt-3 rounded-xl bg-slate-50 p-3"><p className="font-bold text-slate-800">{medicine.name}</p><p className="mt-1 text-sm text-slate-600">{[medicine.dose, medicine.frequency, medicine.duration].filter(Boolean).join(" · ")}</p>{medicine.instructions && <p className="mt-1 text-xs text-slate-500">{medicine.instructions}</p>}</div>) : <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-900">This legacy medicine record needs administrator review.</p>}
            {record.advice && <p className="mt-3 text-sm text-slate-600"><strong>Advice:</strong> {record.advice}</p>}
          </article>
        ))}
        {records.length === 0 && <Empty label="No prescriptions recorded yet" />}
      </div>
    </div>
  );
}

function TimelinePanel({ items, vaccinations, pregnancyRecords }: { items: TimelineItem[]; vaccinations: VaccinationRecord[]; pregnancyRecords: PregnancyRecord[] }) {
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const inThirtyDays = new Date(new Date(today + "T00:00:00Z").getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
  const vaccineDue = vaccinations.filter((record) => record.nextDueDate && record.nextDueDate <= inThirtyDays);
  const antenatalDue = pregnancyRecords.filter((record) => record.nextVisitDate && record.nextVisitDate <= inThirtyDays);
  const iconFor = (kind: TimelineItem["kind"]) => ({
    visit: Stethoscope,
    prescription: FileHeart,
    vaccination: Syringe,
    pregnancy: Baby,
    growth: ChartNoAxesCombined,
    report: FileText,
    lab: Activity,
    invoice: FileText,
  })[kind];

  return (
    <div>
      <SectionHeading icon={History} title="Patient timeline" action="Clinical care, reports and payments in one chronological view" />
      {(vaccineDue.length > 0 || antenatalDue.length > 0) && (
        <div className="mb-5 grid gap-3 sm:grid-cols-2">
          {vaccineDue.length > 0 && <div className="rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200"><p className="flex items-center gap-2 text-sm font-bold text-amber-900"><TriangleAlert size={17} /> Vaccination attention</p><p className="mt-2 text-sm text-amber-800">{vaccineDue.length} dose{vaccineDue.length === 1 ? "" : "s"} overdue or due within 30 days.</p></div>}
          {antenatalDue.length > 0 && <div className="rounded-2xl bg-rose-50 p-4 ring-1 ring-rose-200"><p className="flex items-center gap-2 text-sm font-bold text-rose-900"><HeartPulse size={17} /> Antenatal follow-up</p><p className="mt-2 text-sm text-rose-800">{antenatalDue.length} visit{antenatalDue.length === 1 ? "" : "s"} overdue or due within 30 days.</p></div>}
        </div>
      )}
      <div className="relative space-y-3 before:absolute before:bottom-5 before:left-[1.45rem] before:top-5 before:w-px before:bg-slate-200">
        {items.map((item) => {
          const Icon = iconFor(item.kind);
          return (
            <article key={item.id} className="relative flex gap-4 rounded-2xl border border-slate-200 bg-white p-4">
              <span className="z-10 grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700 ring-4 ring-white"><Icon size={19} /></span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-bold text-[#233A59]">{item.title}</p><p className="mt-1 text-sm text-slate-600">{item.detail}</p></div><time className="text-xs font-semibold text-slate-500">{friendlyDate(item.date)}</time></div>
                {item.status && <span className="mt-2 inline-flex rounded-lg bg-slate-100 px-2 py-1 text-xs font-bold capitalize text-slate-700">{item.status}</span>}
              </div>
            </article>
          );
        })}
        {items.length === 0 && <Empty label="The patient timeline will appear as care records are added" />}
      </div>
    </div>
  );
}

function MiniTrend({ records, metric, label, unit, icon: Icon }: { records: GrowthRecord[]; metric: "weightKg" | "heightCm"; label: string; unit: string; icon: typeof Scale }) {
  const points = records
    .filter((record) => typeof record[metric] === "number")
    .sort((a, b) => a.measuredDate.localeCompare(b.measuredDate))
    .slice(-8);
  const values = points.map((record) => Number(record[metric]));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const polyline = points.map((record, index) => `${points.length === 1 ? 50 : 6 + (index / (points.length - 1)) * 88},${54 - ((Number(record[metric]) - min) / range) * 40}`).join(" ");
  const latest = values.at(-1);

  return (
    <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
      <div className="flex items-center justify-between"><p className="flex items-center gap-2 text-sm font-bold text-[#233A59]"><Icon size={17} />{label}</p><strong className="text-lg text-[#233A59]">{latest ? `${latest} ${unit}` : "—"}</strong></div>
      {points.length > 1 ? <svg viewBox="0 0 100 60" role="img" aria-label={`${label} trend across ${points.length} measurements`} className="mt-3 h-20 w-full overflow-visible"><path d="M6 54 H94" stroke="#cbd5e1" strokeWidth="1" /><polyline points={polyline} fill="none" stroke="#A8864A" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />{polyline.split(" ").map((point, index) => { const [cx, cy] = point.split(","); return <circle key={index} cx={cx} cy={cy} r="2.5" fill="#233A59" />; })}</svg> : <p className="mt-4 text-xs text-slate-500">Add at least two measurements to see a trend.</p>}
    </div>
  );
}

function GrowthPanel({ canEdit, records, saving, onSave }: { canEdit: boolean; records: GrowthRecord[]; saving: boolean; onSave: (event: FormEvent<HTMLFormElement>) => Promise<void> }) {
  return (
    <div>
      <SectionHeading icon={ChartNoAxesCombined} title="Child growth & development" action="Longitudinal measurements and clinician-observed milestones" />
      <div className="mb-5 grid gap-3 sm:grid-cols-2"><MiniTrend records={records} metric="weightKg" label="Weight trend" unit="kg" icon={Scale} /><MiniTrend records={records} metric="heightCm" label="Height trend" unit="cm" icon={Ruler} /></div>
      {!canEdit && <ClinicalReadOnlyNotice />}
      <form onSubmit={onSave} className={(canEdit ? "grid" : "hidden") + " gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-2"}>
        <label className={labelClass}>Measurement date<input name="measuredDate" type="date" required className={inputClass} /></label>
        <label className={labelClass}>Clinician<select name="clinician" required defaultValue="" className={inputClass}><option value="" disabled>Select clinician</option><option>Dr. Lt Col Shafi Ahamad</option><option>Dr. Shaik Reshma</option></select></label>
        <label className={labelClass}>Weight (kg)<input name="weightKg" type="number" min="0.1" max="300" step="0.01" className={inputClass} /></label>
        <label className={labelClass}>Height / length (cm)<input name="heightCm" type="number" min="10" max="250" step="0.1" className={inputClass} /></label>
        <label className={labelClass}>Head circumference (cm)<input name="headCircumferenceCm" type="number" min="10" max="100" step="0.1" className={inputClass} /></label>
        <label className={labelClass}>Developmental milestone<input name="milestone" maxLength={300} placeholder="Clinician-observed milestone" className={inputClass} /></label>
        <label className={labelClass + " sm:col-span-2"}>Nutrition notes<textarea name="nutritionNotes" rows={2} maxLength={600} className={inputClass} /></label>
        <div className="sm:col-span-2"><SaveButton saving={saving} label="Save growth measurement" /></div>
      </form>
      <p className="mt-3 text-xs text-slate-500">Trends support clinical review and are not a diagnosis or percentile assessment.</p>
      <div className="mt-5 space-y-3">{records.map((record) => <article key={record.id} className="rounded-2xl border border-slate-200 p-4"><div className="flex flex-wrap justify-between gap-2"><p className="font-bold text-[#233A59]">{friendlyDate(record.measuredDate)}</p><span className="text-xs font-semibold text-slate-500">{record.clinician}</span></div><div className="mt-3 grid grid-cols-2 gap-2 text-sm text-slate-600 sm:grid-cols-4"><p>Weight: {record.weightKg ? `${record.weightKg} kg` : "—"}</p><p>Height: {record.heightCm ? `${record.heightCm} cm` : "—"}</p><p>Head: {record.headCircumferenceCm ? `${record.headCircumferenceCm} cm` : "—"}</p><p>BMI: {record.bmi || "—"}</p></div>{record.milestone && <p className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900"><strong>Milestone:</strong> {record.milestone}</p>}{record.nutritionNotes && <p className="mt-3 text-sm text-slate-600"><strong>Nutrition:</strong> {record.nutritionNotes}</p>}</article>)}{records.length === 0 && <Empty label="No growth measurements recorded yet" />}</div>
    </div>
  );
}

function VaccinationsPanel({ canEdit, records, saving, onSave }: { canEdit: boolean; records: VaccinationRecord[]; saving: boolean; onSave: (event: FormEvent<HTMLFormElement>) => Promise<void> }) {
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  return (
    <div>
      <SectionHeading icon={Syringe} title="Vaccination record" action="Dose traceability, administration details and due-date monitoring" />
      {!canEdit && <ClinicalReadOnlyNotice />}
      <form onSubmit={onSave} className={(canEdit ? "grid" : "hidden") + " gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-2"}>
        <label className={labelClass}>Vaccine name<input name="vaccineName" required maxLength={120} className={inputClass} /></label>
        <label className={labelClass}>Dose number<input name="doseNumber" maxLength={30} placeholder="e.g. 1, booster" className={inputClass} /></label>
        <label className={labelClass}>Administered date<input name="administeredDate" type="date" required className={inputClass} /></label>
        <label className={labelClass}>Next due date<input name="nextDueDate" type="date" className={inputClass} /></label>
        <label className={labelClass}>Batch / lot number<input name="batchNumber" maxLength={80} className={inputClass} /></label>
        <label className={labelClass}>Manufacturer<input name="manufacturer" maxLength={100} className={inputClass} /></label>
        <label className={labelClass}>Expiry date<input name="expiryDate" type="date" className={inputClass} /></label>
        <label className={labelClass}>Route<select name="route" defaultValue="" className={inputClass}><option value="">Not recorded</option><option value="IM">Intramuscular (IM)</option><option value="SC">Subcutaneous (SC)</option><option value="ID">Intradermal (ID)</option><option value="oral">Oral</option><option value="nasal">Intranasal</option></select></label>
        <label className={labelClass}>Administration site<input name="site" maxLength={80} placeholder="e.g. left thigh" className={inputClass} /></label>
        <label className={labelClass}>Administered by<input name="administeredBy" maxLength={100} className={inputClass} /></label>
        <label className={labelClass + " sm:col-span-2"}>Adverse event / observation<textarea name="adverseEvents" rows={2} maxLength={500} className={inputClass} /></label>
        <label className={labelClass + " sm:col-span-2"}>Notes<textarea name="notes" rows={2} maxLength={500} className={inputClass} /></label>
        <div className="sm:col-span-2"><SaveButton saving={saving} label="Add vaccination" /></div>
      </form>
      <div className="mt-5 space-y-3">{records.map((record) => { const due = record.nextDueDate && record.nextDueDate < today; return <article key={record.id} className="flex items-start gap-4 rounded-2xl border border-slate-200 p-4"><span className="rounded-xl bg-emerald-50 p-3 text-emerald-700"><Syringe size={20} /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap justify-between gap-2"><p className="font-bold text-[#233A59]">{record.vaccineName}{record.doseNumber ? ` · Dose ${record.doseNumber}` : ""}</p>{due && <span className="rounded-lg bg-red-50 px-2 py-1 text-xs font-bold text-red-700">Overdue</span>}</div><p className="mt-1 text-sm text-slate-600">Administered {friendlyDate(record.administeredDate)}{record.batchNumber ? ` · Batch ${record.batchNumber}` : ""}</p>{[record.manufacturer, record.route, record.site].filter(Boolean).length > 0 && <p className="mt-1 text-xs text-slate-500">{[record.manufacturer, record.route, record.site].filter(Boolean).join(" · ")}</p>}{record.nextDueDate && <p className={"mt-2 text-xs font-bold " + (due ? "text-red-700" : "text-blue-700")}>Next due {friendlyDate(record.nextDueDate)}</p>}{record.adverseEvents && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><strong>Observation:</strong> {record.adverseEvents}</p>}</div></article>; })}{records.length === 0 && <Empty label="No vaccinations recorded yet" />}</div>
    </div>
  );
}

function pregnancyDates(lmpDate: string, recordedDate: string, today: string) {
  if (!lmpDate) return { edd: "", weeks: "" };
  const lmp = new Date(lmpDate + "T00:00:00Z");
  const recorded = new Date((recordedDate || today) + "T00:00:00Z");
  if (Number.isNaN(lmp.getTime()) || Number.isNaN(recorded.getTime()) || recorded < lmp) return { edd: "", weeks: "" };
  const edd = new Date(lmp.getTime() + 280 * 86_400_000).toISOString().slice(0, 10);
  const totalDays = Math.floor((recorded.getTime() - lmp.getTime()) / 86_400_000);
  return { edd, weeks: `${Math.floor(totalDays / 7)}w ${totalDays % 7}d` };
}

function PregnancyPanel({ canEdit, records, saving, onSave }: { canEdit: boolean; records: PregnancyRecord[]; saving: boolean; onSave: (event: FormEvent<HTMLFormElement>) => Promise<void> }) {
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const [lmpDate, setLmpDate] = useState("");
  const [recordedDate, setRecordedDate] = useState("");
  const derived = useMemo(() => pregnancyDates(lmpDate, recordedDate, today), [lmpDate, recordedDate, today]);
  return (
    <div>
      <SectionHeading icon={Baby} title="Pregnancy care timeline" action="Antenatal observations, risk review and care planning" />
      {!canEdit && <ClinicalReadOnlyNotice />}
      <form onSubmit={onSave} className={(canEdit ? "grid" : "hidden") + " gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-2"}>
        <label className={labelClass}>Recorded date<input name="recordedDate" type="date" required value={recordedDate} onChange={(event) => setRecordedDate(event.target.value)} className={inputClass} /></label>
        <label className={labelClass}>LMP date<input name="lmpDate" type="date" required value={lmpDate} onChange={(event) => setLmpDate(event.target.value)} className={inputClass} /></label>
        <label className={labelClass}>Gestational age<input name="gestationalWeeks" readOnly value={derived.weeks} placeholder="Calculated from LMP" className={inputClass + " bg-slate-100"} /></label>
        <label className={labelClass}>Expected delivery date<input name="eddDate" type="date" readOnly value={derived.edd} className={inputClass + " bg-slate-100"} /></label>
        <label className={labelClass}>Gravida<input name="gravida" maxLength={20} placeholder="G" className={inputClass} /></label>
        <label className={labelClass}>Para<input name="para" maxLength={20} placeholder="P" className={inputClass} /></label>
        <label className={labelClass}>Risk level<select name="riskLevel" defaultValue="routine" className={inputClass}><option value="routine">Routine</option><option value="moderate">Needs closer review</option><option value="high">High risk</option></select></label>
        <label className={labelClass}>Next visit<input name="nextVisitDate" type="date" className={inputClass} /></label>
        <label className={labelClass}>Blood pressure<input name="bloodPressure" maxLength={20} placeholder="e.g. 120/80" className={inputClass} /></label>
        <label className={labelClass}>Weight (kg)<input name="weight" maxLength={20} className={inputClass} /></label>
        <label className={labelClass}>Fundal height<input name="fundalHeight" maxLength={30} placeholder="cm / weeks" className={inputClass} /></label>
        <label className={labelClass}>Fetal heart rate<input name="fetalHeartRate" maxLength={30} placeholder="bpm" className={inputClass} /></label>
        <label className={labelClass}>Fetal movement<input name="fetalMovement" maxLength={120} className={inputClass} /></label>
        <label className={labelClass}>Symptoms<input name="symptoms" maxLength={300} className={inputClass} /></label>
        <label className={labelClass + " sm:col-span-2"}>Risk factors<textarea name="riskFactors" rows={2} maxLength={600} className={inputClass} placeholder="Document clinician-assessed risks" /></label>
        <label className={labelClass + " sm:col-span-2"}>Investigations reviewed<textarea name="investigations" rows={2} maxLength={800} className={inputClass} /></label>
        <label className={labelClass + " sm:col-span-2"}>Care plan<textarea name="carePlan" rows={2} maxLength={800} className={inputClass} /></label>
        <label className={labelClass + " sm:col-span-2"}>Notes<textarea name="notes" rows={2} maxLength={800} className={inputClass} /></label>
        <div className="sm:col-span-2"><button disabled={saving || !derived.edd} className="inline-flex items-center gap-2 rounded-xl bg-[#233A59] px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">{saving && <LoaderCircle className="animate-spin" size={17} />}Save antenatal follow-up</button>{!derived.edd && lmpDate && recordedDate && <p className="mt-2 text-xs font-bold text-red-700">Recorded date must be on or after the LMP date.</p>}</div>
      </form>
      <p className="mt-3 text-xs text-slate-500">Gestational age and EDD are calculated from the recorded LMP and require clinician confirmation.</p>
      <div className="mt-5 space-y-3">{records.map((record) => { const highRisk = record.riskLevel === "high"; return <article key={record.id} className={"rounded-2xl border p-4 " + (highRisk ? "border-red-200 bg-red-50/40" : "border-slate-200")}><div className="flex flex-wrap justify-between gap-2"><p className="font-bold text-[#233A59]">{friendlyDate(record.recordedDate)} · {record.gestationalWeeks || "Antenatal follow-up"}</p><div className="flex gap-2">{record.riskLevel && <span className={"rounded-lg px-2 py-1 text-xs font-bold capitalize " + (highRisk ? "bg-red-100 text-red-800" : record.riskLevel === "moderate" ? "bg-amber-100 text-amber-800" : "bg-emerald-50 text-emerald-800")}>{record.riskLevel === "moderate" ? "Closer review" : record.riskLevel}</span>}{record.nextVisitDate && <span className="rounded-lg bg-blue-50 px-2 py-1 text-xs font-bold text-blue-700">Next {friendlyDate(record.nextVisitDate)}</span>}</div></div><div className="mt-3 grid grid-cols-2 gap-2 text-sm text-slate-600 sm:grid-cols-4"><p>BP: {record.bloodPressure || "—"}</p><p>Weight: {record.weight ? `${record.weight} kg` : "—"}</p><p>FHR: {record.fetalHeartRate || "—"}</p><p>EDD: {friendlyDate(record.eddDate)}</p></div>{record.riskFactors && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><strong>Risk review:</strong> {record.riskFactors}</p>}{record.carePlan && <p className="mt-3 text-sm text-slate-600"><strong>Plan:</strong> {record.carePlan}</p>}{record.notes && <p className="mt-2 text-sm text-slate-600">{record.notes}</p>}</article>; })}{records.length === 0 && <Empty label="No pregnancy follow-ups recorded yet" />}</div>
    </div>
  );
}

function ReportsPanel({ records, uploading, action, onUpload, onAccess }: { records: ReportRecord[]; uploading: boolean; action: { id: string; mode: "view" | "download" | "print" } | null; onUpload?: (event: FormEvent<HTMLFormElement>) => Promise<void>; onAccess: (record: ReportRecord, mode: "view" | "download" | "print") => Promise<void> }) {
  return (
    <div>
      <SectionHeading icon={FileUp} title="Medical reports" action="PDFs and images protected by staff-only Firebase access" />
      {onUpload ? <form onSubmit={onUpload} className="grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-2">
        <label className={labelClass}>Report category<select name="category" required defaultValue="" className={inputClass}><option value="" disabled>Select category</option><option>Lab report</option><option>Ultrasound / Imaging</option><option>Prescription / Referral</option><option>Vaccination document</option><option>Other</option></select></label>
        <label className={labelClass}>Report date<input name="reportDate" type="date" required className={inputClass} /></label>
        <label className={labelClass + " sm:col-span-2"}>Choose PDF or image<input name="reportFile" type="file" accept={REPORT_FILE_ACCEPT} required className={inputClass + " file:mr-4 file:rounded-lg file:border-0 file:bg-[#233A59] file:px-3 file:py-2 file:text-sm file:font-bold file:text-white"} /><span className="mt-2 block text-xs font-normal text-slate-500">PDF, JPEG, PNG or WebP only. Maximum 10 MB. The file contents are verified before upload.</span></label>
        <label className={labelClass + " sm:col-span-2"}>Notes<textarea name="notes" rows={2} maxLength={1000} className={inputClass} placeholder="Optional context for this report" /></label>
        <div className="sm:col-span-2"><SaveButton saving={uploading} label="Upload report securely" /></div>
      </form> : <div className="rounded-2xl bg-amber-50 p-4 text-sm font-semibold text-amber-950 ring-1 ring-amber-200">Restore this patient before uploading another medical report.</div>}
      <div className="mt-5 space-y-3">
        {records.map((record) => (
          <article key={record.id} className="rounded-2xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2"><FileText size={18} className="shrink-0 text-[#A8864A]" /><p className="truncate font-bold text-[#233A59]">{record.fileName}</p></div>
                <p className="mt-1 text-sm text-slate-600">{record.category} · {record.reportDate} · {formatFileSize(record.size)}</p>
                <p className="mt-1 text-xs text-slate-500">Uploaded {formatCreatedAt(record.createdAt)}</p>
              </div>
              <div className="grid w-full grid-cols-3 gap-2 sm:flex sm:w-auto">
                <button type="button" disabled={action !== null} onClick={() => void onAccess(record, "view")} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50">{action?.id === record.id && action.mode === "view" ? <LoaderCircle size={15} className="animate-spin" /> : <ExternalLink size={15} />} View</button>
                <button type="button" disabled={action !== null} onClick={() => void onAccess(record, "print")} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50">{action?.id === record.id && action.mode === "print" ? <LoaderCircle size={15} className="animate-spin" /> : <Printer size={15} />} Print</button>
                <button type="button" disabled={action !== null} onClick={() => void onAccess(record, "download")} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#233A59] px-3 py-2 text-xs font-bold text-white transition hover:bg-[#1b2d46] disabled:opacity-50">{action?.id === record.id && action.mode === "download" ? <LoaderCircle size={15} className="animate-spin" /> : <Download size={15} />} Download</button>
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
  return <PatientRegister />;
}
