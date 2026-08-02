"use client";

import { InstallAppButton } from "@/components/pwa/PwaRegister";
import { firebaseAuth, isFirebaseConfigured } from "@/firebase/config";
import { sendPasswordResetEmail, signInWithEmailAndPassword } from "firebase/auth";
import { ArrowLeft, CheckCircle2, KeyRound, LoaderCircle, LockKeyhole, Mail, ShieldCheck, Smartphone } from "lucide-react";
import Link from "next/link";
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
  const [message, setMessage] = useState(searchParams.get("error") === "unauthorized" ? "This account is not approved for clinic access." : "");
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetNotice, setResetNotice] = useState("");

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!firebaseAuth) return;
    setLoading(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      await signInWithEmailAndPassword(firebaseAuth, String(form.get("email")), String(form.get("password")));
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
      await sendPasswordResetEmail(firebaseAuth, email.trim(), {
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
    <main id="main-content" className="min-h-screen bg-slate-50 px-6 py-10 sm:py-16">
      <div className="mx-auto max-w-lg">
        <Link href="/" className="inline-flex items-center gap-2 text-sm font-bold text-[#233A59] hover:text-[#A8864A]"><ArrowLeft size={16} />Back to website</Link>
        <section className="mt-8 rounded-[2rem] border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/60 sm:p-10">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#233A59] text-white"><LockKeyhole size={26} /></div>
          <p className="mt-7 text-sm font-bold uppercase tracking-[0.18em] text-[#A8864A]">Staff portal</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-[#233A59]">{welcome ? "Welcome to Asher Staff." : "Welcome back."}</h1>
          <p className="mt-3 leading-7 text-slate-600">{welcome ? "Your invitation includes secure password setup. After setting your password, sign in here and install the app on this phone." : "Sign in with your clinic-approved staff account."}</p>
          {welcome ? (
            <p role="status" className="mt-5 flex items-start gap-2 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold leading-6 text-emerald-800">
              <CheckCircle2 className="mt-0.5 shrink-0" size={18} aria-hidden="true" /> Staff invitation opened securely. Your email has been filled in when available.
            </p>
          ) : null}

          <div className="mt-6 rounded-2xl border border-blue-100 bg-blue-50 p-4">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#233A59] text-white"><Smartphone size={19} aria-hidden="true" /></span>
              <div className="min-w-0 flex-1">
                <h2 className="font-bold text-[#233A59]">Install the staff app</h2>
                <p className="mt-1 text-sm leading-6 text-slate-600">Android: use Chrome. iPhone: open in Safari, then choose Share → Add to Home Screen.</p>
                <div className="mt-3"><InstallAppButton wide /></div>
              </div>
            </div>
          </div>
          {!isFirebaseConfigured ? (
            <div className="mt-7 rounded-2xl bg-amber-50 p-4 text-sm leading-6 text-amber-900">The secure clinic connection is not configured in this deployment yet.</div>
          ) : (
            <form className="mt-7 space-y-5" onSubmit={signIn}>
              <label className="block text-sm font-bold text-slate-700">Email address<input name="email" type="email" autoComplete="email" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} required className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none transition focus:border-[#233A59] focus:ring-2 focus:ring-[#233A59]/15" /></label>
              <label className="block text-sm font-bold text-slate-700">Password<input name="password" type="password" autoComplete="current-password" required minLength={8} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none transition focus:border-[#233A59] focus:ring-2 focus:ring-[#233A59]/15" /></label>
              {sessionNotice && !message ? <p role="status" className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">{sessionNotice}</p> : null}
              {message && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{message}</p>}
              <button disabled={loading} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#233A59] px-5 py-3.5 text-sm font-bold text-white transition hover:bg-[#1b2e48] disabled:opacity-60">{loading && <LoaderCircle className="animate-spin" size={18} />}{loading ? "Signing in…" : "Sign in securely"}</button>
            </form>
          )}
          {isFirebaseConfigured ? (
            <div className="mt-5 border-t border-slate-200 pt-5">
              {!resetOpen ? (
                <button type="button" onClick={() => { setResetOpen(true); setResetNotice(""); }} className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-[#233A59] hover:text-[#A8864A]">
                  <KeyRound size={17} aria-hidden="true" /> Forgot or need to set your password?
                </button>
              ) : (
                <form onSubmit={requestPasswordReset} className="rounded-2xl bg-slate-50 p-4">
                  <div className="flex items-start gap-3">
                    <Mail className="mt-0.5 shrink-0 text-[#A8864A]" size={20} aria-hidden="true" />
                    <div><h2 className="font-bold text-[#233A59]">Send a secure password link</h2><p className="mt-1 text-sm leading-6 text-slate-600">Use the email approved by your clinic administrator.</p></div>
                  </div>
                  <label className="mt-4 block text-sm font-bold text-slate-700">Staff email<input type="email" autoComplete="email" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} required className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-[#233A59] focus:ring-2 focus:ring-[#233A59]/15" /></label>
                  {resetNotice ? <p role="status" className="mt-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold leading-6 text-emerald-800">{resetNotice}</p> : null}
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    <button type="submit" disabled={resetting} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#A8864A] px-4 text-sm font-bold text-white disabled:opacity-60">{resetting ? <LoaderCircle className="animate-spin" size={17} /> : <Mail size={17} />}{resetting ? "Sending…" : "Send password link"}</button>
                    <button type="button" onClick={() => setResetOpen(false)} className="min-h-12 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700">Back to sign in</button>
                  </div>
                </form>
              )}
            </div>
          ) : null}
          <div className="mt-7 flex gap-3 rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-600"><ShieldCheck className="mt-0.5 shrink-0 text-[#233A59]" size={20} /><p>Access is restricted to approved clinic staff. Sign-in activity is protected by Firebase Authentication.</p></div>
          <p className="mt-4 text-xs leading-5 text-slate-500">Verified mobile OTP sign-in can be added later as an optional method after each staff member confirms their own number.</p>
        </section>
      </div>
    </main>
  );
}

export default function StaffLoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
