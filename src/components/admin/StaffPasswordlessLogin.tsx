"use client";

import { firebaseAuth, firestore } from "@/firebase/config";
import {
  isApprovedStaffProfile,
  isFreshAuthAccount,
  normalizeIndianStaffPhone,
  STAFF_EMAIL_LINK_STORAGE_KEY,
} from "@/lib/staff-auth";
import {
  deleteUser,
  isSignInWithEmailLink,
  RecaptchaVerifier,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signInWithPhoneNumber,
  signOut,
  type ConfirmationResult,
  type User,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { ArrowRight, CheckCircle2, KeyRound, LoaderCircle, Mail, MessageSquareText, ShieldCheck, Smartphone } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

type LoginMode = "email" | "phone";

function authErrorMessage(error: unknown, option: "email" | "phone") {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  if (code === "auth/operation-not-allowed") return `${option === "phone" ? "Mobile OTP" : "Email-link sign-in"} is not enabled yet. Please use email and password for now.`;
  if (code === "auth/too-many-requests" || code === "auth/quota-exceeded") return "Too many attempts were made. Please wait before trying again.";
  if (code === "auth/invalid-verification-code" || code === "auth/code-expired") return "That verification code is incorrect or expired. Request a new code and try again.";
  if (code === "auth/invalid-phone-number") return "Enter a valid 10-digit Indian mobile number.";
  if (code === "auth/credential-already-in-use") return "This mobile number is already linked to another account. Ask the administrator to check staff access.";
  if (code === "auth/invalid-action-code" || code === "auth/expired-action-code") return "This secure email link is invalid or expired. Request a fresh link.";
  if (code === "auth/captcha-check-failed" || code === "auth/missing-recaptcha-token") return "The security check could not be completed. Refresh the page and try again.";
  return "Sign-in could not be completed. Please check your details and try again.";
}

async function removeUnapprovedIdentity(user: User) {
  if (isFreshAuthAccount(user.metadata)) {
    try {
      await deleteUser(user);
      return;
    } catch {
      // If deletion is unavailable, signing out still prevents clinic access.
    }
  }
  if (firebaseAuth) await signOut(firebaseAuth);
}

export default function StaffPasswordlessLogin({
  initialEmail = "",
  afterSignInHref = "/admin",
}: {
  initialEmail?: string;
  afterSignInHref?: string;
}) {
  const router = useRouter();
  const verifierRef = useRef<RecaptchaVerifier | null>(null);
  const [mode, setMode] = useState<LoginMode>("email");
  const [email, setEmail] = useState(initialEmail);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [emailLinkPending, setEmailLinkPending] = useState(false);
  const [confirmEmailNeeded, setConfirmEmailNeeded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);

  const authorizeStaff = useCallback(async (user: User) => {
    if (!firestore) throw new Error("auth/not-configured");
    const staffSnapshot = await getDoc(doc(firestore, "staff", user.uid));
    if (!staffSnapshot.exists() || !isApprovedStaffProfile(staffSnapshot.data())) {
      await removeUnapprovedIdentity(user);
      return false;
    }
    router.replace(afterSignInHref);
    return true;
  }, [afterSignInHref, router]);

  const finishEmailSignIn = useCallback(async (address: string) => {
    if (!firebaseAuth || typeof window === "undefined") return;
    setLoading(true);
    setError("");
    try {
      const result = await signInWithEmailLink(firebaseAuth, address.trim().toLowerCase(), window.location.href);
      window.sessionStorage.removeItem(STAFF_EMAIL_LINK_STORAGE_KEY);
      if (!await authorizeStaff(result.user)) {
        setError("This email is not linked to an active clinic staff account. Please contact the administrator.");
        setLoading(false);
      }
    } catch (caught) {
      setError(authErrorMessage(caught, "email"));
      setLoading(false);
    }
  }, [authorizeStaff]);

  useEffect(() => {
    if (!firebaseAuth || typeof window === "undefined" || !isSignInWithEmailLink(firebaseAuth, window.location.href)) return;
    const storedEmail = window.sessionStorage.getItem(STAFF_EMAIL_LINK_STORAGE_KEY) || "";
    const timer = window.setTimeout(() => {
      setMode("email");
      setEmailLinkPending(true);
      if (storedEmail) {
        setEmail(storedEmail);
        void finishEmailSignIn(storedEmail);
      } else {
        setConfirmEmailNeeded(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [finishEmailSignIn]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => setCooldown((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  useEffect(() => () => verifierRef.current?.clear(), []);

  function resetPhoneChallenge() {
    verifierRef.current?.clear();
    verifierRef.current = null;
    setConfirmation(null);
    setCode("");
  }

  function switchMode(nextMode: LoginMode) {
    setMode(nextMode);
    setError("");
    setNotice("");
    if (nextMode === "email") resetPhoneChallenge();
  }

  async function sendEmailLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!firebaseAuth || !email.trim()) return;
    setLoading(true);
    setError("");
    setNotice("");
    const address = email.trim().toLowerCase();
    try {
      await sendSignInLinkToEmail(firebaseAuth, address, {
        url: "https://asherhealthcare.in/admin/login?emailSignIn=1",
        handleCodeInApp: true,
      });
      window.sessionStorage.setItem(STAFF_EMAIL_LINK_STORAGE_KEY, address);
      setNotice("A secure sign-in link has been sent. Open it on this device to enter the staff app.");
    } catch (caught) {
      setError(authErrorMessage(caught, "email"));
    } finally {
      setLoading(false);
    }
  }

  async function confirmEmailLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim()) return;
    await finishEmailSignIn(email);
  }

  async function sendPhoneCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!firebaseAuth || cooldown > 0) return;
    const normalizedPhone = normalizeIndianStaffPhone(phone);
    if (!normalizedPhone) {
      setError("Enter a valid 10-digit Indian mobile number.");
      return;
    }
    setLoading(true);
    setError("");
    setNotice("");
    resetPhoneChallenge();
    try {
      verifierRef.current = new RecaptchaVerifier(firebaseAuth, "staff-login-recaptcha", { size: "invisible" });
      const nextConfirmation = await signInWithPhoneNumber(firebaseAuth, normalizedPhone, verifierRef.current);
      setConfirmation(nextConfirmation);
      setCooldown(60);
      setNotice(`A 6-digit code was sent to +91 •••••• ${normalizedPhone.slice(-4)}.`);
    } catch (caught) {
      verifierRef.current?.clear();
      verifierRef.current = null;
      setError(authErrorMessage(caught, "phone"));
    } finally {
      setLoading(false);
    }
  }

  async function verifyPhoneCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmation || !/^\d{6}$/u.test(code)) {
      setError("Enter the 6-digit code sent to your mobile.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await confirmation.confirm(code);
      if (!await authorizeStaff(result.user)) {
        setError("This mobile is not linked to an active staff account. Sign in by email, then enable mobile OTP from Mobile app.");
        resetPhoneChallenge();
        setLoading(false);
      }
    } catch (caught) {
      setError(authErrorMessage(caught, "phone"));
      setLoading(false);
    }
  }

  return (
    <section className="mt-7" aria-labelledby="passwordless-title">
      <div className="flex rounded-2xl bg-slate-100 p-1" role="tablist" aria-label="Quick sign-in method">
        <button type="button" role="tab" aria-selected={mode === "email"} onClick={() => switchMode("email")} className={`flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl px-3 text-sm font-bold transition ${mode === "email" ? "bg-white text-[#233A59] shadow-sm" : "text-slate-500"}`}><Mail size={17} />Email link</button>
        <button type="button" role="tab" aria-selected={mode === "phone"} onClick={() => switchMode("phone")} className={`flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl px-3 text-sm font-bold transition ${mode === "phone" ? "bg-white text-[#233A59] shadow-sm" : "text-slate-500"}`}><Smartphone size={17} />Mobile OTP</button>
      </div>

      {mode === "email" ? (
        emailLinkPending && confirmEmailNeeded ? (
          <form className="mt-5 space-y-4" onSubmit={confirmEmailLink}>
            <div className="rounded-2xl bg-blue-50 p-4 text-sm leading-6 text-blue-900"><KeyRound className="mr-2 inline" size={17} />For security, confirm the email address that received this link.</div>
            <label className="block text-sm font-bold text-slate-700">Staff email<input type="email" autoComplete="email" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} required className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-[#233A59] focus:ring-2 focus:ring-[#233A59]/15" /></label>
            <button disabled={loading} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#233A59] px-5 text-sm font-bold text-white disabled:opacity-60">{loading ? <LoaderCircle className="animate-spin" size={18} /> : <ArrowRight size={18} />}{loading ? "Verifying…" : "Continue securely"}</button>
          </form>
        ) : (
          <form className="mt-5 space-y-4" onSubmit={sendEmailLink}>
            <div><h2 id="passwordless-title" className="font-bold text-[#233A59]">Sign in without a password</h2><p className="mt-1 text-sm leading-6 text-slate-600">We’ll email a private, one-tap link to your approved staff address.</p></div>
            <label className="block text-sm font-bold text-slate-700">Staff email<input type="email" autoComplete="email" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} required className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-[#233A59] focus:ring-2 focus:ring-[#233A59]/15" /></label>
            <button disabled={loading} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#233A59] px-5 text-sm font-bold text-white transition hover:bg-[#1b2e48] disabled:opacity-60">{loading ? <LoaderCircle className="animate-spin" size={18} /> : <Mail size={18} />}{loading ? "Sending…" : "Email me a sign-in link"}</button>
          </form>
        )
      ) : confirmation ? (
        <form className="mt-5 space-y-4" onSubmit={verifyPhoneCode}>
          <div><h2 id="passwordless-title" className="font-bold text-[#233A59]">Enter mobile OTP</h2><p className="mt-1 text-sm leading-6 text-slate-600">Use the 6-digit verification code sent by SMS.</p></div>
          <label className="block text-sm font-bold text-slate-700">6-digit code<input type="text" autoComplete="one-time-code" inputMode="numeric" maxLength={6} pattern="[0-9]{6}" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/gu, "").slice(0, 6))} required className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-center text-xl font-bold tracking-[0.35em] outline-none focus:border-[#233A59] focus:ring-2 focus:ring-[#233A59]/15" /></label>
          <button disabled={loading} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#233A59] px-5 text-sm font-bold text-white disabled:opacity-60">{loading ? <LoaderCircle className="animate-spin" size={18} /> : <ShieldCheck size={18} />}{loading ? "Verifying…" : "Verify and sign in"}</button>
          <button type="button" onClick={resetPhoneChallenge} className="min-h-11 w-full text-sm font-bold text-slate-600">Use a different number{cooldown > 0 ? ` or resend in ${cooldown}s` : ""}</button>
        </form>
      ) : (
        <form className="mt-5 space-y-4" onSubmit={sendPhoneCode}>
          <div><h2 id="passwordless-title" className="font-bold text-[#233A59]">Sign in with mobile OTP</h2><p className="mt-1 text-sm leading-6 text-slate-600">Use the number you linked once from the Mobile app screen.</p></div>
          <label className="block text-sm font-bold text-slate-700">Indian mobile number<div className="mt-2 flex rounded-xl border border-slate-200 bg-white focus-within:border-[#233A59] focus-within:ring-2 focus-within:ring-[#233A59]/15"><span className="flex items-center border-r border-slate-200 px-3 text-sm font-bold text-slate-600">+91</span><input type="tel" autoComplete="tel-national" inputMode="numeric" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="98765 43210" required className="min-w-0 flex-1 rounded-r-xl px-4 py-3 outline-none" /></div></label>
          <button disabled={loading || cooldown > 0} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#233A59] px-5 text-sm font-bold text-white disabled:opacity-60">{loading ? <LoaderCircle className="animate-spin" size={18} /> : <MessageSquareText size={18} />}{loading ? "Sending…" : cooldown > 0 ? `Resend in ${cooldown}s` : "Send OTP"}</button>
          <p className="text-xs leading-5 text-slate-500">Google Firebase uses your number for authentication and abuse prevention. SMS delivery charges are borne by the clinic; your carrier’s normal rates may apply.</p>
        </form>
      )}

      <div id="staff-login-recaptcha" />
      {notice ? <p role="status" className="mt-4 flex items-start gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold leading-6 text-emerald-800"><CheckCircle2 className="mt-0.5 shrink-0" size={18} />{notice}</p> : null}
      {error ? <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold leading-6 text-red-700">{error}</p> : null}
    </section>
  );
}
