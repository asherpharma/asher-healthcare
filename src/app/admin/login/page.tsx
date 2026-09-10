"use client";

import { InstallAppButton } from "@/components/pwa/PwaRegister";
import { firebaseAuth, isFirebaseConfigured } from "@/firebase/config";
import { sendPasswordResetEmail, signInWithEmailAndPassword } from "firebase/auth";
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const lockReason = searchParams.get("reason");
  const sessionNotice = lockReason === "inactivity"
    ? "The app locked after 30 minutes without activity to protect clinic records. Sign in to continue."
    : lockReason === "locked"
      ? "The staff app is locked. Sign in again to continue securely."
      : "";
  const welcome = ["1", "true"].includes(searchParams.get("welcome") || "")
    || ["1", "true"].includes(searchParams.get("invite") || "");
  const initialEmail = (searchParams.get("email") || "").trim();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState(initialEmail);
  const [message, setMessage] = useState(
    searchParams.get("error") === "unauthorized"
      ? "This account is not approved for clinic access."
      : "",
  );
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetNotice, setResetNotice] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!firebaseAuth || loading) return;
    setLoading(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      await signInWithEmailAndPassword(
        firebaseAuth,
        String(form.get("email")).trim().toLowerCase(),
        String(form.get("password")),
      );
      router.replace(welcome ? "/admin/app" : "/admin");
    } catch {
      setMessage("The email or password is incorrect, or this account is not enabled.");
      setLoading(false);
    }
  }

  async function requestPasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!firebaseAuth || !email.trim()) return;
    setResetting(true);
    setResetNotice("");
    try {
      await sendPasswordResetEmail(firebaseAuth, email.trim().toLowerCase(), {
        url: "https://asherhealthcare.in/admin/login?passwordReset=1",
        handleCodeInApp: false,
      });
    } catch {
      // Return the same response for every address to prevent account discovery.
    } finally {
      setResetNotice("If an approved staff account matches this email, a secure password-reset link has been sent.");
      setResetting(false);
    }
  }

  return (
    <main id="main-content" className="auth-page">
      <div className="auth-shell">
        <Link href="/" className="auth-back"><ArrowLeft aria-hidden="true" size={16} />Clinic website</Link>
        <section className="auth-card">
          <div className="auth-brand"><Image src="/images/asher-logo-compact-v2.webp" alt="Asher Healthcare" width={48} height={48} /><div><p>ASHER HEALTHCARE</p><strong>Staff workspace</strong></div><LockKeyhole aria-hidden="true" size={20} /></div>
          <h1 className="auth-title">{resetOpen ? "Reset your password" : welcome ? "Your staff account is ready." : "Welcome back."}</h1>
          <p className="auth-description">
            {resetOpen
              ? "Enter your approved email to receive a secure password-reset link."
              : welcome
              ? "Sign in with the approved email and the personal password you just created."
              : "Use your clinic-approved email and personal password."}
          </p>
          {welcome ? (
            <p role="status" className="mt-5 flex items-start gap-2 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold leading-6 text-emerald-800">
              <CheckCircle2 className="mt-0.5 shrink-0" size={18} aria-hidden="true" /> Password setup completed. Future sign-ins will not send an OTP or email.
            </p>
          ) : null}

          {!isFirebaseConfigured ? (
            <div className="mt-7 rounded-2xl bg-amber-50 p-4 text-sm leading-6 text-amber-900">The secure clinic connection is not configured in this deployment yet.</div>
          ) : (
            <>
              {sessionNotice && !message ? <p role="status" className="mt-6 rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">{sessionNotice}</p> : null}
              {message ? <p role="alert" className="mt-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{message}</p> : null}

              {!resetOpen && <form className="auth-form" onSubmit={signIn} aria-busy={loading}>
                <label className="auth-label">Email address<input name="email" type="email" autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false} value={email} onChange={(event) => setEmail(event.target.value)} required className="auth-input" /></label>
                <label className="auth-label">Password<span className="relative block"><input name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required minLength={6} className="auth-input pr-14" /><button type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} className="auth-password-toggle">{showPassword ? <EyeOff aria-hidden="true" size={20} /> : <Eye aria-hidden="true" size={20} />}</button></span></label>
                <button disabled={loading} className="auth-primary">{loading ? <LoaderCircle aria-hidden="true" className="animate-spin" size={18} /> : <KeyRound aria-hidden="true" size={18} />}{loading ? "Signing in…" : "Sign in securely"}</button>
              </form>}

              <div className="mt-5 border-t border-slate-200 pt-5">
                {!resetOpen ? (
                  <button type="button" onClick={() => { setResetOpen(true); setResetNotice(""); }} className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-[#233A59] hover:text-[#A8864A]">
                    <KeyRound size={17} aria-hidden="true" /> Forgot your password?
                  </button>
                ) : (
                  <form onSubmit={requestPasswordReset} className="rounded-2xl bg-slate-50 p-4">
                    <div className="flex items-start gap-3">
                      <Mail className="mt-0.5 shrink-0 text-[#A8864A]" size={20} aria-hidden="true" />
                      <div><h2 className="font-bold text-[#233A59]">Email a reset link</h2><p className="mt-1 text-sm leading-6 text-slate-600">You can choose a new password from the secure email.</p></div>
                    </div>
                    <label className="mt-4 block text-sm font-bold text-slate-700">Staff email<input type="email" autoComplete="email" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} required className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-[#233A59] focus:ring-2 focus:ring-[#233A59]/15" /></label>
                    {resetNotice ? <p role="status" className="mt-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold leading-6 text-emerald-800">{resetNotice}</p> : null}
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      <button type="submit" disabled={resetting} className="auth-primary">{resetting ? <LoaderCircle className="animate-spin" size={17} /> : <Mail size={17} />}{resetting ? "Sending…" : "Send reset link"}</button>
                      <button type="button" onClick={() => setResetOpen(false)} className="min-h-12 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700">Back to sign in</button>
                    </div>
                  </form>
                )}
              </div>
            </>
          )}

          <details className="auth-help"><summary><Smartphone aria-hidden="true" size={18} />Install the staff app<span aria-hidden="true">+</span></summary><div><p>Android: use Chrome. iPhone: open in Safari, then choose Share → Add to Home Screen.</p><InstallAppButton wide /></div></details>
          <p className="auth-security"><ShieldCheck aria-hidden="true" size={17} />For approved clinic staff. New staff receive a private password-setup email.</p>
        </section>
      </div>
    </main>
  );
}

export default function StaffLoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
