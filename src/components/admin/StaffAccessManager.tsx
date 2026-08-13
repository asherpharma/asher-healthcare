"use client";

import { useStaff, type StaffRole } from "@/components/admin/StaffGuard";
import { firestore } from "@/firebase/config";
import { DOCTORS } from "@/lib/appointments";
import {
  collection,
  onSnapshot,
  type Timestamp,
} from "firebase/firestore";
import {
  CheckCircle2,
  Clock3,
  FlaskConical,
  KeyRound,
  LoaderCircle,
  MailCheck,
  RefreshCw,
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
  labReportOperator?: boolean;
  active: boolean;
  createdAt?: Timestamp;
  inviteEmailSentAt?: Timestamp;
  inviteStatus?: "pending" | "accepted" | "expired" | "revoked";
};

type InviteState = "active" | "invited" | "expired" | "disabled";

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

function inviteState(record: StaffRecord): InviteState {
  if (!record.active || record.inviteStatus === "revoked") {
    return "disabled";
  }
  if (record.inviteStatus === "accepted") return "active";
  if (record.inviteStatus === "expired") return "expired";
  if (record.inviteStatus === "pending" || record.inviteEmailSentAt) {
    return "invited";
  }
  return "active";
}

function formatInviteTime(value?: Timestamp) {
  if (!value?.toDate) return "";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value.toDate());
}

const inviteLabels: Record<InviteState, { label: string; className: string }> = {
  active: { label: "Active", className: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
  invited: { label: "Invite sent", className: "bg-blue-50 text-blue-800 ring-blue-200" },
  expired: { label: "Invite expired", className: "bg-amber-50 text-amber-900 ring-amber-200" },
  disabled: { label: "Disabled", className: "bg-red-50 text-red-700 ring-red-200" },
};

export default function StaffAccessManager() {
  const { profile, user } = useStaff();
  const [staff, setStaff] = useState<StaffRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [inviteRole, setInviteRole] = useState<StaffRole>("reception");
  const [updatingUid, setUpdatingUid] = useState("");
  const [resendingUid, setResendingUid] = useState("");
  const [accessDrafts, setAccessDrafts] = useState<Record<string, {
    role: StaffRole;
    doctorName: string;
  }>>({});
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
    const email = String(data.get("email") || "").trim();
    const grantLabAccess = data.get("labReportOperator") === "true";

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
          email,
          role: String(data.get("role") || ""),
          doctorName: String(data.get("doctorName") || ""),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || "The staff account could not be created.");
      }
      if (grantLabAccess) {
        const accessResponse = await fetch("/api/admin/staff/lab-access", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${idToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ uid: result.uid, allowed: true }),
        });
        const accessResult = await accessResponse.json().catch(() => ({}));
        if (!accessResponse.ok) {
          form.reset();
          setInviteRole("reception");
          setNotice(`Invitation sent to ${email}.`);
          setError(
            `The account is ready, but laboratory access was not granted. ${accessResult.error || "Use the staff access list to try again."}`,
          );
          return;
        }
      }
      form.reset();
      setInviteRole("reception");
      setNotice(
        `Invitation sent to ${email}. The email includes secure password setup, staff login, and app installation links.`,
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

  async function resendInvite(record: StaffRecord) {
    setResendingUid(record.uid);
    setNotice("");
    setError("");
    try {
      const idToken = await user.getIdToken();
      const response = await fetch("/api/admin/staff/resend", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ uid: record.uid }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || "The staff invitation could not be resent.");
      }
      setNotice(`A fresh invitation was sent to ${record.email}.`);
    } catch (resendError) {
      setError(
        resendError instanceof Error
          ? resendError.message
          : "The staff invitation could not be resent.",
      );
    } finally {
      setResendingUid("");
    }
  }

  async function updateStaffAccess(
    record: StaffRecord,
    changes: Partial<Pick<StaffRecord, "active" | "role" | "doctorName" | "labReportOperator">>,
  ) {
    if (!firestore || (record.uid === profile.uid && changes.active === false)) return;
    setUpdatingUid(record.uid);
    setNotice("");
    setError("");
    try {
      if (typeof changes.labReportOperator === "boolean") {
        const idToken = await user.getIdToken();
        const response = await fetch("/api/admin/staff/lab-access", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${idToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            uid: record.uid,
            allowed: changes.labReportOperator,
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(result.error || "Laboratory access could not be updated.");
        }
        setNotice(record.role === "doctor"
          ? (changes.labReportOperator
              ? "Partner-lab portal and import access granted. Assigned-patient report viewing remains part of the doctor role."
              : "Partner-lab portal and import access removed. The doctor can still view reports for currently assigned patients.")
          : (changes.labReportOperator
              ? "Laboratory portal and report access granted and recorded in the audit log."
              : "Laboratory portal and report access removed and recorded in the audit log."));
        return;
      }
      if (changes.role !== undefined || changes.doctorName !== undefined) {
        const role = changes.role ?? record.role;
        const doctorName = role === "doctor"
          ? String(changes.doctorName ?? record.doctorName ?? "")
          : "";
        const idToken = await user.getIdToken();
        const response = await fetch("/api/admin/staff/role-assignment", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${idToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ uid: record.uid, role, doctorName }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(result.error || "The staff role assignment could not be updated.");
        }
        setAccessDrafts((current) => {
          const next = { ...current };
          delete next[record.uid];
          return next;
        });
        setNotice(record.role !== role
          ? "Staff role updated and audited. Any separate laboratory grant was removed for safety."
          : "Doctor assignment updated and audited. Any separate partner-lab grant was removed for safety.");
        return;
      }
      if (changes.active !== undefined) {
        const idToken = await user.getIdToken();
        const response = await fetch("/api/admin/staff/active", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${idToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ uid: record.uid, active: changes.active }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(result.error || "Staff access could not be updated.");
        }
        setNotice(changes.active
          ? "Staff access reactivated and recorded in the audit log."
          : "Staff access deactivated and recorded in the audit log.");
        return;
      }
    } catch (updateError) {
      setError(updateError instanceof Error
        ? updateError.message
        : "Staff access could not be updated. Please try again.");
    } finally {
      setUpdatingUid("");
    }
  }

  const activeCount = staff.filter((record) => inviteState(record) === "active").length;
  const doctorCount = staff.filter((record) => record.active && record.role === "doctor").length;
  const pendingCount = staff.filter((record) => ["invited", "expired"].includes(inviteState(record))).length;

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
            [String(pendingCount), "Invited"],
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
            <h3 className="text-xl font-bold text-[#233A59]">Invite a staff member</h3>
            <p className="mt-1 text-sm text-slate-500">We email secure password setup, login, and app-installation links automatically.</p>
          </div>
        </div>

        <form onSubmit={createStaff} className="mt-6 grid gap-4 rounded-2xl bg-slate-50 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-4">
          <label className="text-sm font-bold text-slate-700">
            Staff name
            <input name="displayName" required minLength={2} maxLength={100} autoComplete="name" placeholder="Full name" className={inputClass} />
          </label>
          <label className="text-sm font-bold text-slate-700">
            Email address
            <input name="email" type="email" required autoComplete="off" inputMode="email" placeholder="staff@clinic.com" className={inputClass} />
          </label>
          <label className="text-sm font-bold text-slate-700">
            Access role
            <select
              name="role"
              value={inviteRole}
              onChange={(event) => setInviteRole(event.target.value as StaffRole)}
              className={inputClass}
            >
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
          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:col-span-2 xl:col-span-4">
            <input name="labReportOperator" type="checkbox" value="true" disabled={inviteRole === "admin"} className="mt-0.5 h-5 w-5 shrink-0 accent-[#233A59] disabled:cursor-not-allowed disabled:opacity-50" />
            <span>
              <span className="block text-sm font-bold text-[#233A59]">
                {inviteRole === "admin"
                  ? "Laboratory access is included for administrators"
                  : inviteRole === "doctor"
                    ? "Allow partner-lab portal and import access"
                    : "Allow external lab portal and report access"}
              </span>
              <span className="mt-1 block text-xs leading-5 text-slate-500">
                {inviteRole === "admin"
                  ? "No separate laboratory grant is required for this role."
                  : inviteRole === "doctor"
                    ? "Doctors already view reports for currently assigned patients. This extra grant enables the approved partner portal and report import workflow."
                    : "This extra permission allows reception staff to import, securely open, download, and print external laboratory reports. Leave it off unless their duties require it."}
              </span>
            </span>
          </label>
          <div className="sm:col-span-2 xl:col-span-4">
            <button
              type="submit"
              disabled={creating}
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#A8864A] px-5 py-3 text-sm font-bold text-white transition hover:bg-[#92713b] disabled:opacity-60 sm:w-auto"
            >
              {creating ? <LoaderCircle size={18} className="animate-spin" /> : <UserPlus size={18} />}
              {creating ? "Sending invitation…" : "Send staff invitation"}
            </button>
          </div>
        </form>

        {error && <p role="alert" className="mt-5 rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p>}
        {notice && <p role="status" className="mt-5 flex items-start gap-2 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800"><CheckCircle2 className="mt-0.5 shrink-0" size={18} />{notice}</p>}
      </div>

      <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
          <h3 className="font-bold text-[#233A59]">Current staff accounts</h3>
          <p className="mt-1 text-sm text-slate-500">See invite progress, resend expired invitations, or disable access without deleting audit history.</p>
        </div>
        {loading ? (
          <div className="flex items-center gap-3 p-5 text-sm text-slate-500"><LoaderCircle size={18} className="animate-spin" />Loading staff access…</div>
        ) : staff.length === 0 ? (
          <p className="p-5 text-sm text-slate-500">No staff profiles found.</p>
        ) : (
          <div className="divide-y divide-slate-200">
            {staff.map((record) => {
              const updating = updatingUid === record.uid;
              const resending = resendingUid === record.uid;
              const isSelf = record.uid === profile.uid;
              const state = inviteState(record);
              const status = inviteLabels[state];
              const sentAt = formatInviteTime(record.inviteEmailSentAt);
              const accessDraft = accessDrafts[record.uid] ?? {
                role: record.role,
                doctorName: record.role === "doctor" ? (record.doctorName || "") : "",
              };
              const roleAssignmentChanged = accessDraft.role !== record.role
                || (accessDraft.role === "doctor"
                  ? accessDraft.doctorName !== (record.doctorName || "")
                  : Boolean(record.doctorName));
              return (
                <article key={record.uid} className="grid gap-4 p-5 sm:grid-cols-[1.4fr_1.2fr_auto] sm:items-center">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-bold text-[#233A59]">{record.displayName || "Clinic staff"}</p>
                      {isSelf ? <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-blue-700">You</span> : null}
                    </div>
                    <p className="mt-1 break-all text-xs text-slate-500">{record.email}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ring-1 ${status.className}`}>
                        {status.label}
                      </span>
                      {sentAt ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500">
                          <Clock3 size={12} aria-hidden="true" /> Sent {sentAt}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <select
                      value={accessDraft.role}
                      disabled={updating || isSelf}
                      onChange={(event) => {
                        const role = event.target.value as StaffRole;
                        setAccessDrafts((current) => ({
                          ...current,
                          [record.uid]: {
                            role,
                            doctorName: role === "doctor" ? accessDraft.doctorName : "",
                          },
                        }));
                      }}
                      className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700"
                      aria-label={`Role for ${record.displayName}`}
                    >
                      {roles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                    </select>
                    {accessDraft.role === "doctor" ? (
                      <select
                        value={accessDraft.doctorName}
                        disabled={updating}
                        onChange={(event) => setAccessDrafts((current) => ({
                          ...current,
                          [record.uid]: {
                            role: accessDraft.role,
                            doctorName: event.target.value,
                          },
                        }))}
                        className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700"
                        aria-label={`Doctor assignment for ${record.displayName}`}
                      >
                        <option value="">Assign doctor</option>
                        {DOCTORS.map((doctor) => <option key={doctor.id} value={doctor.name}>{doctor.name}</option>)}
                      </select>
                    ) : null}
                    {roleAssignmentChanged ? (
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          disabled={updating || (accessDraft.role === "doctor" && !accessDraft.doctorName)}
                          onClick={() => void updateStaffAccess(record, {
                            role: accessDraft.role,
                            doctorName: accessDraft.doctorName,
                          })}
                          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[#233A59] px-3 text-xs font-bold text-white transition hover:bg-[#182f49] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {updating ? <LoaderCircle size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                          Save role
                        </button>
                        <button
                          type="button"
                          disabled={updating}
                          onClick={() => setAccessDrafts((current) => {
                            const next = { ...current };
                            delete next[record.uid];
                            return next;
                          })}
                          className="min-h-10 rounded-xl bg-slate-100 px-3 text-xs font-bold text-slate-600 transition hover:bg-slate-200 disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : null}
                    <span className={`inline-flex min-h-9 items-center justify-center gap-2 rounded-xl px-3 text-[11px] font-bold ${record.role === "admin" || record.role === "doctor" || record.labReportOperator ? "bg-violet-50 text-violet-800" : "bg-slate-100 text-slate-500"}`}>
                      <FlaskConical size={14} aria-hidden="true" />
                      {record.role === "admin"
                        ? "Full lab access included"
                        : record.role === "doctor"
                          ? (record.labReportOperator ? "Assigned reports + partner import" : "Assigned-patient reports included")
                          : record.labReportOperator ? "Lab portal + reports allowed" : "No lab report access"}
                    </span>
                  </div>
                  <div className="grid gap-2">
                    {record.active ? (
                      <button
                        type="button"
                        disabled={resending || updating}
                        onClick={() => void resendInvite(record)}
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-50 px-4 text-xs font-bold text-blue-800 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {resending ? <LoaderCircle size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                        {resending ? "Sending…" : state === "active" ? "Send reset email" : "Resend invite"}
                      </button>
                    ) : null}
                    {record.role !== "admin" ? (
                      <button
                        type="button"
                        disabled={updating || resending || isSelf}
                        onClick={() => void updateStaffAccess(record, { labReportOperator: !record.labReportOperator })}
                        className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-xs font-bold transition ${
                          record.labReportOperator ? "bg-violet-50 text-violet-800" : "bg-slate-100 text-slate-600"
                        } disabled:cursor-not-allowed disabled:opacity-60`}
                      >
                        {updating ? <LoaderCircle size={15} className="animate-spin" /> : <FlaskConical size={15} />}
                        {record.role === "doctor"
                          ? (record.labReportOperator ? "Remove partner import" : "Allow partner import")
                          : record.labReportOperator ? "Remove lab access" : "Allow lab access"}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={updating || resending || isSelf}
                      onClick={() => {
                        const action = record.active ? "deactivate" : "reactivate";
                        if (window.confirm(`Are you sure you want to ${action} access for ${record.displayName}?`)) {
                          void updateStaffAccess(record, { active: !record.active });
                        }
                      }}
                      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-xs font-bold transition ${
                        record.active ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"
                      } disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      {updating ? <LoaderCircle size={15} className="animate-spin" /> : record.active ? <ShieldCheck size={15} /> : <KeyRound size={15} />}
                      {record.active ? "Deactivate access" : "Reactivate access"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm leading-6 text-blue-900">
        <MailCheck className="mr-2 inline" size={17} aria-hidden="true" />
        <strong>Access safety:</strong> every person receives a private password-setup link. Passwords are never shown to or shared by the administrator. Verified mobile OTP can be enabled later as an optional sign-in method.
      </div>
    </section>
  );
}
