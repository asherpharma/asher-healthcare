"use client";

import { firebaseAuth, isFirebaseConfigured } from "@/firebase/config";
import { signInWithEmailAndPassword } from "firebase/auth";
import { ArrowLeft, LoaderCircle, LockKeyhole, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(searchParams.get("error") === "unauthorized" ? "This account is not approved for clinic access." : "");

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!firebaseAuth) return;
    setLoading(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      await signInWithEmailAndPassword(firebaseAuth, String(form.get("email")), String(form.get("password")));
      router.replace("/admin");
    } catch {
      setMessage("The email or password is incorrect, or this account is not enabled.");
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10 sm:py-16">
      <div className="mx-auto max-w-lg">
        <Link href="/" className="inline-flex items-center gap-2 text-sm font-bold text-[#233A59] hover:text-[#A8864A]"><ArrowLeft size={16} />Back to website</Link>
        <section className="mt-8 rounded-[2rem] border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/60 sm:p-10">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#233A59] text-white"><LockKeyhole size={26} /></div>
          <p className="mt-7 text-sm font-bold uppercase tracking-[0.18em] text-[#A8864A]">Staff portal</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-[#233A59]">Welcome back.</h1>
          <p className="mt-3 leading-7 text-slate-600">Sign in with your clinic-approved staff account.</p>
          {!isFirebaseConfigured ? (
            <div className="mt-7 rounded-2xl bg-amber-50 p-4 text-sm leading-6 text-amber-900">The secure clinic connection is not configured in this deployment yet.</div>
          ) : (
            <form className="mt-7 space-y-5" onSubmit={signIn}>
              <label className="block text-sm font-bold text-slate-700">Email address<input name="email" type="email" autoComplete="email" required className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none transition focus:border-[#233A59] focus:ring-2 focus:ring-[#233A59]/15" /></label>
              <label className="block text-sm font-bold text-slate-700">Password<input name="password" type="password" autoComplete="current-password" required minLength={8} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none transition focus:border-[#233A59] focus:ring-2 focus:ring-[#233A59]/15" /></label>
              {message && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{message}</p>}
              <button disabled={loading} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#233A59] px-5 py-3.5 text-sm font-bold text-white transition hover:bg-[#1b2e48] disabled:opacity-60">{loading && <LoaderCircle className="animate-spin" size={18} />}{loading ? "Signing in…" : "Sign in securely"}</button>
            </form>
          )}
          <div className="mt-7 flex gap-3 rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-600"><ShieldCheck className="mt-0.5 shrink-0 text-[#233A59]" size={20} /><p>Access is restricted to approved clinic staff. Sign-in activity is protected by Firebase Authentication.</p></div>
        </section>
      </div>
    </main>
  );
}

export default function StaffLoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
