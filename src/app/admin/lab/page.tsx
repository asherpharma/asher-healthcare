"use client";

import { useStaff } from "@/components/admin/StaffGuard";
import { firestore, storage } from "@/firebase/config";
import { DOCTORS } from "@/lib/appointments";
import { AYUSLAB_PROVIDER } from "@/lib/external-lab-providers";
import { fetchPatientDirectory } from "@/lib/patient-directory";
import {
  MAX_REPORT_FILE_BYTES,
  REPORT_FILE_ACCEPT,
  createPendingLabReportStoragePath,
  downloadReportBlob,
  formatReportFileSize,
  genericReportDownloadName,
  inspectReportFile,
  openPendingReportWindow,
  reportStorageErrorMessage,
  type AcceptedReport,
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
  updateDoc,
  type Timestamp,
} from "firebase/firestore";
import { ref, uploadBytesResumable, type UploadTask } from "firebase/storage";
import {
  Camera,
  CheckCircle2,
  Download,
  Eye,
  ExternalLink,
  FileCheck2,
  FileUp,
  FlaskConical,
  LoaderCircle,
  Plus,
  Printer,
  Search,
  TestTube2,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

type Patient = {
  id: string;
  patientNumber?: string;
  fullName: string;
  phone: string;
  archived?: boolean;
};

type LabStatus = "ordered" | "collected" | "processing" | "completed" | "cancelled";

type LabOrder = {
  id: string;
  orderNumber: string;
  patientId: string;
  patientNumber: string;
  patientName: string;
  patientPhone: string;
  tests: string[];
  priority: "routine" | "urgent";
  clinician: string;
  notes: string;
  status: LabStatus;
  resultSummary?: string;
  reportFileName?: string;
  reportStoragePath?: string;
  reportContentType?: string;
  reportSize?: number;
  reportAttached?: boolean;
  orderedAt?: Timestamp | string;
  completedAt?: Timestamp | string;
  updatedAt?: Timestamp | string;
};

type ReportDraft = {
  file: File;
  accepted: AcceptedReport;
  fileName: string;
  storagePath: string;
};

type UploadPhase = "idle" | "checking" | "uploading" | "linking";
type ReportAction = { orderId: string; action: "preview" | "download" | "print" } | null;
type ResultWorkflowMode = "standard" | "ayuslab";
type AyusImportStep = 1 | 2 | 3 | 4;
type AyusLinkResponse = {
  link?: { ayusLabNumber?: string; version?: number } | null;
  error?: string;
};

const commonTests = [
  "Complete Blood Count (CBC)",
  "HbA1c",
  "Thyroid profile",
  "Liver function test",
  "Kidney function test",
  "Lipid profile",
  "Urine routine",
  "C-reactive protein (CRP)",
  "Vitamin D",
  "Beta hCG",
];

const statusOptions: Array<{ value: LabStatus; label: string }> = [
  { value: "ordered", label: "Ordered" },
  { value: "collected", label: "Sample collected" },
  { value: "processing", label: "Processing" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

const statusStyles: Record<LabStatus, string> = {
  ordered: "bg-blue-50 text-blue-700",
  collected: "bg-violet-50 text-violet-700",
  processing: "bg-amber-50 text-amber-700",
  completed: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-slate-100 text-slate-600",
};

const statusTransitions: Record<LabStatus, LabStatus[]> = {
  ordered: ["collected", "processing", "completed", "cancelled"],
  collected: ["processing", "completed", "cancelled"],
  processing: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

function availableStatusTransitions(status: LabStatus, reception: boolean) {
  return reception
    ? statusTransitions[status].filter((nextStatus) => nextStatus !== "completed")
    : statusTransitions[status];
}

const INITIAL_VISIBLE_ORDERS = 30;

const cardClass = "rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm";
const fieldClass = "mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-[#A8864A] focus:ring-2 focus:ring-[#A8864A]/15";
const labelClass = "text-sm font-semibold text-slate-700";

function timestampMillis(value?: Timestamp | string) {
  if (typeof value === "string") return Date.parse(value) || 0;
  return value?.toMillis?.() ?? 0;
}

function dateTime(value?: Timestamp | string) {
  const date = typeof value === "string" ? new Date(value) : value?.toDate?.();
  if (!date || Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function hasAttachedReport(order?: LabOrder | null) {
  return Boolean(order?.reportAttached || order?.reportStoragePath);
}

function makeOrderNumber() {
  const date = new Date();
  const stamp = date.getFullYear().toString() + String(date.getMonth() + 1).padStart(2, "0") + String(date.getDate()).padStart(2, "0");
  return "LAB-" + stamp + "-" + crypto.randomUUID().slice(0, 6).toUpperCase();
}

function maskedPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return "Not available";
  return `••••••${digits.slice(-4)}`;
}

function orderSortRank(order: LabOrder) {
  const active = !["completed", "cancelled"].includes(order.status);
  if (active && order.priority === "urgent") return 0;
  if (active) return 1;
  if (order.status === "completed") return 2;
  return 3;
}

function finalizationNeedsAdministrator(status: number, message: string) {
  const normalizedMessage = message.toLowerCase();
  if ([400, 401, 403, 404].includes(status)) return true;
  if (status !== 409) return false;
  return /administrator review|cannot continue|cannot be attached|does not belong|metadata changed|not linked to a valid patient|could not be found|must finish attaching/iu
    .test(normalizedMessage);
}

function LabDesk() {
  const { user, profile } = useStaff();
  const db = firestore!;
  const files = storage!;
  const [patients, setPatients] = useState<Patient[]>([]);
  const [orders, setOrders] = useState<LabOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [reportDraft, setReportDraft] = useState<ReportDraft | null>(null);
  const [reportUploaded, setReportUploaded] = useState(false);
  const [reportAction, setReportAction] = useState<ReportAction>(null);
  const [statusBusyOrderId, setStatusBusyOrderId] = useState("");
  const [visibleOrderCount, setVisibleOrderCount] = useState(INITIAL_VISIBLE_ORDERS);
  const [directoryRefresh, setDirectoryRefresh] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [resultOrder, setResultOrder] = useState<LabOrder | null>(null);
  const [resultWorkflowMode, setResultWorkflowMode] = useState<ResultWorkflowMode>("standard");
  const [ayusImportStep, setAyusImportStep] = useState<AyusImportStep>(1);
  const [ayusReportVerified, setAyusReportVerified] = useState(false);
  const [ayusReportPreviewed, setAyusReportPreviewed] = useState(false);
  const [ayusLabNumber, setAyusLabNumber] = useState("");
  const [ayusLinkVersion, setAyusLinkVersion] = useState<number | null>(null);
  const [ayusLinkBusy, setAyusLinkBusy] = useState(false);
  const [administratorRecoveryNeeded, setAdministratorRecoveryNeeded] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | LabStatus>("all");
  const [priorityFilter, setPriorityFilter] = useState<"all" | LabOrder["priority"]>("all");
  const [patientSearch, setPatientSearch] = useState("");
  const [patientsLoaded, setPatientsLoaded] = useState(false);
  const [patientDirectoryScope, setPatientDirectoryScope] = useState("");
  const [patientId, setPatientId] = useState("");
  const [selectedTests, setSelectedTests] = useState<string[]>([]);
  const [customTest, setCustomTest] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const deepLinkedPatientHandled = useRef(false);
  const uploadTaskRef = useRef<UploadTask | null>(null);
  const chooseFileRef = useRef<HTMLInputElement | null>(null);
  const cameraFileRef = useRef<HTMLInputElement | null>(null);
  const fileValidationSequence = useRef(0);
  const directoryScope = `${profile.role}:${profile.doctorName ?? ""}`;
  const patientDirectoryAvailable = patientsLoaded && patientDirectoryScope === directoryScope;
  const isReception = profile.role === "reception";
  const canReadReports = profile.role === "admin"
    || profile.role === "doctor"
    || profile.labReportOperator === true;
  const canUsePartnerPortal = profile.role === "admin" || profile.labReportOperator === true;
  const isAyusImport = resultWorkflowMode === "ayuslab";
  const resultBusy = uploadPhase !== "idle" || ayusLinkBusy;

  useEffect(() => {
    const requestedPriority = new URLSearchParams(window.location.search).get("priority");
    if (requestedPriority !== "routine" && requestedPriority !== "urgent") return;
    const timer = window.setTimeout(() => setPriorityFilter(requestedPriority), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let active = true;
    void fetchPatientDirectory(user)
      .then((directory) => {
        if (!active) return;
        setPatients(directory.map((patient) => ({
          id: patient.id,
          patientNumber: patient.patientNumber,
          fullName: patient.fullName,
          phone: patient.phone,
          archived: patient.archived,
        })));
        setPatientDirectoryScope(directoryScope);
      })
      .catch(() => {
        if (active) {
          setPatients([]);
          setShowCreate(false);
          setResultOrder(null);
          setPatientDirectoryScope("");
          setError("Unable to load the active patient directory. Laboratory actions are unavailable until it is refreshed.");
        }
      })
      .finally(() => {
        if (active) setPatientsLoaded(true);
      });
    return () => { active = false; };
  }, [directoryScope, user]);

  useEffect(() => {
    if (profile.role === "doctor" && !profile.doctorName?.trim()) {
      const timer = window.setTimeout(() => {
        setOrders([]);
        setError("This doctor login is not linked to a clinic doctor. Laboratory orders are unavailable.");
        setLoading(false);
      }, 0);
      return () => window.clearTimeout(timer);
    }

    if (profile.role === "reception" || profile.role === "doctor") {
      let active = true;
      const loadDirectory = async () => {
        try {
          const idToken = await user.getIdToken();
          const response = await fetch("/api/staff/labs/directory", {
            headers: { Authorization: `Bearer ${idToken}` },
          });
          const result = await response.json().catch(() => ({})) as {
            labOrders?: LabOrder[];
            error?: string;
          };
          if (!response.ok) {
            throw new Error(result.error || "The secure laboratory directory could not be loaded.");
          }
          if (active) {
            setOrders(Array.isArray(result.labOrders) ? result.labOrders : []);
            setLoading(false);
          }
        } catch (directoryError) {
          if (active) {
            setOrders([]);
            setError(directoryError instanceof Error
              ? directoryError.message
              : "The secure laboratory directory could not be loaded.");
            setLoading(false);
          }
        }
      };
      void loadDirectory();
      const refresh = () => void loadDirectory();
      const interval = window.setInterval(refresh, 60_000);
      window.addEventListener("focus", refresh);
      return () => {
        active = false;
        window.clearInterval(interval);
        window.removeEventListener("focus", refresh);
      };
    }

    const ordersQuery = query(collection(db, "labOrders"), orderBy("orderedAt", "desc"), limit(300));
    const stopOrders = onSnapshot(ordersQuery, (snapshot) => {
      setOrders(snapshot.docs
        .map((entry) => ({ id: entry.id, ...(entry.data() as Omit<LabOrder, "id">) }))
        .sort((left, right) => timestampMillis(right.orderedAt) - timestampMillis(left.orderedAt)));
      setLoading(false);
    }, () => {
      setError("Unable to load laboratory orders.");
      setLoading(false);
    });
    return stopOrders;
  }, [db, directoryRefresh, profile.doctorName, profile.role, user]);

  useEffect(() => {
    if (!patientDirectoryAvailable || deepLinkedPatientHandled.current) return;

    const params = new URLSearchParams(window.location.search);
    const requestedPatientId = params.get("patient")?.trim();
    if (params.get("new") !== "1" || !requestedPatientId) return;
    const deepLinkedPatientExists = patients.some((patient) => patient.id === requestedPatientId);
    const timer = window.setTimeout(() => {
      deepLinkedPatientHandled.current = true;
      if (!deepLinkedPatientExists) return;
      setPatientId(requestedPatientId);
      setShowCreate(true);
      setError("");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [patientDirectoryAvailable, patients]);

  const filteredOrders = useMemo(() => {
    if (!patientsLoaded || !patientDirectoryAvailable) return [];
    const activePatientIds = new Set(patients.map((patient) => patient.id));
    const term = search.trim().toLowerCase();
    return orders.filter((order) => {
      if (!activePatientIds.has(order.patientId)) return false;
      const matchesStatus = statusFilter === "all" || order.status === statusFilter;
      const matchesPriority = priorityFilter === "all" || order.priority === priorityFilter;
      const haystack = [order.orderNumber, order.patientName, order.patientPhone, order.patientNumber, order.tests.join(" ")].join(" ").toLowerCase();
      return matchesStatus && matchesPriority && (!term || haystack.includes(term));
    }).sort((left, right) => {
      const rankDifference = orderSortRank(left) - orderSortRank(right);
      if (rankDifference !== 0) return rankDifference;
      return timestampMillis(right.orderedAt) - timestampMillis(left.orderedAt);
    });
  }, [orders, patientDirectoryAvailable, patients, patientsLoaded, priorityFilter, search, statusFilter]);

  const visibleOrders = useMemo(
    () => filteredOrders.slice(0, visibleOrderCount),
    [filteredOrders, visibleOrderCount],
  );

  const accessibleOrders = useMemo(() => {
    if (!patientsLoaded || !patientDirectoryAvailable) return [];
    const activePatientIds = new Set(patients.map((patient) => patient.id));
    return orders.filter((order) => activePatientIds.has(order.patientId));
  }, [orders, patientDirectoryAvailable, patients, patientsLoaded]);

  const selectedOrderPatient = useMemo(
    () => patients.find((patient) => patient.id === patientId) ?? null,
    [patientId, patients],
  );

  const patientMatches = useMemo(() => {
    const term = patientSearch.trim().toLowerCase();
    if (!term) return patients.slice(0, 8);
    return patients.filter((patient) => [patient.fullName, patient.phone, patient.patientNumber ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(term)).slice(0, 12);
  }, [patientSearch, patients]);

  const stats = useMemo(() => ({
    active: accessibleOrders.filter((item) => !["completed", "cancelled"].includes(item.status)).length,
    urgent: accessibleOrders.filter((item) => item.priority === "urgent" && item.status !== "completed" && item.status !== "cancelled").length,
    completed: accessibleOrders.filter((item) => item.status === "completed").length,
  }), [accessibleOrders]);

  function toggleTest(test: string) {
    setSelectedTests((current) => current.includes(test) ? current.filter((item) => item !== test) : [...current, test]);
  }

  function addCustomTest() {
    const value = customTest.trim();
    if (!value || selectedTests.includes(value)) return;
    setSelectedTests((current) => [...current, value]);
    setCustomTest("");
  }

  function clearFileInputs() {
    if (chooseFileRef.current) chooseFileRef.current.value = "";
    if (cameraFileRef.current) cameraFileRef.current.value = "";
  }

  function resetResultWorkflow() {
    fileValidationSequence.current += 1;
    uploadTaskRef.current = null;
    setReportDraft(null);
    setReportUploaded(false);
    setUploadProgress(0);
    setUploadPhase("idle");
    setAyusImportStep(1);
    setAyusReportVerified(false);
    setAyusReportPreviewed(false);
    setAyusLabNumber("");
    setAyusLinkVersion(null);
    setAyusLinkBusy(false);
    setAdministratorRecoveryNeeded(false);
    clearFileInputs();
  }

  async function loadExistingAyusLink(order: LabOrder) {
    setAyusLinkBusy(true);
    try {
      const idToken = await user.getIdToken();
      const response = await fetch(`/api/labs/ayus/link?labOrderId=${encodeURIComponent(order.id)}`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const result = await response.json().catch(() => ({})) as AyusLinkResponse;
      if (!response.ok) {
        throw new Error(result.error || "Existing AyusLab linkage could not be checked.");
      }
      if (result.link?.ayusLabNumber) {
        setAyusLabNumber(result.link.ayusLabNumber);
        setAyusLinkVersion(Number.isSafeInteger(result.link.version) ? Number(result.link.version) : null);
      }
    } catch (linkError) {
      setError(linkError instanceof Error
        ? linkError.message
        : "Existing AyusLab linkage could not be checked.");
    } finally {
      setAyusLinkBusy(false);
    }
  }

  function openResultWorkflow(order: LabOrder, mode: ResultWorkflowMode = "standard") {
    resetResultWorkflow();
    setResultWorkflowMode(mode);
    setResultOrder(order);
    setError("");
    if (mode === "ayuslab") void loadExistingAyusLink(order);
  }

  function closeResultWorkflow() {
    if (resultBusy) return;
    if (reportUploaded) {
      setError("The report is uploaded and still needs to be linked to the patient chart. Choose Finish linking report.");
      return;
    }
    setResultOrder(null);
    resetResultWorkflow();
    setError("");
  }

  async function selectReportFile(file?: File) {
    if (!file || reportUploaded) return;
    const validationId = fileValidationSequence.current + 1;
    fileValidationSequence.current = validationId;
    setUploadPhase("checking");
    setUploadProgress(0);
    setReportDraft(null);
    setAyusReportPreviewed(false);
    setAyusReportVerified(false);
    setError("");
    if (file.size >= MAX_REPORT_FILE_BYTES) {
      clearFileInputs();
      setUploadPhase("idle");
      setError("Reports must be smaller than 10 MB.");
      return;
    }
    try {
      const accepted = await inspectReportFile(file);
      if (fileValidationSequence.current !== validationId) return;
      if (!accepted) {
        clearFileInputs();
        setError(file.name.toLowerCase().endsWith(".heic")
          ? "HEIC photos are not supported yet. Choose a JPEG, PNG, WebP, or PDF copy."
          : "Only genuine PDF, JPEG, PNG, or WebP reports are allowed.");
        return;
      }
      if (!resultOrder) return;
      const { fileName, storagePath } = createPendingLabReportStoragePath(
        resultOrder.patientId,
        accepted.extension,
      );
      setReportDraft({ file, accepted, fileName, storagePath });
    } catch {
      if (fileValidationSequence.current === validationId) {
        clearFileInputs();
        setError("The selected report could not be checked. Please choose it again.");
      }
    } finally {
      if (fileValidationSequence.current === validationId) setUploadPhase("idle");
    }
  }

  function removeReportDraft() {
    if (resultBusy || reportUploaded) return;
    fileValidationSequence.current += 1;
    setReportDraft(null);
    setAyusReportPreviewed(false);
    setAyusReportVerified(false);
    setUploadProgress(0);
    clearFileInputs();
    setError("");
  }

  function cancelUpload() {
    uploadTaskRef.current?.cancel();
  }

  function previewSelectedReport() {
    if (!reportDraft || resultBusy) return;
    const preview = openPendingReportWindow();
    if (!preview) {
      setError("Your browser blocked the local preview. Allow pop-ups for Asher Healthcare, then try again.");
      return;
    }

    setError("");
    const previewUrl = URL.createObjectURL(reportDraft.file);
    let revoked = false;
    const revokePreviewUrl = () => {
      if (revoked) return;
      revoked = true;
      URL.revokeObjectURL(previewUrl);
    };
    preview.location.href = previewUrl;
    setAyusReportPreviewed(true);
    window.setTimeout(revokePreviewUrl, 5 * 60_000);
  }

  function leaveForAdministratorRecovery() {
    if (!resultOrder || resultBusy || !reportUploaded || !administratorRecoveryNeeded) return;
    const orderNumber = resultOrder.orderNumber;
    setResultOrder(null);
    resetResultWorkflow();
    setError("");
    setNotice(`The temporary report for ${orderNumber} remains protected. Ask an administrator to review this order before trying another upload.`);
  }

  async function createOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!patientDirectoryAvailable) {
      setError("The active patient directory is unavailable. Refresh before creating a laboratory order.");
      return;
    }
    const selectedPatient = patients.find((item) => item.id === patientId);
    if (!selectedPatient || selectedTests.length === 0) {
      setError("Choose a registered patient and at least one test.");
      return;
    }
    const form = new FormData(event.currentTarget);
    const clinician = String(form.get("clinician") || "").trim();
    if (!DOCTORS.some((doctor) => doctor.name === clinician)) {
      setError("Choose one of the clinic doctors as the ordering clinician.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await addDoc(collection(db, "labOrders"), {
        orderNumber: makeOrderNumber(),
        patientId: selectedPatient.id,
        patientNumber: selectedPatient.patientNumber ?? "",
        patientName: selectedPatient.fullName,
        patientPhone: selectedPatient.phone,
        tests: selectedTests,
        priority: String(form.get("priority") || "routine"),
        clinician,
        notes: String(form.get("notes") || "").trim(),
        status: "ordered",
        createdBy: user.uid,
        orderedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setPatientId("");
      setPatientSearch("");
      setSelectedTests([]);
      setShowCreate(false);
      setNotice("Laboratory order created.");
      if (profile.role !== "admin") setDirectoryRefresh((value) => value + 1);
    } catch {
      setError("The laboratory order could not be created.");
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(order: LabOrder, status: LabStatus) {
    if (!patientDirectoryAvailable || !patients.some((patient) => patient.id === order.patientId)) {
      setError("This laboratory order is no longer linked to an available active patient.");
      return;
    }
    if (status !== order.status && !availableStatusTransitions(order.status, isReception).includes(status)) {
      setError("Choose the next available laboratory step.");
      return;
    }
    if (status === order.status) return;
    if (
      status === "cancelled"
      && !window.confirm("Cancel this laboratory order? Results and reports cannot be attached after cancellation.")
    ) {
      return;
    }
    setStatusBusyOrderId(order.id);
    setError("");
    try {
      const values: Record<string, unknown> = { status, updatedAt: serverTimestamp() };
      if (status === "collected") values.specimenCollectedAt = serverTimestamp();
      if (status === "completed" && !order.completedAt) values.completedAt = serverTimestamp();
      await updateDoc(doc(db, "labOrders", order.id), values);
      if (profile.role !== "admin") setDirectoryRefresh((value) => value + 1);
    } catch {
      setError("Unable to update the laboratory status.");
    } finally {
      setStatusBusyOrderId("");
    }
  }

  async function saveResult(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resultOrder) return;
    if (isAyusImport && (ayusImportStep !== 4 || !ayusReportVerified)) {
      setError("Confirm that the downloaded report matches this patient and laboratory order before attaching it.");
      return;
    }
    if (!patientDirectoryAvailable || !patients.some((patient) => patient.id === resultOrder.patientId)) {
      setResultOrder(null);
      setError("This laboratory order is no longer linked to an available active patient.");
      return;
    }
    const latestOrder = orders.find((order) => order.id === resultOrder.id);
    if (latestOrder?.status === "cancelled") {
      setError("This laboratory order was cancelled while it was open. A report cannot be attached.");
      return;
    }
    if (reportDraft && hasAttachedReport(latestOrder)) {
      setResultOrder(null);
      resetResultWorkflow();
      setNotice("A report is already attached to this order. The existing immutable report was kept.");
      if (profile.role !== "admin") setDirectoryRefresh((value) => value + 1);
      return;
    }
    if (resultOrder.status === "cancelled") {
      setError("Cancelled laboratory orders cannot receive a result or report.");
      return;
    }
    const form = new FormData(event.currentTarget);
    const summary = isReception ? "" : String(form.get("resultSummary") || "").trim();
    if (isReception && !hasAttachedReport(resultOrder) && !reportDraft) {
      setError("Choose the received report before continuing.");
      return;
    }
    if (!isReception && !summary && !reportDraft && !hasAttachedReport(resultOrder)) {
      setError("Add a result summary or upload the report file.");
      return;
    }
    if (reportDraft && hasAttachedReport(resultOrder)) {
      setError("This order already has an immutable report attached.");
      return;
    }

    let externalLinkVersion = ayusLinkVersion;
    if (isAyusImport) {
      const requestedLabNumber = ayusLabNumber.trim();
      if (requestedLabNumber.length < 2) {
        setError("Enter the Ayus Lab No shown for this report before attaching it.");
        return;
      }
      setAyusLinkBusy(true);
      setError("");
      try {
        const idToken = await user.getIdToken();
        const response = await fetch("/api/labs/ayus/link", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${idToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            labOrderId: resultOrder.id,
            ayusLabNumber: requestedLabNumber,
            replacementReason: "Administrator corrected the provider reference after verification.",
          }),
        });
        const result = await response.json().catch(() => ({})) as AyusLinkResponse;
        if (!response.ok) {
          throw new Error(result.error || "The Ayus Lab No could not be linked to this order.");
        }
        const linkedVersion = Number(result.link?.version);
        if (!result.link?.ayusLabNumber || !Number.isSafeInteger(linkedVersion) || linkedVersion < 1) {
          throw new Error("The AyusLab link response could not be verified. Please try again.");
        }
        externalLinkVersion = linkedVersion;
        setAyusLabNumber(result.link.ayusLabNumber);
        setAyusLinkVersion(linkedVersion);
      } catch (linkError) {
        setError(linkError instanceof Error
          ? linkError.message
          : "The Ayus Lab No could not be linked to this order.");
        return;
      } finally {
        setAyusLinkBusy(false);
      }
    }

    setError("");
    if (!reportDraft) {
      setUploadPhase("linking");
      try {
        const updateValues: Record<string, unknown> = {
          status: "completed",
          updatedAt: serverTimestamp(),
        };
        if (!isReception) updateValues.resultSummary = summary;
        if (!resultOrder.completedAt) updateValues.completedAt = serverTimestamp();
        await updateDoc(doc(db, "labOrders", resultOrder.id), updateValues);
        setResultOrder(null);
        resetResultWorkflow();
        setNotice("Laboratory result saved securely.");
        if (profile.role !== "admin") setDirectoryRefresh((value) => value + 1);
      } catch {
        setError("The laboratory result could not be saved. Please check access and try again.");
      } finally {
        setUploadPhase("idle");
      }
      return;
    }

    let fileStored = reportUploaded;
    try {
      if (!fileStored) {
        setUploadPhase("uploading");
        setUploadProgress(0);
        const task = uploadBytesResumable(ref(files, reportDraft.storagePath), reportDraft.file, {
          contentType: reportDraft.accepted.contentType,
          cacheControl: "private, no-store",
          contentDisposition: `inline; filename="${reportDraft.fileName}"`,
          customMetadata: { patientId: resultOrder.patientId, uploadedBy: user.uid, labOrderId: resultOrder.id },
        });
        uploadTaskRef.current = task;
        await new Promise<void>((resolve, reject) => {
          task.on(
            "state_changed",
            (snapshot) => {
              const progress = snapshot.totalBytes > 0
                ? Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)
                : 0;
              setUploadProgress(progress);
            },
            reject,
            resolve,
          );
        });
        fileStored = true;
        setReportUploaded(true);
        setUploadProgress(100);
      }

      setUploadPhase("linking");
      const idToken = await user.getIdToken();
      const response = await fetch("/api/labs/finalize-report", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          labOrderId: resultOrder.id,
          stagedStoragePath: reportDraft.storagePath,
          fileName: reportDraft.fileName,
          contentType: reportDraft.accepted.contentType,
          size: reportDraft.file.size,
          sourceProvider: isAyusImport ? "ayuslab" : "manual",
          externalLinkVersion: isAyusImport ? externalLinkVersion : null,
          resultSummary: summary,
        }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        if (response.status === 409 && /already attached/iu.test(result.error || "")) {
          setResultOrder(null);
          resetResultWorkflow();
          setNotice("A report is already attached to this order. The existing immutable report was kept.");
          if (profile.role !== "admin") setDirectoryRefresh((value) => value + 1);
          return;
        }
        const responseMessage = result.error || "The verified report could not be attached to the patient chart.";
        if (finalizationNeedsAdministrator(response.status, responseMessage)) {
          setAdministratorRecoveryNeeded(true);
        }
        throw new Error(responseMessage);
      }
      setResultOrder(null);
      resetResultWorkflow();
      setNotice(isReception
        ? "The received report was attached securely to the laboratory order."
        : "Lab result saved securely in the patient record.");
      if (profile.role !== "admin") setDirectoryRefresh((value) => value + 1);
    } catch (resultError) {
      if (fileStored) {
        setReportUploaded(true);
        setUploadProgress(100);
        setError(resultError instanceof Error
          ? `${resultError.message} The staged file was retained; choose Finish linking report to retry without uploading again.`
          : "The staged file is secure, but final verification was interrupted. Choose Finish linking report to retry without uploading again.");
      } else {
        setError(reportStorageErrorMessage(resultError, "upload"));
      }
    } finally {
      uploadTaskRef.current = null;
      setUploadPhase("idle");
    }
  }

  async function accessReport(order: LabOrder, action: "preview" | "download" | "print") {
    if (!hasAttachedReport(order) || !canReadReports) return;
    if (!patientDirectoryAvailable || !patients.some((patient) => patient.id === order.patientId)) {
      setError("This report is no longer linked to an available active patient.");
      return;
    }
    const preview = action === "preview" || action === "print" ? openPendingReportWindow() : null;
    if ((action === "preview" || action === "print") && !preview) {
      setError("Your browser blocked the secure preview. Allow pop-ups for Asher Healthcare or use the patient record download option.");
      return;
    }
    setReportAction({ orderId: order.id, action });
    setError("");
    try {
      const idToken = await user.getIdToken();
      const reportResponse = await fetch("/api/labs/report-access", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ labOrderId: order.id, action }),
      });
      if (!reportResponse.ok) {
        const reportError = await reportResponse.json().catch(() => ({})) as { error?: string };
        preview?.close();
        setError(reportError.error || "Report access could not be authorized. Please try again.");
        return;
      }
      const blob = await reportResponse.blob();
      if (action === "download") {
        downloadReportBlob(blob, genericReportDownloadName(blob, "lab-report"));
      } else if (preview) {
        const url = URL.createObjectURL(blob);
        if (action === "print") {
          preview.addEventListener("load", () => {
            try { preview.print(); } catch { /* Browser PDF viewers may require the user to press Print. */ }
          }, { once: true });
        }
        preview.location.href = url;
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    } catch (reportError) {
      preview?.close();
      setError(reportStorageErrorMessage(reportError, "open"));
    } finally {
      setReportAction(null);
    }
  }

  function reportFilePicker(guided = false) {
    return (
      <section className="mt-5" aria-labelledby="report-file-heading">
        <h3 id="report-file-heading" className={labelClass}>{guided ? "Choose the downloaded final report" : "Report PDF or image"}</h3>
        <input ref={chooseFileRef} type="file" accept={REPORT_FILE_ACCEPT} onChange={(event) => void selectReportFile(event.target.files?.[0])} className="sr-only" tabIndex={-1} />
        <input ref={cameraFileRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => void selectReportFile(event.target.files?.[0])} className="sr-only" tabIndex={-1} />
        {!reportDraft ? <div className="mt-2 grid grid-cols-1 gap-2 rounded-2xl border border-dashed border-slate-300 p-3 sm:grid-cols-2">
          <button type="button" disabled={resultBusy} onClick={() => chooseFileRef.current?.click()} className="inline-flex min-h-14 items-center justify-center gap-2 rounded-xl bg-[#233A59] px-3 text-sm font-bold text-white disabled:opacity-50"><FileUp size={19} /> {guided ? "Choose downloaded PDF" : "Choose file"}</button>
          <button type="button" disabled={resultBusy} onClick={() => cameraFileRef.current?.click()} className="inline-flex min-h-14 items-center justify-center gap-2 rounded-xl bg-blue-50 px-3 text-sm font-bold text-blue-900 disabled:opacity-50"><Camera size={19} /> Scan with camera</button>
          <p className="px-1 text-xs leading-5 text-slate-500 sm:col-span-2">Genuine PDF, JPEG, PNG, or WebP only. The file must be under 10 MB. PDF is preferred for a final laboratory report.</p>
        </div> : <div className="mt-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex items-start gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white text-emerald-700"><FileCheck2 size={21} /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-emerald-950">Selected report file</p><p className="mt-1 text-xs text-emerald-800">{reportDraft.accepted.contentType} · {formatReportFileSize(reportDraft.file.size)}</p></div><button type="button" disabled={resultBusy || reportUploaded} onClick={removeReportDraft} aria-label="Remove selected report" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white text-rose-700 ring-1 ring-emerald-200 disabled:opacity-40"><Trash2 size={18} /></button></div>
          {(uploadPhase === "uploading" || uploadPhase === "linking" || reportUploaded) && <div className="mt-4" aria-live="polite"><div className="flex justify-between text-xs font-bold text-emerald-900"><span>{uploadPhase === "linking" || reportUploaded ? "Saving to patient chart" : "Uploading securely"}</span><span>{uploadProgress}%</span></div><div role="progressbar" aria-label="Secure report upload" aria-valuemin={0} aria-valuemax={100} aria-valuenow={uploadProgress} className="mt-2 h-2 overflow-hidden rounded-full bg-emerald-100"><div className="h-full rounded-full bg-emerald-600 transition-[width]" style={{ width: `${uploadProgress}%` }} /></div></div>}
        </div>}
        {uploadPhase === "checking" && <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-slate-600" aria-live="polite"><LoaderCircle className="animate-spin" size={16} /> Checking the selected file…</p>}
      </section>
    );
  }

  return (
    <div>
      <div className="staff-page-heading flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#A8864A]">Laboratory workflow</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-[#233A59] sm:text-4xl">Lab orders & results</h1>
          <p className="mt-3 text-slate-600">Track samples, test status, results, and secure reports from one desk.</p>
        </div>
        <button type="button" disabled={!patientDirectoryAvailable} onClick={() => { setError(""); setShowCreate(true); }} className="inline-flex items-center gap-2 rounded-xl bg-[#233A59] px-5 py-3 text-sm font-bold text-white shadow-lg shadow-[#233A59]/15 disabled:cursor-not-allowed disabled:opacity-50">
          <Plus size={18} /> New lab order
        </button>
      </div>

      {notice && <p className="mt-5 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{notice}</p>}
      {error && <p className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p>}

      <section className="mt-6 overflow-hidden rounded-[1.5rem] border border-blue-200 bg-gradient-to-br from-blue-950 to-[#233A59] p-5 text-white shadow-sm sm:p-6" aria-labelledby="partner-lab-heading">
        <div className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-blue-100">Partner laboratory</span>
            <span className="rounded-full bg-amber-300/15 px-2.5 py-1 text-xs font-bold text-amber-100">Secure manual import</span>
          </div>
          <h2 id="partner-lab-heading" className="mt-3 text-xl font-bold">{AYUSLAB_PROVIDER.displayName} reports</h2>
          <p className="mt-2 text-sm leading-6 text-blue-100">Start from the matching laboratory order below. Asher will guide you through confirming the patient, opening the official portal, choosing the final report, and attaching it securely.</p>
        </div>
        <ol className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Secure manual import steps">
          {["Confirm order", "Open AyusLab", "Choose report", "Verify & attach"].map((label, index) => (
            <li key={label} className="rounded-xl bg-white/10 px-3 py-3 text-xs font-bold text-blue-50"><span className="mr-1 text-amber-200">{index + 1}.</span> {label}</li>
          ))}
        </ol>
        <p className="mt-4 border-t border-white/10 pt-4 text-xs leading-5 text-blue-100">AyusLab credentials stay only with AyusLab. Asher never adds a patient name, phone number, report identifier, or password to the portal link.</p>
      </section>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className={cardClass}><p className="text-sm font-semibold text-slate-500">Active orders</p><p className="mt-2 text-3xl font-bold text-[#233A59]">{stats.active}</p></div>
        <div className={cardClass}><p className="text-sm font-semibold text-slate-500">Urgent</p><p className="mt-2 text-3xl font-bold text-rose-600">{stats.urgent}</p></div>
        <div className={cardClass}><p className="text-sm font-semibold text-slate-500">Completed</p><p className="mt-2 text-3xl font-bold text-emerald-600">{stats.completed}</p></div>
      </div>

      <div className={cardClass + " mt-6"}>
        <div className="flex flex-col gap-3 sm:flex-row">
          <label className="relative flex-1">
            <Search className="absolute left-3 top-3.5 text-slate-400" size={18} />
            <input value={search} onChange={(event) => { setSearch(event.target.value); setVisibleOrderCount(INITIAL_VISIBLE_ORDERS); }} placeholder="Search order, patient, phone, or test" className="w-full rounded-xl border border-slate-200 py-3 pl-10 pr-4 text-sm outline-none focus:border-[#A8864A]" />
          </label>
          <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value as "all" | LabStatus); setVisibleOrderCount(INITIAL_VISIBLE_ORDERS); }} className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700">
            <option value="all">All statuses</option>
            {statusOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <select value={priorityFilter} onChange={(event) => { setPriorityFilter(event.target.value as "all" | LabOrder["priority"]); setVisibleOrderCount(INITIAL_VISIBLE_ORDERS); }} className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700">
            <option value="all">All priorities</option>
            <option value="routine">Routine</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>
      </div>

      <div className="performance-list mt-5 space-y-4">
        {loading && <div className={cardClass + " flex items-center gap-3 text-slate-600"}><LoaderCircle className="animate-spin" size={20} /> Loading lab orders…</div>}
        {!loading && filteredOrders.length === 0 && <div className={cardClass + " py-12 text-center"}><FlaskConical className="mx-auto text-slate-300" size={42} /><p className="mt-4 font-semibold text-slate-600">No laboratory orders found.</p></div>}
        {visibleOrders.map((order) => (
          <article key={order.id} className={cardClass + " [content-visibility:auto] [contain-intrinsic-size:0_260px]"}>
            <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-[#233A59]">{order.orderNumber}</span>
                  <span className={"rounded-full px-2.5 py-1 text-xs font-bold " + statusStyles[order.status]}>{statusOptions.find((item) => item.value === order.status)?.label}</span>
                  {order.priority === "urgent" && <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-700">Urgent</span>}
                </div>
                <h2 className="mt-3 text-xl font-bold text-slate-900">{order.patientName}</h2>
                <p className="mt-1 text-sm text-slate-500">{order.patientNumber || "Patient"} · {order.patientPhone} · {dateTime(order.orderedAt)}</p>
                <div className="mt-4 flex flex-wrap gap-2">{order.tests.map((test) => <span key={test} className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-700">{test}</span>)}</div>
                {!isReception && order.resultSummary && <p className="mt-4 line-clamp-3 rounded-xl bg-emerald-50 p-3 text-sm leading-6 text-emerald-900"><strong>Result:</strong> {order.resultSummary}</p>}
              </div>
              <div className="grid min-w-52 grid-cols-2 gap-2">
                <select value={order.status} disabled={statusBusyOrderId === order.id || availableStatusTransitions(order.status, isReception).length === 0} onChange={(event) => void changeStatus(order, event.target.value as LabStatus)} className="col-span-2 min-h-11 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 disabled:bg-slate-50 disabled:text-slate-500">
                  {[order.status, ...availableStatusTransitions(order.status, isReception)].map((status) => <option key={status} value={status}>{statusOptions.find((item) => item.value === status)?.label}</option>)}
                </select>
                {statusBusyOrderId === order.id && <p className="col-span-2 flex items-center justify-center gap-2 py-1 text-xs font-semibold text-slate-500"><LoaderCircle className="animate-spin" size={14} /> Updating status…</p>}
                {canUsePartnerPortal && order.status !== "cancelled" && !hasAttachedReport(order) && <button type="button" onClick={() => openResultWorkflow(order, "ayuslab")} className="col-span-2 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#233A59] px-4 py-3 text-sm font-bold text-white"><ExternalLink size={17} /> Import from AyusLab</button>}
                {isReception && order.status !== "cancelled" && !hasAttachedReport(order) && <button type="button" onClick={() => openResultWorkflow(order)} className="col-span-2 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-[#233A59]"><TestTube2 size={17} /> {canUsePartnerPortal ? "Attach file without portal" : "Attach received report"}</button>}
                {!isReception && order.status !== "cancelled" && <button type="button" onClick={() => openResultWorkflow(order)} className="col-span-2 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-[#233A59]"><TestTube2 size={17} /> {order.status === "completed" ? "Edit result" : "Record result"}</button>}
                {hasAttachedReport(order) && isReception && <p className="col-span-2 flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-50 px-3 text-xs font-bold text-emerald-800"><FileCheck2 size={16} /> Report attached securely</p>}
                {hasAttachedReport(order) && canReadReports && <>
                  <button type="button" disabled={reportAction !== null} onClick={() => void accessReport(order, "preview")} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold text-[#233A59] disabled:opacity-60">{reportAction?.orderId === order.id && reportAction.action === "preview" ? <LoaderCircle className="animate-spin" size={17} /> : <Eye size={17} />} Preview</button>
                  <button type="button" disabled={reportAction !== null} onClick={() => void accessReport(order, "download")} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold text-[#233A59] disabled:opacity-60">{reportAction?.orderId === order.id && reportAction.action === "download" ? <LoaderCircle className="animate-spin" size={17} /> : <Download size={17} />} Download</button>
                  <button type="button" disabled={reportAction !== null} onClick={() => void accessReport(order, "print")} className="col-span-2 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold text-[#233A59] disabled:opacity-60">{reportAction?.orderId === order.id && reportAction.action === "print" ? <LoaderCircle className="animate-spin" size={17} /> : <Printer size={17} />} Print report</button>
                </>}
              </div>
            </div>
          </article>
        ))}
        {visibleOrders.length < filteredOrders.length && <button type="button" onClick={() => setVisibleOrderCount((count) => count + INITIAL_VISIBLE_ORDERS)} className="mx-auto flex min-h-12 items-center justify-center rounded-2xl border border-slate-200 bg-white px-6 text-sm font-bold text-[#233A59] shadow-sm">Load 30 more · {filteredOrders.length - visibleOrders.length} remaining</button>}
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/45 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <form onSubmit={createOrder} className="max-h-[100dvh] w-full max-w-3xl overflow-y-auto rounded-t-[2rem] bg-white p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-2xl sm:max-h-[92vh] sm:rounded-[2rem] sm:p-8">
            <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-widest text-[#A8864A]">New request</p><h2 className="mt-1 text-2xl font-bold text-[#233A59]">Create lab order</h2></div><button type="button" onClick={() => setShowCreate(false)} aria-label="Close"><X size={22} /></button></div>
            {error && <p aria-live="assertive" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p>}
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className={labelClass} htmlFor="lab-patient-search">Registered patient</label>
                {selectedOrderPatient ? (
                  <div className="mt-2 flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                    <div className="min-w-0"><p className="truncate text-sm font-bold text-emerald-950">{selectedOrderPatient.fullName}</p><p className="mt-0.5 text-xs text-emerald-800">{selectedOrderPatient.patientNumber || "Patient"} · {selectedOrderPatient.phone}</p></div>
                    <button type="button" onClick={() => { setPatientId(""); setPatientSearch(""); }} className="shrink-0 rounded-lg bg-white px-3 py-2 text-xs font-bold text-emerald-900 ring-1 ring-emerald-200">Change</button>
                  </div>
                ) : (
                  <>
                    <input id="lab-patient-search" value={patientSearch} onChange={(event) => setPatientSearch(event.target.value)} autoComplete="off" placeholder="Search name, phone, or patient ID" className={fieldClass} />
                    <div className="mt-2 max-h-52 space-y-1 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1">
                      {patientMatches.map((patient) => <button type="button" key={patient.id} onClick={() => { setPatientId(patient.id); setPatientSearch(""); }} className="flex min-h-12 w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-slate-50 focus:bg-slate-50"><span className="min-w-0"><span className="block truncate text-sm font-bold text-slate-800">{patient.fullName}</span><span className="block text-xs text-slate-500">{patient.patientNumber || "Patient"} · {patient.phone}</span></span><span className="text-xs font-bold text-[#A8864A]">Select</span></button>)}
                      {patientMatches.length === 0 && <p className="px-3 py-4 text-center text-sm text-slate-500">No active patient found.</p>}
                    </div>
                  </>
                )}
              </div>
              <label className={labelClass}>Priority<select name="priority" className={fieldClass}><option value="routine">Routine</option><option value="urgent">Urgent</option></select></label>
              <label className={labelClass}>Ordering clinician{profile.role === "doctor" ? <input name="clinician" value={profile.doctorName ?? ""} readOnly required className={fieldClass + " cursor-not-allowed bg-slate-100 text-slate-700"} /> : <select name="clinician" required defaultValue="" className={fieldClass}><option value="" disabled>Select doctor</option>{DOCTORS.map((doctor) => <option key={doctor.id} value={doctor.name}>{doctor.label}</option>)}</select>}</label>
              <fieldset className="sm:col-span-2"><legend className={labelClass}>Tests</legend><div className="mt-3 grid gap-2 sm:grid-cols-2">{commonTests.map((test) => <label key={test} className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 p-3 text-sm font-medium text-slate-700"><input type="checkbox" checked={selectedTests.includes(test)} onChange={() => toggleTest(test)} className="h-4 w-4 accent-[#233A59]" />{test}</label>)}</div></fieldset>
              <div className="flex gap-2 sm:col-span-2"><input value={customTest} onChange={(event) => setCustomTest(event.target.value)} placeholder="Add another test" className={fieldClass + " mt-0"} /><button type="button" onClick={addCustomTest} className="rounded-xl border border-slate-200 px-4 text-sm font-bold">Add</button></div>
              {selectedTests.length > 0 && <div className="flex flex-wrap gap-2 sm:col-span-2">{selectedTests.map((test) => <button type="button" key={test} onClick={() => toggleTest(test)} className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-800">{test} ×</button>)}</div>}
              <label className={labelClass + " sm:col-span-2"}>Clinical notes<textarea name="notes" rows={3} className={fieldClass} /></label>
            </div>
            <div className="sticky bottom-0 -mx-6 mt-6 flex justify-end gap-3 border-t border-slate-100 bg-white/95 px-6 pb-[env(safe-area-inset-bottom)] pt-4 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:pb-0 sm:pt-0"><button type="button" onClick={() => setShowCreate(false)} className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-bold">Cancel</button><button disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-[#233A59] px-5 py-3 text-sm font-bold text-white disabled:opacity-60">{saving ? <LoaderCircle className="animate-spin" size={18} /> : <FlaskConical size={18} />} Create order</button></div>
          </form>
        </div>
      )}

      {resultOrder && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/45 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <form onSubmit={saveResult} role="dialog" aria-modal="true" aria-labelledby="lab-result-heading" className="max-h-[100dvh] w-full max-w-xl overscroll-contain overflow-y-auto rounded-t-[2rem] bg-white p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-2xl sm:max-h-[92vh] sm:rounded-[2rem] sm:p-8">
            <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-widest text-[#A8864A]">{isAyusImport ? "Secure manual import" : resultOrder.orderNumber}</p><h2 id="lab-result-heading" className="mt-1 text-2xl font-bold text-[#233A59]">{isAyusImport ? `Import from ${AYUSLAB_PROVIDER.displayName}` : isReception ? "Attach received report" : "Record lab result"}</h2><p className="mt-1 text-sm text-slate-500">{resultOrder.patientName} · {resultOrder.patientNumber || "Patient"}</p></div><button type="button" disabled={resultBusy || reportUploaded} onClick={closeResultWorkflow} aria-label="Close" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-slate-600 disabled:opacity-40"><X size={22} /></button></div>
            {error && <p aria-live="assertive" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p>}
            {isAyusImport ? <>
              {!isReception && <input type="hidden" name="resultSummary" value={resultOrder.resultSummary ?? ""} readOnly />}
              <ol className="mt-5 grid grid-cols-4 gap-1.5" aria-label="AyusLab import progress">
                {["Order", "AyusLab", "Report", "Verify"].map((label, index) => {
                  const step = (index + 1) as AyusImportStep;
                  const active = step === ayusImportStep;
                  const complete = step < ayusImportStep;
                  return <li key={label} aria-current={active ? "step" : undefined} className={`rounded-xl px-1.5 py-2 text-center text-[10px] font-bold sm:text-xs ${active ? "bg-[#233A59] text-white" : complete ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-500"}`}><span className="block text-xs sm:inline">{complete ? "✓" : step}</span><span className="mt-0.5 block sm:ml-1 sm:inline">{label}</span></li>;
                })}
              </ol>

              {ayusImportStep === 1 && <section className="mt-5" aria-labelledby="confirm-order-heading">
                <h3 id="confirm-order-heading" className="text-lg font-bold text-[#233A59]">Confirm the matching order</h3>
                <p className="mt-1 text-sm leading-6 text-slate-600">Use these details only to locate the same patient and final report inside AyusLab.</p>
                <dl className="mt-4 grid grid-cols-2 gap-3 rounded-2xl bg-slate-50 p-4 text-sm">
                  <div className="col-span-2"><dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Patient</dt><dd className="mt-1 font-bold text-slate-900">{resultOrder.patientName}</dd></div>
                  <div><dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Patient ID</dt><dd className="mt-1 font-semibold text-slate-800">{resultOrder.patientNumber || "Not assigned"}</dd></div>
                  <div><dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Phone</dt><dd className="mt-1 font-semibold text-slate-800">{maskedPhone(resultOrder.patientPhone)}</dd></div>
                  <div><dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Order</dt><dd className="mt-1 font-semibold text-slate-800">{resultOrder.orderNumber}</dd></div>
                  <div><dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Doctor</dt><dd className="mt-1 font-semibold text-slate-800">{resultOrder.clinician}</dd></div>
                  <div className="col-span-2 rounded-xl bg-white p-3 ring-1 ring-slate-200"><dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Order date & time</dt><dd className="mt-1 font-bold text-[#233A59]">{dateTime(resultOrder.orderedAt)}</dd></div>
                </dl>
                <div className="mt-3 flex flex-wrap gap-2">{resultOrder.tests.map((test) => <span key={test} className="rounded-lg bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-900">{test}</span>)}</div>
              </section>}

              {ayusImportStep === 2 && <section className="mt-5" aria-labelledby="open-ayus-heading">
                <h3 id="open-ayus-heading" className="text-lg font-bold text-[#233A59]">Open the official AyusLab portal</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">Sign in with the clinic&apos;s AyusLab account. Search by patient name, then compare the report date and prescribed tests. In the <strong>Reg / Lab no</strong> column, copy the Lab No shown after the slash and download only the final report PDF.</p>
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><p className="text-xs font-bold uppercase tracking-wide text-amber-800">Match this clinic order</p><p className="mt-1 font-bold">{resultOrder.patientName} · {dateTime(resultOrder.orderedAt)}</p><p className="mt-1 text-xs leading-5">Tests: {resultOrder.tests.join(", ")}</p></div>
                <a href={AYUSLAB_PROVIDER.portalReportsUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className="mt-5 inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-[#233A59] px-4 text-sm font-bold text-white">Open AyusLab reports <ExternalLink size={18} /></a>
                <label className={labelClass + " mt-5 block"} htmlFor="ayus-lab-number">
                  Ayus Lab No
                  <input
                    id="ayus-lab-number"
                    value={ayusLabNumber}
                    onChange={(event) => setAyusLabNumber(event.target.value.toUpperCase())}
                    maxLength={64}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="Enter exactly as shown in AyusLab"
                    className={fieldClass}
                  />
                </label>
                <p className="mt-2 text-xs leading-5 text-slate-500">The Lab No—not the patient name or phone—is used to prevent duplicate or mismatched imports.</p>
                <div className="mt-4 rounded-xl bg-blue-50 p-4 text-xs leading-5 text-blue-900"><strong>Privacy:</strong> this fixed link contains no patient name, phone number, report identifier, password, or Asher login data. Return to Asher after the file downloads.</div>
              </section>}

              {ayusImportStep === 3 && <section aria-labelledby="choose-ayus-report-heading">
                <h3 id="choose-ayus-report-heading" className="sr-only">Choose the downloaded report</h3>
                {reportFilePicker(true)}
                <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">Choose the final approved report—not a payment receipt, sample label, draft, or another patient&apos;s file.</p>
              </section>}

              {ayusImportStep === 4 && <section className="mt-5" aria-labelledby="verify-report-heading">
                <h3 id="verify-report-heading" className="text-lg font-bold text-[#233A59]">Verify before attaching</h3>
                <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">Selected final report</p>
                  <p className="mt-1 truncate text-sm font-bold text-emerald-950">Selected report file</p>
                  <p className="mt-1 text-xs text-emerald-800">{reportDraft ? `${reportDraft.accepted.contentType} · ${formatReportFileSize(reportDraft.file.size)}` : "No report selected"}</p>
                  <p className="mt-2 text-xs font-semibold text-emerald-900">Order date: {dateTime(resultOrder.orderedAt)}</p>
                  {reportDraft && <button type="button" disabled={resultBusy} onClick={previewSelectedReport} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-white px-3 text-sm font-bold text-[#233A59] ring-1 ring-emerald-200 disabled:opacity-50"><Eye size={17} /> {ayusReportPreviewed ? "Preview again locally" : "Preview selected file locally"}</button>}
                  {(uploadPhase === "uploading" || uploadPhase === "linking" || reportUploaded) && <div className="mt-4" aria-live="polite"><div className="flex justify-between text-xs font-bold text-emerald-900"><span>{uploadPhase === "linking" || reportUploaded ? "Saving to patient chart" : "Uploading securely"}</span><span>{uploadProgress}%</span></div><div role="progressbar" aria-label="Secure report upload" aria-valuemin={0} aria-valuemax={100} aria-valuenow={uploadProgress} className="mt-2 h-2 overflow-hidden rounded-full bg-emerald-100"><div className="h-full rounded-full bg-emerald-600 transition-[width]" style={{ width: `${uploadProgress}%` }} /></div></div>}
                </div>
                {!ayusReportPreviewed && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs font-semibold leading-5 text-amber-900">Preview the selected file locally before confirming the patient match.</p>}
                <label className={`mt-4 flex items-start gap-3 rounded-2xl border border-slate-200 p-4 text-sm leading-6 text-slate-700 ${ayusReportPreviewed ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}><input type="checkbox" checked={ayusReportVerified} onChange={(event) => setAyusReportVerified(event.target.checked)} disabled={resultBusy || reportUploaded || !ayusReportPreviewed} className="mt-1 h-5 w-5 shrink-0 accent-[#233A59]" /><span>I verified that this final report and Ayus Lab No <strong>{ayusLabNumber.trim()}</strong> belong to <strong>{resultOrder.patientName}</strong>, patient ID <strong>{resultOrder.patientNumber || "not assigned"}</strong>, and laboratory order <strong>{resultOrder.orderNumber}</strong>.</span></label>
                <p className="mt-3 text-xs leading-5 text-slate-500">After Asher confirms the attachment, remove the downloaded copy from shared devices and their recycle bin according to clinic policy.</p>
              </section>}
            </> : <>
              {!isReception && <label className={labelClass + " mt-6 block"}>Result summary<textarea name="resultSummary" defaultValue={resultOrder.resultSummary ?? ""} rows={5} maxLength={5000} placeholder="Key findings, values, or interpretation" className={fieldClass} /></label>}
              {isReception && <div className="mt-5 rounded-xl bg-blue-50 p-4 text-sm leading-6 text-blue-900"><strong>Front-desk intake:</strong> attach the received file to this order. Clinical summaries and report viewing remain available only to the doctor and administrator.</div>}
              {hasAttachedReport(resultOrder) ? (
                <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-900">
                  <p className="font-bold">Secure report already attached</p>
                  <p className="mt-1">The stored file is immutable. You can update the result summary without replacing the original report.</p>
                  {canReadReports && <div className="mt-3 grid grid-cols-2 gap-2"><button type="button" disabled={reportAction !== null} onClick={() => void accessReport(resultOrder, "preview")} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white px-3 font-bold ring-1 ring-emerald-200 disabled:opacity-60">{reportAction?.orderId === resultOrder.id && reportAction.action === "preview" ? <LoaderCircle className="animate-spin" size={17} /> : <Eye size={17} />} Preview</button><button type="button" disabled={reportAction !== null} onClick={() => void accessReport(resultOrder, "download")} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white px-3 font-bold ring-1 ring-emerald-200 disabled:opacity-60">{reportAction?.orderId === resultOrder.id && reportAction.action === "download" ? <LoaderCircle className="animate-spin" size={17} /> : <Download size={17} />} Download</button><button type="button" disabled={reportAction !== null} onClick={() => void accessReport(resultOrder, "print")} className="col-span-2 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white px-3 font-bold ring-1 ring-emerald-200 disabled:opacity-60">{reportAction?.orderId === resultOrder.id && reportAction.action === "print" ? <LoaderCircle className="animate-spin" size={17} /> : <Printer size={17} />} Print report</button></div>}
                </div>
              ) : reportFilePicker()}
            </>}
            <div className="sticky bottom-0 -mx-6 mt-6 grid grid-cols-2 gap-3 border-t border-slate-100 bg-white/95 px-6 pb-[env(safe-area-inset-bottom)] pt-4 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:pb-0 sm:pt-0">
              {isAyusImport ? <>
                {uploadPhase === "uploading" ? <button type="button" onClick={cancelUpload} className="min-h-12 rounded-xl border border-rose-200 px-4 text-sm font-bold text-rose-700">Cancel upload</button> : ayusImportStep === 1 ? <button type="button" disabled={resultBusy || reportUploaded} onClick={closeResultWorkflow} className="min-h-12 rounded-xl border border-slate-200 px-4 text-sm font-bold disabled:opacity-40">Cancel</button> : <button type="button" disabled={resultBusy || reportUploaded} onClick={() => { setError(""); setAyusImportStep((ayusImportStep - 1) as AyusImportStep); }} className="min-h-12 rounded-xl border border-slate-200 px-4 text-sm font-bold disabled:opacity-40">Back</button>}
                {ayusImportStep === 1 && <button type="button" disabled={ayusLinkBusy} onClick={() => { setError(""); setAyusImportStep(2); }} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#233A59] px-4 text-sm font-bold text-white disabled:opacity-50">{ayusLinkBusy && <LoaderCircle className="animate-spin" size={17} />} {ayusLinkBusy ? "Checking Lab No…" : "Confirm order"}</button>}
                {ayusImportStep === 2 && <button type="button" disabled={ayusLabNumber.trim().length < 2} onClick={() => { setError(""); setAyusImportStep(3); }} className="min-h-12 rounded-xl bg-[#233A59] px-4 text-sm font-bold text-white disabled:opacity-50">Lab No entered</button>}
                {ayusImportStep === 3 && <button type="button" disabled={resultBusy || !reportDraft} onClick={() => { setError(""); setAyusReportVerified(false); setAyusImportStep(4); }} className="min-h-12 rounded-xl bg-[#233A59] px-4 text-sm font-bold text-white disabled:opacity-50">Continue to verify</button>}
                {ayusImportStep === 4 && <button type="submit" disabled={resultBusy || !reportDraft || !ayusReportVerified || ayusLabNumber.trim().length < 2} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white disabled:opacity-60">{resultBusy ? <LoaderCircle className="animate-spin" size={18} /> : <CheckCircle2 size={18} />} {ayusLinkBusy ? "Securing Lab No…" : uploadPhase === "uploading" ? `Uploading ${uploadProgress}%` : uploadPhase === "linking" ? "Linking report…" : reportUploaded ? "Finish linking" : "Verify & attach"}</button>}
                {administratorRecoveryNeeded && reportUploaded && <button type="button" disabled={resultBusy} onClick={leaveForAdministratorRecovery} className="col-span-2 min-h-12 rounded-xl border border-amber-300 bg-amber-50 px-4 text-sm font-bold text-amber-950 disabled:opacity-50">Leave safely for administrator review</button>}
              </> : <>
                {uploadPhase === "uploading" ? <button type="button" onClick={cancelUpload} className="min-h-12 rounded-xl border border-rose-200 px-4 text-sm font-bold text-rose-700">Cancel upload</button> : <button type="button" disabled={uploadPhase === "linking" || reportUploaded} onClick={closeResultWorkflow} className="min-h-12 rounded-xl border border-slate-200 px-4 text-sm font-bold disabled:opacity-40">Cancel</button>}
                <button type="submit" disabled={resultBusy || (isReception && !hasAttachedReport(resultOrder) && !reportDraft)} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white disabled:opacity-60">{resultBusy ? <LoaderCircle className="animate-spin" size={18} /> : <CheckCircle2 size={18} />} {uploadPhase === "uploading" ? `Uploading ${uploadProgress}%` : uploadPhase === "linking" ? "Linking report…" : reportUploaded ? "Finish linking report" : isReception ? "Attach report" : "Save result"}</button>
                {administratorRecoveryNeeded && reportUploaded && <button type="button" disabled={resultBusy} onClick={leaveForAdministratorRecovery} className="col-span-2 min-h-12 rounded-xl border border-amber-300 bg-amber-50 px-4 text-sm font-bold text-amber-950 disabled:opacity-50">Leave safely for administrator review</button>}
              </>}
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export default function LabPage() {
  return <LabDesk />;
}
