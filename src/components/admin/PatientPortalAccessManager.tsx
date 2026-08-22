"use client";

import { useStaff } from "@/components/admin/StaffGuard";
import { patientSearchReady } from "@/lib/patient-search-readiness";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Copy,
  KeyRound,
  Link2,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldOff,
  UserRoundPlus,
  UsersRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

type PatientSearchResult = {
  id: string;
  patientNumber: string;
  fullName: string;
  phone: string;
  dateOfBirth: string;
  gender: string;
};

type GrantDraft = PatientSearchResult & {
  relationship: "self" | "parent" | "guardian" | "adult_proxy";
  consentRecordId: string;
  consentMethod: "signed_form" | "in_person" | "verified_guardianship";
  evidenceType: "patient_authorization" | "parent_attestation" | "guardianship_document";
  consentAttested: boolean;
  scopes: string[];
};

type PortalGrant = {
  grantId: string;
  grantVersion: string;
  patientId: string;
  patientName: string;
  relationship: string;
  status: string;
  scopes: string[];
  reviewAt: string;
  expiresAt: string;
  reviewPolicy: string;
  lifecycle: "current" | "pending" | "review_soon" | "expiring_soon" | "review_due" | "expired" | "revoked";
  nextActionAt: string;
  daysUntilAction: number | null;
};

type PortalAccount = {
  uid: string;
  displayName: string;
  email: string;
  status: string;
  invitedAt: string;
  claimedAt: string;
  grants: PortalGrant[];
};

type RenewalDraft = {
  accountUid: string;
  accountName: string;
  grantId: string;
  grantVersion: string;
  patientName: string;
  relationship: GrantDraft["relationship"];
  consentRecordId: string;
  consentMethod: GrantDraft["consentMethod"];
  evidenceType: GrantDraft["evidenceType"];
  consentAttested: boolean;
  identityVerificationMethod: "in_person" | "registered_phone" | "photo_id";
  identityVerificationReference: string;
  identityAttested: boolean;
  reverificationReason: "scheduled_review" | "expired_access" | "relationship_change" | "scope_change" | "identity_update";
  scopes: string[];
};

const inputClass = "mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 outline-none focus:border-[#233A59] focus:ring-2 focus:ring-[#233A59]/10";
const portalScopes = [["profile", "Basic identity"], ["appointments", "Appointments"], ["prescriptions", "Prescriptions"], ["reports", "Reports"], ["billing", "Receipts"]] as const;

function renewalEvidence(relationship: GrantDraft["relationship"]) {
  return {
    consentMethod: relationship === "guardian" ? "verified_guardianship" as const : "signed_form" as const,
    evidenceType: relationship === "parent"
      ? "parent_attestation" as const
      : relationship === "guardian"
        ? "guardianship_document" as const
        : "patient_authorization" as const,
  };
}

function formatPortalDate(value: string) {
  if (!value) return "No scheduled deadline";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Administrator review required"
    : new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function lifecyclePresentation(grant: PortalGrant) {
  const deadline = formatPortalDate(grant.nextActionAt);
  switch (grant.lifecycle) {
    case "expired": return { label: "Expired", detail: `Expired ${deadline}`, tone: "bg-red-100 text-red-800", urgent: true };
    case "review_due": return { label: "Review due", detail: grant.nextActionAt ? `Review was due ${deadline}` : "Access is paused until reviewed", tone: "bg-red-100 text-red-800", urgent: true };
    case "expiring_soon": return { label: "Expiring soon", detail: `Expires ${deadline} · ${grant.daysUntilAction ?? 0} days`, tone: "bg-amber-100 text-amber-900", urgent: true };
    case "review_soon": return { label: "Review soon", detail: `Review by ${deadline} · ${grant.daysUntilAction ?? 0} days`, tone: "bg-amber-100 text-amber-900", urgent: true };
    case "pending": return { label: "Pending acceptance", detail: grant.nextActionAt ? `Next review ${deadline}` : "Waiting for account holder", tone: "bg-blue-100 text-blue-800", urgent: false };
    case "revoked": return { label: "Revoked", detail: "No portal access", tone: "bg-slate-200 text-slate-700", urgent: false };
    default: return { label: "Current", detail: grant.nextActionAt ? `Next review ${deadline}` : "No scheduled deadline", tone: "bg-emerald-100 text-emerald-800", urgent: false };
  }
}

export default function PatientPortalAccessManager() {
  const { user } = useStaff();
  const patientSearchEpoch = useRef(0);
  const invitationFormRef = useRef<HTMLFormElement | null>(null);
  const [accounts, setAccounts] = useState<PortalAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchAttempted, setSearchAttempted] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<PatientSearchResult[]>([]);
  const [grants, setGrants] = useState<GrantDraft[]>([]);
  const [renewal, setRenewal] = useState<RenewalDraft | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const portalRequest = useCallback(async (body: object) => {
    const idToken = await user.getIdToken();
    const response = await fetch("/api/admin/patient-access", {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Patient portal access could not be updated.");
    return result;
  }, [user]);

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await portalRequest({ action: "list" });
      setAccounts(Array.isArray(result.accounts) ? result.accounts : []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Patient portal access could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [portalRequest]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadAccounts(), 0);
    return () => window.clearTimeout(timer);
  }, [loadAccounts]);

  async function searchPatients(event: FormEvent) {
    event.preventDefault();
    if (!patientSearchReady(search)) return;
    const submittedSearch = search.trim();
    const requestEpoch = ++patientSearchEpoch.current;
    setSearching(true);
    setSearchAttempted(false);
    setSearchError("");
    try {
      const idToken = await user.getIdToken();
      const response = await fetch("/api/staff/patients/search", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ search: submittedSearch, pageSize: 8 }),
      });
      const result = await response.json();
      if (requestEpoch !== patientSearchEpoch.current) return;
      if (!response.ok) throw new Error(result.error || "Patient search could not be completed.");
      setResults(Array.isArray(result.patients) ? result.patients : []);
      setSearchAttempted(true);
    } catch (requestError) {
      if (requestEpoch !== patientSearchEpoch.current) return;
      setSearchError(requestError instanceof Error ? requestError.message : "Patient search could not be completed.");
    } finally {
      if (requestEpoch === patientSearchEpoch.current) setSearching(false);
    }
  }

  function addPatient(patient: PatientSearchResult) {
    if (grants.some((grant) => grant.id === patient.id) || grants.length >= 5) return;
    patientSearchEpoch.current += 1;
    setGrants((current) => [...current, {
      ...patient,
      relationship: "parent",
      consentRecordId: "",
      consentMethod: "signed_form",
      evidenceType: "parent_attestation",
      consentAttested: false,
      scopes: ["profile", "appointments"],
    }]);
    setResults([]);
    setSearchAttempted(false);
    setSearchError("");
    setSearch("");
  }

  function updateGrant(patientId: string, updates: Partial<GrantDraft>) {
    setGrants((current) => current.map((grant) => grant.id === patientId ? { ...grant, ...updates } : grant));
  }

  function updateRelationship(patientId: string, relationship: GrantDraft["relationship"]) {
    updateGrant(patientId, {
      relationship,
      consentMethod: relationship === "guardian" ? "verified_guardianship" : "signed_form",
      evidenceType: relationship === "parent"
        ? "parent_attestation"
        : relationship === "guardian"
          ? "guardianship_document"
          : "patient_authorization",
      consentAttested: false,
    });
  }

  async function provision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (grants.length < 1) {
      setError("Search for and link at least one exact patient record.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    const formElement = event.currentTarget;
    const safeForm = (formElement as HTMLFormElement | null) ?? invitationFormRef.current;
    if (!safeForm) {
      setError("Unable to read the form state. Please refresh and try again.");
      setSaving(false);
      return;
    }
    const form = new FormData(safeForm);
    const email = String(form.get("email") || "").trim();
    const confirmEmail = String(form.get("confirmEmail") || "").trim();
    if (email.toLowerCase() !== confirmEmail.toLowerCase()) {
      setError("The email and re-entered email must match.");
      setSaving(false);
      return;
    }
    try {
      const result = await portalRequest({
        action: "provision",
        displayName: String(form.get("displayName") || ""),
        email,
        confirmEmail,
        accountEmailAttested: form.get("accountEmailAttested") === "on",
        grants: grants.map((grant) => ({
          patientId: grant.id,
          relationship: grant.relationship,
          consentRecordId: grant.consentRecordId,
          consentMethod: grant.consentMethod,
          evidenceType: grant.evidenceType,
          consentAttested: grant.consentAttested,
          scopes: grant.scopes,
        })),
      });
      const instruction = "A secure password setup email has been sent. Access stays pending until the account holder signs in and accepts it.";
      setMessage(`Family portal invitation prepared for ${result.displayName}. ${instruction}`);
      setGrants([]);
      safeForm.reset();
      await loadAccounts();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Patient portal access could not be created.");
    } finally {
      setSaving(false);
    }
  }

  function startRenewal(account: PortalAccount, grant: PortalGrant) {
    const relationship = ["self", "parent", "guardian", "adult_proxy"].includes(grant.relationship)
      ? grant.relationship as GrantDraft["relationship"]
      : "self";
    setRenewal({
      accountUid: account.uid,
      accountName: account.displayName,
      grantId: grant.grantId,
      grantVersion: grant.grantVersion,
      patientName: grant.patientName,
      relationship,
      consentRecordId: "",
      ...renewalEvidence(relationship),
      consentAttested: false,
      identityVerificationMethod: "registered_phone",
      identityVerificationReference: "",
      identityAttested: false,
      reverificationReason: grant.lifecycle === "expired" ? "expired_access" : "scheduled_review",
      scopes: grant.scopes.includes("profile") ? grant.scopes : ["profile", ...grant.scopes],
    });
    setMessage("");
    setError("");
  }

  function updateRenewalRelationship(relationship: RenewalDraft["relationship"]) {
    setRenewal((current) => current ? {
      ...current,
      relationship,
      ...renewalEvidence(relationship),
      consentAttested: false,
    } : current);
  }

  async function submitRenewal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!renewal) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await portalRequest({
        action: "renew",
        accountUid: renewal.accountUid,
        grantId: renewal.grantId,
        grantVersion: renewal.grantVersion,
        relationship: renewal.relationship,
        scopes: renewal.scopes,
        consentRecordId: renewal.consentRecordId,
        consentMethod: renewal.consentMethod,
        evidenceType: renewal.evidenceType,
        consentAttested: renewal.consentAttested,
        identityVerificationMethod: renewal.identityVerificationMethod,
        identityVerificationReference: renewal.identityVerificationReference,
        identityAttested: renewal.identityAttested,
        reverificationReason: renewal.reverificationReason,
      });
      setMessage(`Access to ${renewal.patientName} was securely re-verified. The prior consent record remains preserved in the audit history.`);
      setRenewal(null);
      await loadAccounts();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "This family permission could not be renewed.");
    } finally {
      setSaving(false);
    }
  }

  async function revoke(accountUid: string, grantId = "") {
    if (!window.confirm(grantId ? "Revoke access to this patient record?" : "Revoke this entire family portal account?")) return;
    setSaving(true);
    setError("");
    try {
      await portalRequest({ action: "revoke", accountUid, grantId, reason: "Revoked by clinic administrator" });
      setMessage(grantId ? "Patient access revoked." : "Family portal account revoked.");
      await loadAccounts();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Patient portal access could not be revoked.");
    } finally {
      setSaving(false);
    }
  }

  async function resend(accountUid: string) {
    if (!window.confirm("I verified the account holder's identity. Send a secure password setup/reset link now?")) return;
    const method = window.prompt("Verification method: in_person, registered_phone, or photo_id", "registered_phone")?.trim() || "";
    const reference = window.prompt("Enter the clinic filing/reference code (letters, numbers, dot, slash, dash only)", "VERIFY-1")?.trim() || "";
    if (!method || !reference) return;
    setSaving(true);
    setError("");
    try {
      await portalRequest({ action: "resend", accountUid, identityAttested: true, identityVerificationMethod: method, identityVerificationReference: reference });
      setMessage("A fresh password setup link was sent. Another resend is available after 10 minutes.");
      await loadAccounts();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The invitation could not be resent.");
    } finally {
      setSaving(false);
    }
  }

  async function copyPortalLink() {
    await navigator.clipboard.writeText("https://asherhealthcare.in/portal/login");
    setMessage("Patient portal sign-in link copied.");
  }

  const accessAttentionCount = accounts.flatMap((account) => account.grants)
    .filter((grant) => ["review_soon", "expiring_soon", "review_due", "expired"].includes(grant.lifecycle)).length;

  return (
    <div className="space-y-6">
      <section className="rounded-[28px] bg-[#233A59] p-6 text-white sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-3xl">
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.17em] text-[#E7C989]"><ShieldCheck size={17} />Administrator-only family access</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight">Patient & family portal access</h1>
            <p className="mt-3 leading-7 text-white/75">Verify the exact chart, relationship and consent reference. The portal never links a chart from a matching name, mobile number or email.</p>
          </div>
          <button type="button" onClick={() => void copyPortalLink()} className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-white px-4 text-sm font-bold text-[#233A59]"><Copy size={17} />Copy portal link</button>
        </div>
      </section>

      {message ? <p role="status" className="flex items-start gap-2 rounded-2xl bg-emerald-50 p-4 text-sm font-semibold leading-6 text-emerald-800"><CheckCircle2 className="mt-0.5 shrink-0" size={18} />{message}</p> : null}
      {error ? <p role="alert" className="rounded-2xl bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</p> : null}

      <section className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-7">
        <div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-blue-50 text-blue-700"><UserRoundPlus size={22} /></span><div><h2 className="text-xl font-bold text-[#233A59]">Invite a family account</h2><p className="text-sm text-slate-600">Access remains pending until the intended email owner signs in and accepts it.</p></div></div>
        <div className="mt-6 rounded-2xl bg-slate-50 p-4 sm:p-5">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#A8864A]">Step 1 · Attach a patient chart</p>
          <p className="mt-1 text-sm leading-6 text-slate-600">Search by the patient&apos;s registered name, 10-digit mobile number or patient ID, then tap the matching result.</p>
        <form onSubmit={searchPatients} className="mt-4 flex flex-col gap-2 sm:flex-row">
          <label className="relative w-full min-w-0 flex-1"><span className="sr-only">Search patient</span><Search className="pointer-events-none absolute left-3 top-3.5 text-slate-400" size={18} /><input value={search} onChange={(event) => { patientSearchEpoch.current += 1; setSearching(false); setSearch(event.target.value); setSearchAttempted(false); setSearchError(""); setResults([]); }} placeholder="Patient name, mobile or ID" className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-sm font-semibold outline-none focus:border-[#233A59]" /></label>
          <button disabled={searching || !patientSearchReady(search)} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#233A59] px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto">{searching ? <LoaderCircle className="animate-spin" size={17} /> : <Search size={17} />}Find</button>
        </form>
        {search && !patientSearchReady(search) ? <p className="mt-2 text-xs font-semibold text-slate-500">Enter at least 3 name letters, 6 mobile digits, or a complete patient ID.</p> : null}
        {searchError ? <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{searchError}</p> : null}
        {results.length > 0 ? <div className="mt-3 divide-y divide-slate-100 rounded-2xl border border-slate-200">{results.map((patient) => <button type="button" key={patient.id} onClick={() => addPatient(patient)} className="flex w-full items-center justify-between gap-4 p-4 text-left hover:bg-slate-50"><span><strong className="block text-[#233A59]">{patient.fullName}</strong><span className="mt-1 block text-xs text-slate-500">{patient.patientNumber} · {patient.phone} · DOB {patient.dateOfBirth}</span></span><span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-bold text-[#A8864A]"><Link2 size={18} />Attach</span></button>)}</div> : null}
        {searchAttempted && !searching && results.length === 0 ? <div role="status" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950"><strong className="block">No matching patient record found.</strong><span>Try the exact registered mobile number or patient ID. If this is a new patient, </span><Link href="/admin/reception" className="font-bold underline underline-offset-2">register the patient first</Link><span>, then return here.</span></div> : null}
        </div>

        <form ref={invitationFormRef} onSubmit={provision} className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 sm:col-span-2">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-blue-800">Step 2 · Account holder and consent</p>
            <p className="mt-1 text-sm leading-6 text-blue-950">Use a separate patient or family email address. An email already used for an Asher Staff login cannot be reused for the patient portal.</p>
          </div>
          <label className="text-sm font-bold text-slate-700">Account holder name<input name="displayName" required minLength={2} maxLength={100} className={inputClass} /></label>
          <label className="text-sm font-bold text-slate-700">Account email<input name="email" type="email" required maxLength={254} className={inputClass} /></label>
          <label className="text-sm font-bold text-slate-700 lg:col-start-2">Re-enter account email<input name="confirmEmail" type="email" required maxLength={254} autoComplete="off" className={inputClass} /></label>
          <label className="flex items-start gap-3 rounded-2xl bg-blue-50 p-4 text-xs font-semibold leading-5 text-blue-950 sm:col-span-2"><input name="accountEmailAttested" type="checkbox" required className="mt-1" />I verified that this email belongs to the named, authorized account holder. I understand each selected permission covers current and future matching records until its review date, expiry or clinic revocation.</label>
          <div className="space-y-3 sm:col-span-2">
            {grants.map((grant) => <article key={grant.id} className="rounded-2xl border border-slate-200 p-4">
              <div className="flex items-start justify-between gap-3"><div><p className="font-bold text-[#233A59]">{grant.fullName}</p><p className="mt-1 text-xs text-slate-500">{grant.patientNumber} · {grant.phone} · DOB {grant.dateOfBirth}</p></div><button type="button" aria-label={`Remove ${grant.fullName}`} onClick={() => setGrants((current) => current.filter((entry) => entry.id !== grant.id))} className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-slate-600"><X size={16} /></button></div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-bold text-slate-600">Relationship<select value={grant.relationship} onChange={(event) => updateRelationship(grant.id, event.target.value as GrantDraft["relationship"])} className={inputClass}><option value="self">Patient themself</option><option value="parent">Parent of minor</option><option value="guardian">Legal guardian of minor</option><option value="adult_proxy">Adult proxy with explicit consent</option></select></label>
                <label className="text-xs font-bold text-slate-600">Consent / guardianship filing code<input value={grant.consentRecordId} onChange={(event) => updateGrant(grant.id, { consentRecordId: event.target.value })} required minLength={3} maxLength={80} pattern="[A-Za-z0-9][A-Za-z0-9._/-]{2,79}" placeholder="CONSENT-2026-001 (no names or ID numbers)" className={inputClass} /></label>
                <label className="text-xs font-bold text-slate-600">Verification method<select value={grant.consentMethod} onChange={(event) => updateGrant(grant.id, { consentMethod: event.target.value as GrantDraft["consentMethod"], consentAttested: false })} className={inputClass}>{grant.relationship === "guardian" ? <option value="verified_guardianship">Verified guardianship document</option> : <><option value="signed_form">Signed clinic form</option><option value="in_person">In-person patient verification</option></>}</select></label>
                <label className="text-xs font-bold text-slate-600">Evidence type<input readOnly value={grant.evidenceType === "patient_authorization" ? "Patient authorization" : grant.evidenceType === "parent_attestation" ? "Parent attestation for minor" : "Guardianship document"} className={inputClass + " bg-slate-50"} /></label>
              </div>
              <fieldset className="mt-4"><legend className="text-xs font-bold uppercase tracking-wide text-slate-500">Portal permissions</legend><div className="mt-2 flex flex-wrap gap-2">{[["profile", "Basic patient identity (required)"], ["appointments", "Appointments"], ["prescriptions", "Prescriptions"], ["reports", "Reports"], ["billing", "Receipts"]].map(([scope, label]) => <label key={scope} className={(grant.scopes.includes(scope) ? "border-blue-200 bg-blue-50 text-blue-900" : "border-slate-200 bg-white text-slate-600") + " inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 text-xs font-bold"}><input type="checkbox" disabled={scope === "profile"} checked={grant.scopes.includes(scope)} onChange={(event) => updateGrant(grant.id, { scopes: event.target.checked ? [...grant.scopes, scope] : grant.scopes.filter((item) => item !== scope) })} />{label}</label>)}</div></fieldset>
              <label className="mt-4 flex items-start gap-3 rounded-xl bg-amber-50 p-3 text-xs font-semibold leading-5 text-amber-950"><input type="checkbox" required checked={grant.consentAttested} onChange={(event) => updateGrant(grant.id, { consentAttested: event.target.checked })} className="mt-1" />I verified this exact patient, relationship, permission scope and evidence. The reference above identifies the clinic-held consent or guardianship record.</label>
            </article>)}
            {grants.length === 0 ? <div id="portal-invitation-requirement" className="rounded-2xl border border-dashed border-amber-300 bg-amber-50 p-5 text-center text-sm font-semibold leading-6 text-amber-950"><strong className="block">Invitation locked: no patient chart attached.</strong>Complete Step 1 above and tap the correct patient result. The invitation button will then unlock.</div> : null}
          </div>
          <div className="sm:col-span-2"><button aria-describedby={grants.length < 1 ? "portal-invitation-requirement" : undefined} disabled={saving || grants.length < 1} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#A8864A] px-5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">{saving ? <LoaderCircle className="animate-spin" size={17} /> : <KeyRound size={17} />}{saving ? "Preparing secure access…" : grants.length < 1 ? "Attach a patient first" : "Create pending invitation"}</button></div>
        </form>
      </section>

      <section className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3"><UsersRound className="text-[#A8864A]" /><div><h2 className="text-xl font-bold text-[#233A59]">Existing family access</h2><p className="text-sm text-slate-600">Renew permissions before they pause at their review or expiry date.</p></div></div>
          {accessAttentionCount > 0 ? <span className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-2 text-xs font-bold text-amber-900"><AlertTriangle size={15} />{accessAttentionCount} permission{accessAttentionCount === 1 ? "" : "s"} need attention</span> : null}
        </div>
        {loading ? <p className="mt-6 flex items-center gap-2 text-sm font-semibold text-slate-600"><LoaderCircle className="animate-spin" size={18} />Loading secure access…</p> : null}
        <div className="mt-5 space-y-4">{accounts.map((account) => <article key={account.uid} className="rounded-2xl border border-slate-200 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-bold text-[#233A59]">{account.displayName}</p><p className="mt-1 break-all text-sm text-slate-600">{account.email}</p><span className={(account.status === "active" ? "bg-emerald-50 text-emerald-700" : account.status === "pending" ? "bg-amber-50 text-amber-800" : "bg-red-50 text-red-700") + " mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-bold capitalize"}>{account.status}</span></div><div className="flex flex-wrap gap-2">{account.status !== "revoked" ? <button type="button" disabled={saving} onClick={() => void resend(account.uid)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-blue-200 px-3 text-xs font-bold text-blue-800"><KeyRound size={16} />{account.status === "pending" ? "Resend setup" : "Reset password"}</button> : null}{account.status !== "revoked" ? <button type="button" disabled={saving} onClick={() => void revoke(account.uid)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-red-200 px-3 text-xs font-bold text-red-700"><ShieldOff size={16} />Revoke account</button> : null}</div></div>
          <div className="mt-4 space-y-3">{account.grants.map((grant) => {
            const lifecycle = lifecyclePresentation(grant);
            const renewalOpen = renewal?.accountUid === account.uid && renewal.grantId === grant.grantId;
            return <div key={grant.grantId} className={(lifecycle.urgent ? "border-amber-200 bg-amber-50/60" : "border-slate-100 bg-slate-50") + " rounded-2xl border p-3 sm:p-4"}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0"><p className="text-sm font-bold text-[#233A59]">{grant.patientName}</p><p className="mt-1 text-xs capitalize text-slate-500">{grant.relationship.replaceAll("_", " ")} · {grant.status}</p><p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-slate-600"><CalendarClock size={14} />{lifecycle.detail}</p></div>
                <span className={`${lifecycle.tone} inline-flex rounded-full px-2.5 py-1 text-xs font-bold`}>{lifecycle.label}</span>
              </div>
              {grant.status !== "revoked" && account.status !== "revoked" ? <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" disabled={saving || !grant.grantVersion} onClick={() => startRenewal(account, grant)} className={(lifecycle.urgent ? "bg-[#233A59] text-white" : "border border-blue-200 bg-white text-blue-800") + " inline-flex min-h-10 items-center gap-2 rounded-xl px-3 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-50"}><RefreshCw size={15} />{lifecycle.urgent ? "Renew access" : "Re-verify access"}</button>
                <button type="button" disabled={saving} onClick={() => void revoke(account.uid, grant.grantId)} className="rounded-xl px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-50">Revoke patient</button>
              </div> : null}

              {renewalOpen && renewal ? <form onSubmit={submitRenewal} className="mt-4 rounded-2xl border border-blue-200 bg-white p-4 shadow-sm sm:p-5">
                <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.14em] text-blue-800">Secure re-verification</p><h3 className="mt-1 font-bold text-[#233A59]">{renewal.patientName}</h3><p className="mt-1 text-xs leading-5 text-slate-600">A new immutable consent event will be added. The prior consent event will not be changed.</p></div><button type="button" aria-label="Close re-verification" onClick={() => setRenewal(null)} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-600"><X size={16} /></button></div>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="text-xs font-bold text-slate-600">Reason for re-verification<select value={renewal.reverificationReason} onChange={(event) => setRenewal({ ...renewal, reverificationReason: event.target.value as RenewalDraft["reverificationReason"] })} className={inputClass}><option value="scheduled_review">Scheduled review</option><option value="expired_access">Expired access</option><option value="relationship_change">Relationship changed</option><option value="scope_change">Permissions changed</option><option value="identity_update">Identity details updated</option></select></label>
                  <label className="text-xs font-bold text-slate-600">Relationship<select value={renewal.relationship} onChange={(event) => updateRenewalRelationship(event.target.value as RenewalDraft["relationship"])} className={inputClass}><option value="self">Patient themself</option><option value="parent">Parent of minor</option><option value="guardian">Legal guardian of minor</option><option value="adult_proxy">Adult proxy with explicit consent</option></select></label>
                  <label className="text-xs font-bold text-slate-600">Account holder identity check<select value={renewal.identityVerificationMethod} onChange={(event) => setRenewal({ ...renewal, identityVerificationMethod: event.target.value as RenewalDraft["identityVerificationMethod"], identityAttested: false })} className={inputClass}><option value="registered_phone">Called registered phone</option><option value="in_person">Verified in person</option><option value="photo_id">Checked photo ID</option></select></label>
                  <label className="text-xs font-bold text-slate-600">Identity verification filing code<input value={renewal.identityVerificationReference} onChange={(event) => setRenewal({ ...renewal, identityVerificationReference: event.target.value, identityAttested: false })} required minLength={3} maxLength={80} pattern="[A-Za-z0-9][A-Za-z0-9._/-]{2,79}" placeholder="IDVERIFY-2026-001 (no names or ID numbers)" className={inputClass} /></label>
                  <label className="text-xs font-bold text-slate-600">New consent filing code<input value={renewal.consentRecordId} onChange={(event) => setRenewal({ ...renewal, consentRecordId: event.target.value, consentAttested: false })} required minLength={3} maxLength={80} pattern="[A-Za-z0-9][A-Za-z0-9._/-]{2,79}" placeholder="CONSENT-2026-002 (no names or ID numbers)" className={inputClass} /></label>
                  <label className="text-xs font-bold text-slate-600">Consent verification method<select value={renewal.consentMethod} onChange={(event) => setRenewal({ ...renewal, consentMethod: event.target.value as RenewalDraft["consentMethod"], consentAttested: false })} className={inputClass}>{renewal.relationship === "guardian" ? <option value="verified_guardianship">Verified guardianship document</option> : <><option value="signed_form">Signed clinic form</option><option value="in_person">In-person patient verification</option></>}</select></label>
                </div>
                <fieldset className="mt-4"><legend className="text-xs font-bold uppercase tracking-wide text-slate-500">Renewed permissions</legend><div className="mt-2 flex flex-wrap gap-2">{portalScopes.map(([scope, label]) => <label key={scope} className={(renewal.scopes.includes(scope) ? "border-blue-200 bg-blue-50 text-blue-900" : "border-slate-200 bg-white text-slate-600") + " inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 text-xs font-bold"}><input type="checkbox" disabled={scope === "profile"} checked={renewal.scopes.includes(scope)} onChange={(event) => setRenewal({ ...renewal, scopes: event.target.checked ? [...renewal.scopes, scope] : renewal.scopes.filter((item) => item !== scope), consentAttested: false })} />{label}</label>)}</div></fieldset>
                <div className="mt-4 grid gap-3">
                  <label className="flex items-start gap-3 rounded-xl bg-blue-50 p-3 text-xs font-semibold leading-5 text-blue-950"><input type="checkbox" required checked={renewal.identityAttested} onChange={(event) => setRenewal({ ...renewal, identityAttested: event.target.checked })} className="mt-1" />I verified that {renewal.accountName} is the authorized account holder using the method and filing reference above.</label>
                  <label className="flex items-start gap-3 rounded-xl bg-amber-50 p-3 text-xs font-semibold leading-5 text-amber-950"><input type="checkbox" required checked={renewal.consentAttested} onChange={(event) => setRenewal({ ...renewal, consentAttested: event.target.checked })} className="mt-1" />I verified this exact patient, relationship, renewed permissions and new consent evidence. I understand access immediately fails closed at the next review, expiry or revocation.</label>
                </div>
                <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" disabled={saving} onClick={() => setRenewal(null)} className="min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-700">Cancel</button><button disabled={saving} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#A8864A] px-4 text-sm font-bold text-white disabled:opacity-60">{saving ? <LoaderCircle className="animate-spin" size={16} /> : <ShieldCheck size={16} />}{saving ? "Re-verifying…" : "Confirm and renew access"}</button></div>
              </form> : null}
            </div>;
          })}</div>
        </article>)}</div>
        {!loading && accounts.length === 0 ? <div className="mt-5 rounded-2xl border border-dashed border-slate-300 p-8 text-center"><ShieldCheck className="mx-auto text-[#A8864A]" size={30} /><p className="mt-3 font-bold text-[#233A59]">No family accounts created yet</p></div> : null}
      </section>
    </div>
  );
}
