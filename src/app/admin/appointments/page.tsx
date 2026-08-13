"use client";

import { useStaff } from "@/components/admin/StaffGuard";
import { firebaseAuth, firestore } from "@/firebase/config";
import { useAppointmentSchedule } from "@/hooks/useAppointmentSchedule";
import {
  ADMIN_NAVIGATION_HANDOFF_EVENT,
  consumeAdminNavigationHandoff,
  stageAdminNavigationHandoff,
} from "@/lib/admin-navigation-handoff";
import { fetchPatientDirectory } from "@/lib/patient-directory";
import {
  clinicDate,
  dateIsEnabled,
  doctorName,
  DOCTORS,
  formatAppointmentTime,
  generateTimeSlots,
  nextEnabledDate,
  scheduleSummary,
  type DoctorId,
} from "@/lib/appointments";
import {
  APPOINTMENT_STATUS_OPTIONS,
  appointmentStatusLabel,
  appointmentStatusTimestampField,
  appointmentStatusTone,
  appointmentTransitionOptions,
  queueTokenLabel,
  type AppointmentStatus,
} from "@/lib/visit-workflow";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
  type Timestamp,
} from "firebase/firestore";
import {
  CalendarCheck2,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Filter,
  Hash,
  LoaderCircle,
  LogIn,
  MessageCircle,
  Phone,
  Play,
  Plus,
  Save,
  Search,
  Stethoscope,
  UserRound,
  UserX,
  XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

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
  slotId?: string;
  createdAt?: Timestamp;
  checkedInAt?: Timestamp;
  waitingAt?: Timestamp;
  consultationStartedAt?: Timestamp;
  completedAt?: Timestamp;
  noShowAt?: Timestamp;
};

type StatusFilter = "all" | AppointmentStatus;
type BookingSource = "reception" | "phone" | "walk-in";
type BookingForm = {
  patientId: string;
  patientName: string;
  phone: string;
  doctorId: DoctorId;
  preferredDate: string;
  preferredTime: string;
  reason: string;
  source: BookingSource;
};

const doctorNames: Record<string, string> = {
  pediatrics: "Dr. Lt Col Shafi Ahamad",
  obg: "Dr. Shaik Reshma",
};

const FRONT_DESK_STATUSES = new Set<AppointmentStatus>([
  "confirmed",
  "checked_in",
  "waiting",
  "no_show",
  "cancelled",
]);

function assignedDoctorId(doctorNameValue?: string): DoctorId | null {
  return DOCTORS.find((doctor) => doctor.name === doctorNameValue)?.id ?? null;
}

const emptyBooking = (date: string, time = "17:00"): BookingForm => ({
  patientId: "",
  patientName: "",
  phone: "",
  doctorId: "pediatrics",
  preferredDate: date,
  preferredTime: time,
  reason: "",
  source: "reception",
});

const inputClass = "h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-[#233A59] focus:ring-2 focus:ring-[#233A59]/10";

function prettyDate(value: string) {
  if (!value) return "Date not set";
  const parsed = new Date(value + "T00:00:00");
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}

function whatsAppNumber(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 10 ? "91" + digits : digits;
}

function AppointmentDesk() {
  const router = useRouter();
  const { profile } = useStaff();
  const today = clinicDate();
  const { schedule } = useAppointmentSchedule();
  const profileDoctorId = assignedDoctorId(profile.doctorName);
  const [deskItems, setDeskItems] = useState<Appointment[]>([]);
  const [historyItems, setHistoryItems] = useState<Appointment[]>([]);
  const [activePatientIds, setActivePatientIds] = useState<Set<string>>(new Set());
  const [deskLoading, setDeskLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [archiveLoading, setArchiveLoading] = useState(true);
  const [archiveSafetyError, setArchiveSafetyError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [doctorFilter, setDoctorFilter] = useState(
    profile.role === "doctor" && profileDoctorId ? profileDoctorId : "all",
  );
  const [dateFilter, setDateFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [bookingError, setBookingError] = useState("");
  const [booking, setBooking] = useState<BookingForm>(() => emptyBooking(nextEnabledDate(schedule, today)));
  const [availability, setAvailability] = useState<{ key: string; slots: Set<string>; error: boolean }>({
    key: "",
    slots: new Set(),
    error: false,
  });
  const deskDate = dateFilter || today;
  const loading = deskLoading || historyLoading || archiveLoading;
  const allItems = useMemo(() => {
    const merged = new Map<string, Appointment>();
    historyItems.forEach((appointment) => merged.set(appointment.id, appointment));
    deskItems.forEach((appointment) => merged.set(appointment.id, appointment));
    return Array.from(merged.values()).sort((left, right) => {
      const dateDifference = right.preferredDate.localeCompare(left.preferredDate);
      if (dateDifference !== 0) return dateDifference;
      return right.preferredTime.localeCompare(left.preferredTime);
    });
  }, [deskItems, historyItems]);
  const items = useMemo(
    () => allItems.filter((appointment) => (
      !appointment.patientId || activePatientIds.has(appointment.patientId)
    )),
    [activePatientIds, allItems],
  );
  const archivedExcludedCount = allItems.length - items.length;

  const refreshPatientSafety = useCallback(async () => {
    try {
      const user = firebaseAuth?.currentUser;
      if (!user) throw new Error("Staff session missing");
      const directory = await fetchPatientDirectory(user, {
        includeArchived: profile.role === "admin",
      });
      const activeIds = new Set(
        directory.filter((patient) => patient.archived !== true).map((patient) => patient.id),
      );
      setActivePatientIds(activeIds);
      setArchiveSafetyError("");
      return activeIds;
    } catch (directoryError) {
      console.error(directoryError);
      setArchiveSafetyError("Archived patient safeguards could not be loaded. Appointment actions are paused to protect patient records.");
      return null;
    } finally {
      setArchiveLoading(false);
    }
  }, [profile.role]);

  useEffect(() => {
    const openAppointment = () => setShowCreate(true);
    let active = true;
    window.addEventListener("asher:new-appointment", openAppointment);
    const params = new URLSearchParams(window.location.search);
    const requestedStatus = params.get("status");
    const routeTimer = window.setTimeout(() => {
      if (params.get("date") === "today") {
        setDateFilter(today);
      }
      if (APPOINTMENT_STATUS_OPTIONS.some((option) => option.value === requestedStatus)) {
        setStatusFilter(requestedStatus as AppointmentStatus);
      }
      if (params.get("new") === "1") {
        setShowCreate(true);
      }
    }, 0);

    const consumePatientHandoff = () => {
      const handoff = consumeAdminNavigationHandoff("/admin/appointments");
      if (!handoff || handoff.intent !== "create-appointment") return;

      setShowCreate(true);
      const patientId = handoff.patientId;
      const user = firebaseAuth?.currentUser;
      const directoryRequest = user
        ? fetchPatientDirectory(user, { includeArchived: profile.role === "admin" })
        : Promise.reject(new Error("Staff session missing"));
      void directoryRequest
        .then((directory) => {
          if (!active) return;
          const patient = directory.find((entry) => entry.id === patientId);
          if (!patient || patient.archived === true) {
            setBookingError("This patient record is unavailable or archived. An administrator must restore it before a new appointment can be created.");
            setBooking((current) => ({ ...current, patientId: "", patientName: "", phone: "" }));
            return;
          }
          const doctorDescriptor = `${String(patient.doctorName || "")} ${String(patient.specialty || "")}`.toLowerCase();
          const doctorId: DoctorId = /(reshma|obstetric|gyn|obg|women)/.test(doctorDescriptor) ? "obg" : "pediatrics";
          setBooking((current) => ({
            ...current,
            patientId: patient.id,
            patientName: String(patient.fullName || ""),
            phone: String(patient.phone || ""),
            doctorId,
          }));
        })
        .catch(() => {
          if (active) setBookingError("Patient details could not be prefilled. You can still enter them manually.");
        });
    };
    window.addEventListener(ADMIN_NAVIGATION_HANDOFF_EVENT, consumePatientHandoff);
    consumePatientHandoff();

    return () => {
      active = false;
      window.clearTimeout(routeTimer);
      window.removeEventListener("asher:new-appointment", openAppointment);
      window.removeEventListener(ADMIN_NAVIGATION_HANDOFF_EVENT, consumePatientHandoff);
    };
  }, [profile.role, today]);

  const bookingSlots = useMemo(
    () => dateIsEnabled(schedule, booking.preferredDate)
      ? generateTimeSlots(schedule.doctors[booking.doctorId])
      : [],
    [booking.doctorId, booking.preferredDate, schedule],
  );
  const availabilityKey = `${booking.doctorId}_${booking.preferredDate}`;
  const occupiedSlots = useMemo(
    () => availability.key === availabilityKey ? availability.slots : new Set<string>(),
    [availability, availabilityKey],
  );
  const availabilityLoading = Boolean(firestore) && availability.key !== availabilityKey;
  const availabilityError = availability.key === availabilityKey && availability.error;
  const availableBookingSlots = useMemo(
    () => availabilityError ? [] : bookingSlots.filter((slot) => !occupiedSlots.has(slot)),
    [availabilityError, bookingSlots, occupiedSlots],
  );
  const selectedBookingTime = availableBookingSlots.includes(booking.preferredTime)
    ? booking.preferredTime
    : availableBookingSlots[0] ?? "";

  useEffect(() => {
    if (!firestore || !booking.doctorId || !booking.preferredDate) return;
    const slotsQuery = query(
      collection(firestore, "appointmentSlots"),
      where("doctorId", "==", booking.doctorId),
      where("date", "==", booking.preferredDate),
    );
    return onSnapshot(
      slotsQuery,
      (snapshot) => {
        setAvailability({
          key: `${booking.doctorId}_${booking.preferredDate}`,
          slots: new Set(snapshot.docs.map((item) => String(item.data().time || ""))),
          error: false,
        });
      },
      () => {
        setAvailability({
          key: `${booking.doctorId}_${booking.preferredDate}`,
          slots: new Set(),
          error: true,
        });
      },
    );
  }, [booking.doctorId, booking.preferredDate]);

  useEffect(() => {
    if (!firestore) return;
    if (profile.role === "doctor" && !profileDoctorId) {
      const timer = window.setTimeout(() => {
        setDeskItems([]);
        setDeskLoading(false);
        setError("This doctor login is not linked to a clinic doctor. Ask an administrator to update staff access.");
      }, 0);
      return () => window.clearTimeout(timer);
    }
    const deskQuery = profile.role === "doctor"
      ? query(
          collection(firestore, "appointments"),
          where("doctorId", "==", profileDoctorId),
          where("preferredDate", "==", deskDate),
        )
      : query(
          collection(firestore, "appointments"),
          where("preferredDate", "==", deskDate),
          orderBy("preferredDate", "desc"),
        );
    return onSnapshot(
      deskQuery,
      (snapshot) => {
        setDeskItems(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Appointment));
        setDeskLoading(false);
      },
      () => {
        setError("The active clinic desk could not be loaded. Please check staff access and try again.");
        setDeskLoading(false);
      },
    );
  }, [deskDate, profile.role, profileDoctorId]);

  useEffect(() => {
    if (!firestore) return;
    if (profile.role === "doctor" && !profileDoctorId) {
      const timer = window.setTimeout(() => {
        setHistoryItems([]);
        setHistoryLoading(false);
      }, 0);
      return () => window.clearTimeout(timer);
    }
    const historyQuery = profile.role === "doctor"
      ? query(
          collection(firestore, "appointments"),
          where("doctorId", "==", profileDoctorId),
          orderBy("createdAt", "desc"),
          limit(200),
        )
      : query(
          collection(firestore, "appointments"),
          orderBy("createdAt", "desc"),
          limit(200),
        );
    return onSnapshot(
      historyQuery,
      (snapshot) => {
        setHistoryItems(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Appointment));
        setHistoryLoading(false);
      },
      () => {
        setError("Recent appointment history could not be loaded. The live clinic desk remains available.");
        setHistoryLoading(false);
      },
    );
  }, [profile.role, profileDoctorId]);

  useEffect(() => {
    const refresh = () => void refreshPatientSafety();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshPatientSafety]);

  const stats = useMemo(() => ({
    requested: items.filter((item) => item.status === "requested").length,
    today: items.filter((item) => item.preferredDate === today && item.status !== "cancelled").length,
    waiting: items.filter((item) => item.preferredDate === today && ["checked_in", "waiting"].includes(item.status)).length,
    consulting: items.filter((item) => item.preferredDate === today && item.status === "in_consultation").length,
    completed: items.filter((item) => item.preferredDate === today && item.status === "completed").length,
  }), [items, today]);

  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter((item) => {
      const matchesSearch = !term || [item.patientName, item.phone, item.reason, doctorNames[item.doctorId] ?? item.doctorId]
        .some((value) => String(value ?? "").toLowerCase().includes(term));
      const matchesStatus = statusFilter === "all" || item.status === statusFilter;
      const matchesDoctor = doctorFilter === "all" || item.doctorId === doctorFilter;
      const matchesDate = !dateFilter || item.preferredDate === dateFilter;
      return matchesSearch && matchesStatus && matchesDoctor && matchesDate;
    });
  }, [dateFilter, doctorFilter, items, search, statusFilter]);

  function appointmentPatientIsUnavailable(item: Appointment) {
    return Boolean(item.patientId && !activePatientIds.has(item.patientId));
  }

  async function verifyPatientIsActive(patientId?: string) {
    if (!patientId) return;
    const refreshedActiveIds = await refreshPatientSafety();
    if (!refreshedActiveIds) {
      throw new Error("Patient status could not be verified. Appointment actions are paused; please try again.");
    }
    if (!refreshedActiveIds.has(patientId)) {
      throw new Error("This patient record is archived or unavailable. Appointment actions are no longer available.");
    }
  }

  function roleCanManageClinicalAppointment(item: Appointment) {
    return profile.role === "admin"
      || (profile.role === "doctor" && profileDoctorId !== null && item.doctorId === profileDoctorId);
  }

  function canManageClinicalAppointment(item: Appointment) {
    if (archiveLoading || archiveSafetyError || appointmentPatientIsUnavailable(item)) return false;
    return roleCanManageClinicalAppointment(item);
  }

  function roleCanApplyStatus(item: Appointment, status: AppointmentStatus) {
    if (profile.role === "admin") return true;
    if (profile.role === "doctor") return roleCanManageClinicalAppointment(item);
    return item.status !== "in_consultation"
      && item.status !== "completed"
      && FRONT_DESK_STATUSES.has(status);
  }

  function canApplyStatus(item: Appointment, status: AppointmentStatus) {
    if (archiveLoading || archiveSafetyError || appointmentPatientIsUnavailable(item)) return false;
    return roleCanApplyStatus(item, status);
  }

  async function changeStatus(id: string, status: AppointmentStatus) {
    if (!firestore) return false;
    if (
      (status === "cancelled" || status === "no_show")
      && !window.confirm(
        status === "cancelled"
          ? "Cancel this appointment and release its reserved time slot?"
          : "Mark this patient as a no-show?",
      )
    ) {
      return false;
    }
    const database = firestore;
    setUpdatingId(id);
    setError("");
    setNotice("");
    try {
      const item = items.find((appointment) => appointment.id === id);
      if (!item) throw new Error("Appointment not found");
      await verifyPatientIsActive(item.patientId);
      if (item.status === status) return true;
      if (!appointmentTransitionOptions(item.status).includes(status)) {
        throw new Error("Choose the next available step in the visit workflow.");
      }
      if (!roleCanApplyStatus(item, status)) {
        throw new Error(
          profile.role === "doctor"
            ? "This visit is assigned to another doctor. Only an administrator can re-route clinical work."
            : "Reception access is limited to front-desk queue steps.",
        );
      }

      if (status === "checked_in") {
        const counterRef = doc(
          database,
          "queueCounters",
          item.doctorId,
          "days",
          item.preferredDate,
        );
        const existingCounter = await getDoc(counterRef);
        let migrationSeed = 0;
        if (!existingCounter.exists()) {
          const migrationQuery = profile.role === "doctor"
            ? query(
                collection(database, "appointments"),
                where("doctorId", "==", profileDoctorId),
                where("preferredDate", "==", item.preferredDate),
              )
            : query(
                collection(database, "appointments"),
                where("preferredDate", "==", item.preferredDate),
                orderBy("preferredDate", "desc"),
              );
          const dateSnapshot = await getDocs(migrationQuery);
          migrationSeed = dateSnapshot.docs.reduce((maximum, snapshot) => {
            const appointment = snapshot.data() as Partial<Appointment>;
            if (appointment.doctorId !== item.doctorId || !Number.isInteger(appointment.queueToken)) return maximum;
            return Math.max(maximum, Number(appointment.queueToken));
          }, 0);
        }
        const assignedToken = await runTransaction(database, async (transaction) => {
          const appointmentRef = doc(database, "appointments", item.id);
          const latestSnapshot = await transaction.get(appointmentRef);
          const counterSnapshot = await transaction.get(counterRef);
          if (!latestSnapshot.exists()) throw new Error("Appointment not found");
          const latestItem = { id: latestSnapshot.id, ...latestSnapshot.data() } as Appointment;
          if (!appointmentTransitionOptions(latestItem.status).includes(status)) {
            throw new Error("This visit was updated elsewhere. Refresh the desk and try again.");
          }
          const currentCounter = counterSnapshot.exists()
            ? Number(counterSnapshot.data().lastToken || 0)
            : migrationSeed;
          const token = latestItem.queueToken || currentCounter + 1;
          if (!Number.isInteger(token) || token < 1 || token > 999) {
            throw new Error("The daily queue is full. Ask an administrator to open a new queue.");
          }
          const changedAt = serverTimestamp();
          if (!latestItem.queueToken) {
            transaction.set(counterRef, {
              doctorId: latestItem.doctorId,
              date: latestItem.preferredDate,
              lastToken: token,
              appointmentId: latestItem.id,
              updatedAt: changedAt,
            });
          }
          transaction.update(appointmentRef, {
            status,
            queueToken: token,
            checkedInAt: changedAt,
            updatedAt: changedAt,
          });
          return token;
        });
        setNotice(`Patient checked in. Queue token ${queueTokenLabel(assignedToken, item.doctorId)} is ready.`);
        return true;
      }

      const changedAt = serverTimestamp();
      const timestampField = appointmentStatusTimestampField(status);
      await runTransaction(database, async (transaction) => {
        const appointmentRef = doc(database, "appointments", id);
        const latestSnapshot = await transaction.get(appointmentRef);
        if (!latestSnapshot.exists()) throw new Error("Appointment not found");
        const latestItem = { id: latestSnapshot.id, ...latestSnapshot.data() } as Appointment;
        if (!appointmentTransitionOptions(latestItem.status).includes(status)) {
          throw new Error("This visit was updated elsewhere. Refresh the desk and try again.");
        }
        // Patient activity was refreshed immediately before this transaction;
        // Firestore rules verify it again atomically when the write commits.
        if (!roleCanApplyStatus(latestItem, status)) {
          throw new Error("You do not have access to apply this visit status.");
        }
        transaction.update(appointmentRef, {
          status,
          ...(timestampField ? { [timestampField]: changedAt } : {}),
          updatedAt: changedAt,
        });
        if (status === "cancelled" && latestItem.slotId) {
          transaction.delete(doc(database, "appointmentSlots", latestItem.slotId));
        }
      });
      setNotice(`Visit moved to ${appointmentStatusLabel(status).toLowerCase()}.`);
      return true;
    } catch (updateError) {
      console.error(updateError);
      setError(updateError instanceof Error ? updateError.message : "The appointment could not be updated. Please try again.");
      return false;
    } finally {
      setUpdatingId(null);
    }
  }

  async function beginConsultation(item: Appointment) {
    if (!canManageClinicalAppointment(item)) return;
    if (item.status === "in_consultation") {
      try {
        await verifyPatientIsActive(item.patientId);
        stageAdminNavigationHandoff({
          destination: "/admin/consultations",
          intent: "open-appointment-consultation",
          appointmentId: item.id,
        });
        router.push("/admin/consultations");
      } catch (verificationError) {
        setError(verificationError instanceof Error ? verificationError.message : "Patient status could not be verified.");
      }
      return;
    }
    const updated = await changeStatus(item.id, "in_consultation");
    if (updated) {
      stageAdminNavigationHandoff({
        destination: "/admin/consultations",
        intent: "open-appointment-consultation",
        appointmentId: item.id,
      });
      router.push("/admin/consultations");
    }
  }

  async function createAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!firestore) return;

    const name = booking.patientName.trim();
    const phone = booking.phone.trim();
    if (name.length < 2) {
      setBookingError("Enter the patient’s full name.");
      return;
    }
    if (phone.replace(/\D/g, "").length < 10) {
      setBookingError("Enter a valid phone number with at least 10 digits.");
      return;
    }
    if (!booking.preferredDate || !dateIsEnabled(schedule, booking.preferredDate)) {
      setBookingError("Choose an appointment date.");
      return;
    }
    if (availabilityLoading || availabilityError) {
      setBookingError("Live availability could not be checked. Refresh and try again before creating this booking.");
      return;
    }
    if (!selectedBookingTime || occupiedSlots.has(selectedBookingTime)) {
      setBookingError("Choose an available appointment time.");
      return;
    }

    setCreating(true);
    setBookingError("");
    setError("");
    setNotice("");

    try {
      await verifyPatientIsActive(booking.patientId);
      const currentUser = firebaseAuth?.currentUser;
      if (!currentUser) throw new Error("Staff session missing");
      const idToken = await currentUser.getIdToken();
      const response = await fetch("/api/appointments/book", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          patientName: name,
          phone,
          patientId: booking.patientId || undefined,
          doctorId: booking.doctorId,
          preferredDate: booking.preferredDate,
          preferredTime: selectedBookingTime,
          reason: booking.reason.trim(),
          source: booking.source,
          privacyAccepted: true,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "The appointment could not be created.");
      setBooking(emptyBooking(nextEnabledDate(schedule, today), generateTimeSlots(schedule.doctors.pediatrics)[0]));
      setShowCreate(false);
      setNotice("Reception appointment created and confirmed.");
    } catch (createError) {
      console.error(createError);
      setBookingError(createError instanceof Error ? createError.message : "The appointment could not be created.");
    } finally {
      setCreating(false);
    }
  }

  function updateBooking<Key extends keyof BookingForm>(key: Key, value: BookingForm[Key]) {
    setBooking((current) => ({
      ...current,
      [key]: value,
      ...((key === "patientName" || key === "phone") ? { patientId: "" } : {}),
    }));
  }

  function clearFilters() {
    setSearch("");
    setStatusFilter("all");
    setDoctorFilter(profile.role === "doctor" && profileDoctorId ? profileDoctorId : "all");
    setDateFilter("");
  }

  const activeFilters = Boolean(search || dateFilter || doctorFilter !== "all" || statusFilter !== "all");

  return (
    <div>
      <div className="staff-page-heading flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#A8864A]">Appointment desk</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-[#233A59] sm:text-4xl">Daily clinic schedule</h1>
          <p className="mt-3 text-slate-600">Find requests quickly, coordinate patients, and keep every visit status current.</p>
        </div>
        <div className="staff-page-actions flex flex-wrap gap-2">
          <button type="button" onClick={() => { setShowCreate((open) => !open); setBookingError(""); }} className="inline-flex items-center gap-2 rounded-xl bg-[#A8864A] px-4 py-3 text-sm font-bold text-white transition hover:bg-[#92713b]">
            <Plus size={18} /> {showCreate ? "Close form" : "New booking"}
          </button>
          <button type="button" onClick={() => setDateFilter(dateFilter === today ? "" : today)} className={"inline-flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-bold transition " + (dateFilter === today ? "bg-[#233A59] text-white" : "border border-[#233A59]/20 bg-white text-[#233A59] hover:bg-blue-50")}>
            <CalendarDays size={18} /> {dateFilter === today ? "Showing today" : "Show today"}
          </button>
        </div>
      </div>

      {showCreate && (
        <section className="mt-6 overflow-hidden rounded-3xl bg-[#233A59] text-white shadow-lg shadow-[#233A59]/15">
          <div className="border-b border-white/10 px-5 py-5 sm:px-7">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#D4B678]">Reception booking</p>
            <h2 className="mt-2 text-2xl font-bold">Add a phone or walk-in appointment</h2>
            <p className="mt-2 text-sm leading-6 text-white/70">Bookings created here are confirmed immediately and added to the live clinic schedule.</p>
          </div>
          <form onSubmit={createAppointment} className="grid gap-4 p-5 sm:grid-cols-2 sm:p-7 xl:grid-cols-3">
            <label className="text-sm font-bold">Patient name
              <input required minLength={2} maxLength={80} value={booking.patientName} onChange={(event) => updateBooking("patientName", event.target.value)} placeholder="Full name" className={inputClass + " mt-2 w-full text-slate-800"} />
            </label>
            <label className="text-sm font-bold">Phone number
              <input required inputMode="tel" maxLength={20} value={booking.phone} onChange={(event) => updateBooking("phone", event.target.value)} placeholder="10-digit mobile number" className={inputClass + " mt-2 w-full text-slate-800"} />
            </label>
            <label className="text-sm font-bold">Doctor
              <select value={booking.doctorId} onChange={(event) => updateBooking("doctorId", event.target.value as BookingForm["doctorId"])} className={inputClass + " mt-2 w-full text-slate-800"}>
                {DOCTORS.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name} · {doctor.specialty}</option>)}
              </select>
            </label>
            <label className="text-sm font-bold">Appointment date
              <input required type="date" min={today} value={booking.preferredDate} onChange={(event) => updateBooking("preferredDate", event.target.value)} className={inputClass + " mt-2 w-full text-slate-800"} />
            </label>
            <label className="text-sm font-bold">Appointment time
              <select
                value={selectedBookingTime}
                onChange={(event) => updateBooking("preferredTime", event.target.value)}
                disabled={availabilityLoading || availabilityError || availableBookingSlots.length === 0}
                className={inputClass + " mt-2 w-full text-slate-800 disabled:opacity-60"}
              >
                <option value="">{availabilityLoading ? "Checking availability…" : availabilityError ? "Availability temporarily unavailable" : availableBookingSlots.length ? "Select a time" : "No slots available"}</option>
                {bookingSlots.map((slot) => (
                  <option key={slot} value={slot} disabled={occupiedSlots.has(slot)}>
                    {formatAppointmentTime(slot)}{occupiedSlots.has(slot) ? " — Booked" : ""}
                  </option>
                ))}
              </select>
              <span className="mt-2 block text-xs font-medium text-white/60">{scheduleSummary(schedule, booking.doctorId)}</span>
            </label>
            {availabilityError && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 sm:col-span-2 xl:col-span-3">Live availability could not be checked. Refresh before creating a booking so an occupied slot is never shown as free.</p>}
            <label className="text-sm font-bold">Booking source
              <select value={booking.source} onChange={(event) => updateBooking("source", event.target.value as BookingSource)} className={inputClass + " mt-2 w-full text-slate-800"}>
                <option value="reception">Reception desk</option>
                <option value="phone">Phone booking</option>
                <option value="walk-in">Walk-in</option>
              </select>
            </label>
            <label className="text-sm font-bold sm:col-span-2 xl:col-span-3">Reason or note
              <textarea maxLength={500} rows={3} value={booking.reason} onChange={(event) => updateBooking("reason", event.target.value)} placeholder="Symptoms, follow-up, vaccination, antenatal visit…" className="mt-2 block w-full rounded-xl border border-white/20 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-[#D4B678] focus:ring-2 focus:ring-[#D4B678]/20" />
            </label>
            {bookingError && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 sm:col-span-2 xl:col-span-3">{bookingError}</p>}
            <div className="flex flex-wrap gap-3 sm:col-span-2 xl:col-span-3">
              <button type="submit" disabled={creating || availabilityLoading || availabilityError || !selectedBookingTime} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-bold text-[#233A59] transition hover:bg-[#F8F4EA] disabled:cursor-not-allowed disabled:opacity-60">
                {creating ? <LoaderCircle size={17} className="animate-spin" /> : <Save size={17} />} {creating ? "Creating…" : "Create confirmed booking"}
              </button>
              <button type="button" onClick={() => { setShowCreate(false); setBookingError(""); }} className="min-h-11 rounded-xl border border-white/25 px-5 py-3 text-sm font-bold text-white transition hover:bg-white/10">Cancel</button>
            </div>
          </form>
        </section>
      )}

      <div className="mt-7 grid grid-cols-2 gap-3 xl:grid-cols-5">
        {[
          { label: "New requests", value: stats.requested, icon: Clock3, tone: "bg-amber-50 text-amber-700" },
          { label: "Visits today", value: stats.today, icon: CalendarCheck2, tone: "bg-blue-50 text-blue-700" },
          { label: "Waiting now", value: stats.waiting, icon: LogIn, tone: "bg-violet-50 text-violet-700" },
          { label: "With doctor", value: stats.consulting, icon: Stethoscope, tone: "bg-fuchsia-50 text-fuchsia-700" },
          { label: "Completed", value: stats.completed, icon: Stethoscope, tone: "bg-emerald-50 text-emerald-700" },
        ].map(({ label, value, icon: Icon, tone }) => (
          <article key={label} className="flex min-w-0 items-center gap-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200 sm:p-4">
            <span className={"hidden rounded-xl p-3 sm:inline-flex " + tone}><Icon size={21} /></span>
            <div className="min-w-0"><p className="text-2xl font-bold text-[#233A59]">{value}</p><p className="truncate text-xs text-slate-600 sm:text-sm">{label}</p></div>
          </article>
        ))}
      </div>

      <section className="mt-6 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="flex items-center gap-2 text-sm font-bold text-[#233A59]"><Filter size={17} /> Filter appointments</div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-[1.4fr_1fr_1fr_1fr_auto]">
          <label className="relative">
            <span className="sr-only">Search appointments</span>
            <Search size={17} className="pointer-events-none absolute left-3 top-3 text-slate-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search patient, phone or reason" className={inputClass + " w-full pl-10"} />
          </label>
          <label><span className="sr-only">Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} className={inputClass + " w-full"}><option value="all">All statuses</option>{APPOINTMENT_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label><span className="sr-only">Doctor</span><select disabled={profile.role === "doctor" && Boolean(profileDoctorId)} value={doctorFilter} onChange={(event) => setDoctorFilter(event.target.value)} className={inputClass + " w-full disabled:bg-slate-100 disabled:text-slate-500"}><option value="all">All doctors</option><option value="pediatrics">Dr. Shafi Ahamad</option><option value="obg">Dr. Shaik Reshma</option></select></label>
          <label><span className="sr-only">Preferred date</span><input value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} type="date" className={inputClass + " w-full"} /></label>
          <button type="button" disabled={!activeFilters} onClick={clearFilters} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"><XCircle size={17} /> Clear</button>
        </div>
      </section>

      {notice && <p className="mt-5 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{notice}</p>}
      {profile.role === "admin" && !archiveLoading && !archiveSafetyError && archivedExcludedCount > 0 && (
        <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
          {archivedExcludedCount} appointment {archivedExcludedCount === 1 ? "record is" : "records are"} linked to archived or unavailable patients and hidden from the active desk. Restore the patient record to make it actionable again.
        </p>
      )}
      {loading && <div className="mt-10 flex items-center gap-3 text-slate-600"><LoaderCircle className="animate-spin" /> Loading secure appointments…</div>}
      {archiveSafetyError && <p className="mt-5 rounded-xl bg-red-50 p-4 text-sm font-semibold text-red-700">{archiveSafetyError}</p>}
      {error && <p className="mt-5 rounded-xl bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</p>}

      {!loading && !archiveSafetyError && !error && items.length === 0 && (
        <div className="mt-8 rounded-3xl bg-white p-10 text-center ring-1 ring-slate-200"><CalendarDays className="mx-auto text-[#A8864A]" size={36} /><h2 className="mt-4 text-xl font-bold text-[#233A59]">No active appointments</h2><p className="mt-2 text-slate-600">New website, phone, and walk-in appointments will appear here.</p></div>
      )}

      {!loading && !archiveSafetyError && items.length > 0 && filteredItems.length === 0 && (
        <div className="mt-8 rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center"><Search className="mx-auto text-slate-400" size={32} /><h2 className="mt-4 text-lg font-bold text-[#233A59]">No matching appointments</h2><p className="mt-2 text-sm text-slate-600">Adjust or clear the filters to see more requests.</p><button type="button" onClick={clearFilters} className="mt-5 rounded-xl bg-[#233A59] px-4 py-2.5 text-sm font-bold text-white">Clear filters</button></div>
      )}

      {!loading && !archiveSafetyError && <div className="performance-list mt-6 space-y-4">
        {filteredItems.map((item) => {
          const isUpdating = updatingId === item.id;
          const token = queueTokenLabel(item.queueToken, item.doctorId);
          const nextStatuses = appointmentTransitionOptions(item.status).filter((status) => canApplyStatus(item, status));
          const canManageClinical = canManageClinicalAppointment(item);
          const canCheckInToday = item.preferredDate === today;
          const message = "Hello " + item.patientName + ", your appointment request at Asher Women & Child Healthcare for " + prettyDate(item.preferredDate) + " at " + formatAppointmentTime(item.preferredTime) + " with " + doctorName(item.doctorId) + " has been received. Please reply here if you need help.";
          return (
            <article key={item.id} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <div className="grid gap-5 xl:grid-cols-[1.05fr_1.15fr_auto] xl:items-center">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="inline-flex items-center gap-2 font-bold text-[#233A59]"><UserRound size={18} className="text-[#A8864A]" /> {item.patientName}</h2>
                    <span className={"rounded-full px-2.5 py-1 text-xs font-bold ring-1 " + appointmentStatusTone(item.status)}>{appointmentStatusLabel(item.status)}</span>
                    {token ? <span className="inline-flex items-center gap-1 rounded-full bg-[#233A59] px-2.5 py-1 text-xs font-bold text-white"><Hash size={12} />{token}</span> : null}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-500"><span>{doctorNames[item.doctorId] || item.doctorId}</span><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">{item.source === "walk-in" ? "Walk-in" : item.source === "phone" ? "Phone" : item.source === "reception" ? "Reception" : "Website"}</span></div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <a href={"tel:" + item.phone} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-100"><Phone size={14} /> Call</a>
                    <a href={"https://wa.me/" + whatsAppNumber(item.phone) + "?text=" + encodeURIComponent(message)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 transition hover:bg-emerald-100"><MessageCircle size={14} /> WhatsApp</a>
                    <span className="rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">{item.phone}</span>
                  </div>
                </div>

                <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                  <p className="font-bold text-[#233A59]">{prettyDate(item.preferredDate)} · {formatAppointmentTime(item.preferredTime)}</p>
                  <p className="mt-2 leading-6">{item.reason || "No reason provided"}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {item.preferredDate === today && <span className="inline-flex rounded-full bg-blue-100 px-2.5 py-1 text-xs font-bold text-blue-800">Today</span>}
                    {token ? <span className="inline-flex rounded-full bg-white px-2.5 py-1 text-xs font-bold text-slate-700 ring-1 ring-slate-200">Queue {token}</span> : null}
                  </div>
                </div>

                <div className="min-w-0 xl:min-w-[230px]">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1">
                    {item.status === "requested" && canApplyStatus(item, "confirmed") && <button type="button" disabled={isUpdating} onClick={() => void changeStatus(item.id, "confirmed")} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-700 px-3 py-2.5 text-xs font-bold text-white disabled:opacity-50"><CheckCircle2 size={15} /> Confirm</button>}
                    {(item.status === "confirmed" || item.status === "no_show") && canApplyStatus(item, "checked_in") && <button type="button" disabled={isUpdating || !canCheckInToday} title={canCheckInToday ? "Assign the next queue token" : "Check-in is available on the appointment date"} onClick={() => void changeStatus(item.id, "checked_in")} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-cyan-700 px-3 py-2.5 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-45"><LogIn size={15} /> Check in &amp; issue token</button>}
                    {item.status === "checked_in" && canApplyStatus(item, "waiting") && <button type="button" disabled={isUpdating} onClick={() => void changeStatus(item.id, "waiting")} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-violet-700 px-3 py-2.5 text-xs font-bold text-white disabled:opacity-50"><Clock3 size={15} /> Add to waiting</button>}
                    {canManageClinical && item.status === "waiting" && <button type="button" disabled={isUpdating} onClick={() => void beginConsultation(item)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#233A59] px-3 py-2.5 text-xs font-bold text-white disabled:opacity-50"><Play size={15} /> Start consultation</button>}
                    {canManageClinical && item.status === "in_consultation" && <button type="button" disabled={isUpdating} onClick={() => void beginConsultation(item)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-fuchsia-700 px-3 py-2.5 text-xs font-bold text-white disabled:opacity-50"><Stethoscope size={15} /> Open consultation</button>}
                    {["confirmed", "checked_in", "waiting"].includes(item.status) && canApplyStatus(item, "no_show") && <button type="button" disabled={isUpdating || !canCheckInToday} title={canCheckInToday ? "Record that the patient did not attend" : "No-show can be recorded on the appointment date"} onClick={() => void changeStatus(item.id, "no_show")} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-orange-200 bg-orange-50 px-3 py-2.5 text-xs font-bold text-orange-800 disabled:cursor-not-allowed disabled:opacity-45"><UserX size={15} /> Mark no-show</button>}
                  </div>
                  <label className="mt-3 block text-xs font-bold uppercase tracking-wide text-slate-500">Move visit
                    <select disabled={isUpdating || nextStatuses.length === 0} value={item.status} onChange={(event) => void changeStatus(item.id, event.target.value as AppointmentStatus)} className="mt-2 block min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold normal-case text-slate-700 disabled:opacity-50"><option value={item.status}>{appointmentStatusLabel(item.status)}</option>{nextStatuses.map((status) => <option key={status} value={status}>{appointmentStatusLabel(status)}</option>)}</select>
                  </label>
                  {isUpdating && <p className="mt-2 flex items-center gap-2 text-xs font-semibold text-slate-500"><LoaderCircle size={14} className="animate-spin" /> Saving…</p>}
                </div>
              </div>
            </article>
          );
        })}
      </div>}
    </div>
  );
}

export default function AppointmentsPage() {
  return <AppointmentDesk />;
}
