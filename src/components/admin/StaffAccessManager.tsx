"use client";

import { useStaff, type StaffRole } from "@/components/admin/StaffGuard";
import { firestore } from "@/firebase/config";
import { DOCTORS } from "@/lib/appointments";
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  type Timestamp,
} from "firebase/firestore";
import {
  CheckCircle2,
  KeyRound,
  LoaderCircle,
  ShieldCheck,
  UserPlus,
  UsersRound,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

type StaffRecord = {
  uid: string;
  displayName: string;
  email: string;
  role: StaffRole;
  doctorName?: string;
  active: boolean;
  createdAt?: Timestamp;
};

const inputClass =
  "mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base font-semibold text-slate-700 outline-none transition focus:border-[#233A59] focus:ring-2 focus:ring-[#233A59]/10 sm:h-11 sm:rounded-xl sm:text-sm";

const roles: { value: StaffRole; label: string; detail: string }[] = [
  {
    value: "admin",
    label: "Administrator",
    detail: "Full access, staff management, dashboards, and schedule settings",
  },
  {
    value: "doctor",
    label: "Doctor",
    detail: "Consultations, clinical records, appointments, billing, and lab workspace",
  },
  {
    value: "reception",
    label: "Reception",
    detail: "Appointments, patient registration, billing, and lab coordination",
  },
];

export default function StaffAccessManager() {
  const { profile, user } = useStaff();
  const [staff, setStaff] = useState<StaffRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [updatingUid, setUpdatingUid] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!firestore) return;
    return onSnapshot(
      collection(firestore, "staff"),
      (snapshot) => {
        setStaff(
          snapshot.docs
            .map((item) => ({ uid: item.id, ...item.data() }) as StaffRecord)
            .sort((a, b) => a.displayName.localeCompare(b.displayName)),
        );
        setLoading(false);
      },
      () => {
        setError("Staff accounts could not be loaded.");
        setLoading(false);
      },
    );
  }, []);

  async function createStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setNotice("");
    setError("");
    const form = event.currentTarget;
    const data = new FormData(form);

    try {
      const idToken = await user.getIdToken();
      const response = await fetch("/api/admin/staff/create", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          displayName: String(data.get("displayName") || "").trim(),
          email: String(data.get("email") || "").trim(),
          password: String(data.get("password") || ""),
          role: String(data.get("role") || ""),
          doctorName: String(data.get("doctorName") || ""),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || "The staff account could not be created.");
      }
      form.reset();
      setNotice(
        "Staff login created. Share the email and temporary password privately, then ask the staff member to sign in from the app.",
      );
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "The staff account could not be created.",
      );
    } finally {
      setCreating(false);
    }
  }

  async function updateStaffAccess(
    record: StaffRecord,
    changes: Partial<Pick<StaffRecord, "active" | "role" | "doctorName">>,
  ) {
    if (!firestore || (record.uid === profile.uid && changes.active === false)) return;
    setUpdatingUid(record.uid);
    setNotice("");
    setError("");
    try {
      await updateDoc(doc(firestore, "staff", record.uid), {
        ...changes,
        updatedBy: profile.uid,
        updatedAt: serverTimestamp(),
      });
      setNotice("Staff access updated.");
    } catch {
      setError("Staff access could not be updated. Please try again.");
    } finally {
      setUpdatingUid("");
    }
  }

  const activeCount = staff.filter((record) => record.active).length;
  const doctorCount = staff.filter((record) => record.active && record.role === "doctor").length;
  const inactiveCount = staff.filter((record) => !record.active).length;

  return (
    <section id="staff-access" className="space-y-5">
      <div className="rounded-[28px] bg-gradient-to-br from-[#17324d] via-[#233A59] to-[#315777] p-5 text-white shadow-xl sm:p-7">
        <div className="flex items-start gap-3">
          <span className="rounded-2xl bg-white/12 p-3 text-[#f0d69e] ring-1 ring-white/15">
            <UsersRound size={24} />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#f0d69e]">
              Administrator only
            </p>
            <h2 className="mt-1 text-2xl font-bold">Staff access</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/75 sm:text-base">
              Create one secure login per staff member, select their role, and deactivate
              access immediately when required.
            </p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-3 gap-2 sm:max-w-xl sm:gap-3">
          {[
            [String(activeCount), "Active"],
            [String(doctorCount), "Doctors"],
            [String(inactiveCount), "Disabled"],
          ].map(([value, label]) => (
            <div key={label} className="rounded-2xl bg-white/10 p-3 text-center ring-1 ring-white/10">
              <p className="text-xl font-bold sm:text-2xl">{value}</p>
              <p className="mt-1 text-[11px] font-bold uppercase tracking-wide text-white/65">{label}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-7">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#A8864A]/12 text-[#8b6d38]">
            <UserPlus size={21} />
          </span>
          <div>
            <h3 className="text-xl font-bold text-[#233A59]">Create a new staff login</h3>
            <p className="mt-1 text-sm text-slate-500">The login works on Android, iPhone, tablet, and desktop.</p>
          </div>
        </div>

        <form onSubmit={createStaff} className="mt-6 grid gap-4 rounded-2xl bg-slate-50 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-5">
          <label className="text-sm font-bold text-slate-700">
            Staff name
            <input name="displayName" required minLength={2} maxLength={100} autoComplete="name" placeholder="Full name" className={inputClass} />
          </label>
          <label className="text-sm font-bold text-slate-700">
            Email address
            <input name="email" type="email" required autoComplete="off" inputMode="email" placeholder="staff@clinic.com" className={inputClass} />
          </label>
          <label className="text-sm font-bold text-slate-700">
            Temporary password
            <input name="password" type="password" required minLength={8} maxLength={72} autoComplete="new-password" placeholder="Minimum 8 characters" className={inputClass} />
          </label>
          <label className="text-sm font-bold text-slate-700">
            Access role
            <select name="role" defaultValue="reception" className={inputClass}>
              {roles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
            </select>
          </label>
          <label className="text-sm font-bold text-slate-700">
            Doctor assignment
            <select name="doctorName" defaultValue="" className={inputClass}>
              <option value="">Not a doctor account</option>
              {DOCTORS.map((doctor) => <option key={doctor.id} value={doctor.name}>{doctor.name}</option>)}
            </select>
          </label>
          <div className="sm:col-span-2 xl:col-span-5">
            <button
              type="submit"
              disabled={creating}
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#A8864A] px-5 py-3 text-sm font-bold text-white transition hover:bg-[#92713b] disabled:opacity-60 sm:w-auto"
            >
              {creating ? <LoaderCircle size={18} className="animate-spin" /> : <UserPlus size={18} />}
              {creating ? "Creating secure login…" : "Create staff login"}
            </button>
          </div>
        </form>

        {error && <p role="alert" className="mt-5 rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p>}
        {notice && <p role="status" className="mt-5 flex items-start gap-2 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800"><CheckCircle2 className="mt-0.5 shrink-0" size={18} />{notice}</p>}
      </div>

      <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
          <h3 className="font-bold text-[#233A59]">Current staff accounts</h3>
          <p className="mt-1 text-sm text-slate-500">Change roles or disable a login without deleting its audit history.</p>
        </div>
        {loading ? (
          <div className="flex items-center gap-3 p-5 text-sm text-slate-500"><LoaderCircle size={18} className="animate-spin" />Loading staff access…</div>
        ) : staff.length === 0 ? (
          <p className="p-5 text-sm text-slate-500">No staff profiles found.</p>
        ) : (
          <div className="divide-y divide-slate-200">
            {staff.map((record) => {
              const updating = updatingUid === record.uid;
              const isSelf = record.uid === profile.uid;
              return (
                <article key={record.uid} className="grid gap-4 p-5 sm:grid-cols-[1.4fr_1.2fr_auto] sm:items-center">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-bold text-[#233A59]">{record.displayName || "Clinic staff"}</p>
                      {isSelf ? <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-blue-700">You</span> : null}
                    </div>
                    <p className="mt-1 break-all text-xs text-slate-500">{record.email}</p>
                  </div>
                  <div className="grid gap-2">
                    <select
                      value={record.role}
                      disabled={updating || isSelf}
                      onChange={(event) => {
                        const role = event.target.value as StaffRole;
                        void updateStaffAccess(record, { role, ...(role === "doctor" ? {} : { doctorName: "" }) });
                      }}
                      className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700"
                      aria-label={`Role for ${record.displayName}`}
                    >
                      {roles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                    </select>
                    {record.role === "doctor" ? (
                      <select
                        value={record.doctorName || ""}
                        disabled={updating}
                        onChange={(event) => void updateStaffAccess(record, { doctorName: event.target.value })}
                        className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700"
                        aria-label={`Doctor assignment for ${record.displayName}`}
                      >
                        <option value="">Assign doctor</option>
                        {DOCTORS.map((doctor) => <option key={doctor.id} value={doctor.name}>{doctor.name}</option>)}
                      </select>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    disabled={updating || isSelf}
                    onClick={() => void updateStaffAccess(record, { active: !record.active })}
                    className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-xs font-bold transition ${
                      record.active ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"
                    } disabled:cursor-not-allowed disabled:opacity-60`}
                  >
                    {updating ? <LoaderCircle size={15} className="animate-spin" /> : record.active ? <ShieldCheck size={15} /> : <KeyRound size={15} />}
                    {record.active ? "Active" : "Deactivated"}
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm leading-6 text-blue-900">
        <strong>Access safety:</strong> use a different login for every person and share temporary passwords privately. The current administrator cannot disable their own account here.
      </div>
    </section>
  );
}
