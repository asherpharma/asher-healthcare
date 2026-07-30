"use client";

import AdminShell from "@/components/admin/AdminShell";
import { firebaseAuth, firestore } from "@/firebase/config";
import { useAppointmentSchedule } from "@/hooks/useAppointmentSchedule";
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
  collection,
  doc,
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
  CalendarCheck2,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Filter,
  LoaderCircle,
  MessageCircle,
  Phone,
  Plus,
  Save,
  Search,
  Stethoscope,
  UserRound,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";

type AppointmentStatus = "requested" | "confirmed" | "completed" | "cancelled";
type Appointment = {
  id: string;
  patientName: string;
  phone: string;
  doctorId: string;
  preferredDate: string;
  preferredTime: string;
  reason: string;
  status: AppointmentStatus;
  source?: string;
  slotId?: string;
  createdAt?: Timestamp;
};

type StatusFilter = "all" | AppointmentStatus;
type BookingSource = "reception" | "phone" | "walk-in";
type BookingForm = {
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

const statusStyles: Record<AppointmentStatus, string> = {
  requested: "bg-amber-50 text-amber-800 ring-amber-200",
  confirmed: "bg-blue-50 text-blue-800 ring-blue-200",
  completed: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  cancelled: "bg-red-50 text-red-800 ring-red-200",
};

const emptyBooking = (date: string, time = "17:00"): BookingForm => ({
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
  const today = clinicDate();
  const { schedule } = useAppointmentSchedule();
  const [items, setItems] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [doctorFilter, setDoctorFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [bookingError, setBookingError] = useState("");
  const [booking, setBooking] = useState<BookingForm>(() => emptyBooking(nextEnabledDate(schedule, today)));
  const [availability, setAvailability] = useState<{ key: string; slots: Set<string> }>({
    key: "",
    slots: new Set(),
  });

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
  const availableBookingSlots = useMemo(
    () => bookingSlots.filter((slot) => !occupiedSlots.has(slot)),
    [bookingSlots, occupiedSlots],
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
        });
      },
      () => {
        setAvailability({
          key: `${booking.doctorId}_${booking.preferredDate}`,
          slots: new Set(),
        });
      },
    );
  }, [booking.doctorId, booking.preferredDate]);

  useEffect(() => {
    if (!firestore) return;
    const appointmentsQuery = query(collection(firestore, "appointments"), orderBy("createdAt", "desc"), limit(200));
    return onSnapshot(
      appointmentsQuery,
      (snapshot) => {
        setItems(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Appointment));
        setLoading(false);
      },
      () => {
        setError("Appointments could not be loaded. Please check staff access and try again.");
        setLoading(false);
      },
    );
  }, []);

  const stats = useMemo(() => ({
    requested: items.filter((item) => item.status === "requested").length,
    today: items.filter((item) => item.preferredDate === today && item.status !== "cancelled").length,
    confirmed: items.filter((item) => item.status === "confirmed").length,
    completed: items.filter((item) => item.status === "completed").length,
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

  async function changeStatus(id: string, status: AppointmentStatus) {
    if (!firestore) return;
    setUpdatingId(id);
    setError("");
    setNotice("");
    try {
      const item = items.find((appointment) => appointment.id === id);
      const batch = writeBatch(firestore);
      batch.update(doc(firestore, "appointments", id), {
        status,
        updatedAt: serverTimestamp(),
      });
      if (status === "cancelled" && item?.slotId) {
        batch.delete(doc(firestore, "appointmentSlots", item.slotId));
      }
      await batch.commit();
      setNotice("Appointment status updated.");
    } catch {
      setError("The appointment could not be updated. Please try again.");
    } finally {
      setUpdatingId(null);
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
    if (!selectedBookingTime || occupiedSlots.has(selectedBookingTime)) {
      setBookingError("Choose an available appointment time.");
      return;
    }

    setCreating(true);
    setBookingError("");
    setError("");
    setNotice("");

    try {
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
    setBooking((current) => ({ ...current, [key]: value }));
  }

  function clearFilters() {
    setSearch("");
    setStatusFilter("all");
    setDoctorFilter("all");
    setDateFilter("");
  }

  const activeFilters = Boolean(search || dateFilter || doctorFilter !== "all" || statusFilter !== "all");

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#A8864A]">Appointment desk</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-[#233A59] sm:text-4xl">Daily clinic schedule</h1>
          <p className="mt-3 text-slate-600">Find requests quickly, coordinate patients, and keep every visit status current.</p>
        </div>
        <div className="flex flex-wrap gap-2">
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
                disabled={availabilityLoading || availableBookingSlots.length === 0}
                className={inputClass + " mt-2 w-full text-slate-800 disabled:opacity-60"}
              >
                <option value="">{availabilityLoading ? "Checking availability…" : availableBookingSlots.length ? "Select a time" : "No slots available"}</option>
                {bookingSlots.map((slot) => (
                  <option key={slot} value={slot} disabled={occupiedSlots.has(slot)}>
                    {formatAppointmentTime(slot)}{occupiedSlots.has(slot) ? " — Booked" : ""}
                  </option>
                ))}
              </select>
              <span className="mt-2 block text-xs font-medium text-white/60">{scheduleSummary(schedule, booking.doctorId)}</span>
            </label>
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
              <button type="submit" disabled={creating} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-bold text-[#233A59] transition hover:bg-[#F8F4EA] disabled:cursor-not-allowed disabled:opacity-60">
                {creating ? <LoaderCircle size={17} className="animate-spin" /> : <Save size={17} />} {creating ? "Creating…" : "Create confirmed booking"}
              </button>
              <button type="button" onClick={() => { setShowCreate(false); setBookingError(""); }} className="min-h-11 rounded-xl border border-white/25 px-5 py-3 text-sm font-bold text-white transition hover:bg-white/10">Cancel</button>
            </div>
          </form>
        </section>
      )}

      <div className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "New requests", value: stats.requested, icon: Clock3, tone: "bg-amber-50 text-amber-700" },
          { label: "Visits today", value: stats.today, icon: CalendarCheck2, tone: "bg-blue-50 text-blue-700" },
          { label: "Confirmed", value: stats.confirmed, icon: CheckCircle2, tone: "bg-indigo-50 text-indigo-700" },
          { label: "Completed", value: stats.completed, icon: Stethoscope, tone: "bg-emerald-50 text-emerald-700" },
        ].map(({ label, value, icon: Icon, tone }) => (
          <article key={label} className="flex items-center gap-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <span className={"rounded-xl p-3 " + tone}><Icon size={21} /></span>
            <div><p className="text-2xl font-bold text-[#233A59]">{value}</p><p className="text-sm text-slate-600">{label}</p></div>
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
          <label><span className="sr-only">Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} className={inputClass + " w-full"}><option value="all">All statuses</option><option value="requested">Requested</option><option value="confirmed">Confirmed</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></label>
          <label><span className="sr-only">Doctor</span><select value={doctorFilter} onChange={(event) => setDoctorFilter(event.target.value)} className={inputClass + " w-full"}><option value="all">All doctors</option><option value="pediatrics">Dr. Shafi Ahamad</option><option value="obg">Dr. Shaik Reshma</option></select></label>
          <label><span className="sr-only">Preferred date</span><input value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} type="date" className={inputClass + " w-full"} /></label>
          <button type="button" disabled={!activeFilters} onClick={clearFilters} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"><XCircle size={17} /> Clear</button>
        </div>
      </section>

      {notice && <p className="mt-5 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{notice}</p>}
      {loading && <div className="mt-10 flex items-center gap-3 text-slate-600"><LoaderCircle className="animate-spin" /> Loading secure appointments…</div>}
      {error && <p className="mt-5 rounded-xl bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</p>}

      {!loading && !error && items.length === 0 && (
        <div className="mt-8 rounded-3xl bg-white p-10 text-center ring-1 ring-slate-200"><CalendarDays className="mx-auto text-[#A8864A]" size={36} /><h2 className="mt-4 text-xl font-bold text-[#233A59]">No requests yet</h2><p className="mt-2 text-slate-600">New website, phone, and walk-in appointments will appear here.</p></div>
      )}

      {!loading && items.length > 0 && filteredItems.length === 0 && (
        <div className="mt-8 rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center"><Search className="mx-auto text-slate-400" size={32} /><h2 className="mt-4 text-lg font-bold text-[#233A59]">No matching appointments</h2><p className="mt-2 text-sm text-slate-600">Adjust or clear the filters to see more requests.</p><button type="button" onClick={clearFilters} className="mt-5 rounded-xl bg-[#233A59] px-4 py-2.5 text-sm font-bold text-white">Clear filters</button></div>
      )}

      <div className="mt-6 space-y-4">
        {filteredItems.map((item) => {
          const isUpdating = updatingId === item.id;
          const message = "Hello " + item.patientName + ", your appointment request at Asher Women & Child Healthcare for " + prettyDate(item.preferredDate) + " at " + formatAppointmentTime(item.preferredTime) + " with " + doctorName(item.doctorId) + " has been received. Please reply here if you need help.";
          return (
            <article key={item.id} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <div className="grid gap-5 xl:grid-cols-[1.05fr_1.15fr_auto] xl:items-center">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="inline-flex items-center gap-2 font-bold text-[#233A59]"><UserRound size={18} className="text-[#A8864A]" /> {item.patientName}</h2>
                    <span className={"rounded-full px-2.5 py-1 text-xs font-bold capitalize ring-1 " + statusStyles[item.status]}>{item.status}</span>
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
                  {item.preferredDate === today && <span className="mt-3 inline-flex rounded-full bg-blue-100 px-2.5 py-1 text-xs font-bold text-blue-800">Today</span>}
                </div>

                <div className="min-w-[210px]">
                  <div className="flex flex-wrap gap-2">
                    {item.status === "requested" && <button type="button" disabled={isUpdating} onClick={() => void changeStatus(item.id, "confirmed")} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-700 px-3 py-2.5 text-xs font-bold text-white disabled:opacity-50"><CheckCircle2 size={15} /> Confirm</button>}
                    {item.status === "confirmed" && <button type="button" disabled={isUpdating} onClick={() => void changeStatus(item.id, "completed")} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-3 py-2.5 text-xs font-bold text-white disabled:opacity-50"><Stethoscope size={15} /> Complete</button>}
                  </div>
                  <label className="mt-3 block text-xs font-bold uppercase tracking-wide text-slate-500">Status
                    <select disabled={isUpdating} value={item.status} onChange={(event) => void changeStatus(item.id, event.target.value as AppointmentStatus)} className="mt-2 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold normal-case text-slate-700 disabled:opacity-50"><option value="requested">Requested</option><option value="confirmed">Confirmed</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select>
                  </label>
                  {isUpdating && <p className="mt-2 flex items-center gap-2 text-xs font-semibold text-slate-500"><LoaderCircle size={14} className="animate-spin" /> Saving…</p>}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

export default function AppointmentsPage() {
  return <AdminShell><AppointmentDesk /></AdminShell>;
}
